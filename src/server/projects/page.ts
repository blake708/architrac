import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { invoiceMoneyForProject, linesForProjects, outstandingCents } from "@/server/invoices/facts";
import {
  activityLog,
  companies,
  consultants,
  contacts,
  firmRoles,
  firmSettings,
  memberships,
  phaseTemplates,
  projectPhaseRoles,
  projectContacts,
  projectMembers,
  projectPhases,
  projects,
  users,
} from "@/db/schema";
import type { TenantDb } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import { consultantFeeToClient } from "@/lib/calc/project-detail";
import {
  type FeeType,
  type Health,
  type PhaseStatus,
  type ProjectStatus,
  billedPct,
  phaseText,
  projectBilled,
  projectFee,
  projectHealth,
} from "@/lib/calc/projects";
import { todayIn } from "@/lib/format";
import { initials as initialsFrom } from "@/lib/initials";
import type { ScopeKind } from "@/lib/projects/form";
import { type MixInput, type RoleRate, billRates, templateMixes } from "./roles";
import { type Viewer, activePeople, assignedProjectIds, pmChoices, principalChoices } from "./view";
import { hoursByPhaseAndPerson } from "@/server/time/used";

// One project's page (project-detail spec). Two views:
// - financial (owner, admin, or the project's own PM / principal): fees,
//   billed, hours, health, consultant fees;
// - basic (everyone else who may open it): none of that is selected or sent.
// Bill-rate overrides go to owners and admins only. Staff who aren't on the
// project get null, which the page turns into "not found".

export type PhaseRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
  status: PhaseStatus;
  startDate: string | null;
  endDate: string | null;
  /** Financial view only. */
  money?: {
    feeType: FeeType;
    feeCents: number;
    budgetHours: number;
    usedHours: number;
    percentCompleteBp: number;
    billedCents: number;
    budgetHoursManual: boolean;
    isAdditionalService: boolean;
    /** Role mix with the bill rate and hours saved on the day of the edit. */
    roles: { firmRoleId: string; roleName: string; shareBp: number; rateCents: number; hours: number }[];
    /** Hours logged on this phase, by each person's billing role (time arrives in 1.6). */
    usedByRole: { firmRoleId: string | null; roleName: string; hours: number }[];
    /** Hours by person, for the expandable row. No rates or cost. */
    byPerson: { membershipId: string; name: string; initials: string; title: string | null; hours: number }[];
  };
};

export type TeamMember = {
  id: string;
  membershipId: string;
  name: string;
  initials: string;
  title: string | null;
  projectRole: string;
  isPm: boolean;
  isPrincipal: boolean;
  /** Financial view only. */
  hours?: number;
  /** Owner/admin only. */
  rateOverrideCents?: number | null;
};

export type ConsultantRow = {
  id: string;
  companyId: string;
  companyName: string;
  contactId: string | null;
  contact: { name: string; title: string | null; email: string | null } | null;
  discipline: string;
  /** Financial view only. */
  money?: { feeCents: number; markupBp: number; billedThrough: boolean; feeToClientCents: number | null };
};

export type LinkedCompany = {
  id: string;
  companyId: string;
  companyName: string;
  kind: string;
  role: string | null;
  contact: { name: string; title: string | null; email: string | null } | null;
};

export type ActivityItem = {
  id: string;
  at: string;
  actor: string;
  entityType: string;
  action: string;
  label: string;
  changes: Record<string, unknown> | null;
};

export type ProjectPage = {
  id: string;
  number: string;
  name: string;
  status: ProjectStatus;
  projectType: string;
  scopeKind: ScopeKind | null;
  squareFeet: number | null;
  constructionCostCents: number | null;
  address: { addressLine1: string | null; addressLine2: string | null; city: string | null; state: string | null; postalCode: string | null };
  startDate: string | null;
  targetEndDate: string | null;
  client: { id: string; name: string };
  clientContact: { id: string; name: string; title: string | null; email: string | null } | null;
  principal: { membershipId: string; name: string } | null;
  pm: { membershipId: string; name: string } | null;
  phaseText: string;
  phases: PhaseRow[];
  team: TeamMember[];
  consultants: ConsultantRow[];
  linked: LinkedCompany[];
  activity: ActivityItem[];
  /** Financial view only. */
  money?: {
    feeCents: number;
    billedCents: number;
    billedPct: number | null;
    outstandingCents: number;
    health: Health;
  };
  financial: boolean;
  canEdit: boolean;
  canSetOverride: boolean;
  /** For Edit phases, Add phase and Redistribute (financial + canEdit only). Bill rates only. */
  phaseEdit?: {
    loadedAt: string;
    roles: RoleRate[];
    blendedBillRateCents: number | null;
    optionalTemplates: { id: string; code: string; name: string; description: string | null; feeType: FeeType; mix: MixInput }[];
    templateShareByCode: Record<string, number>;
  };
  /** For Edit project (only when canEdit). */
  edit?: {
    clientContactId: string | null;
    principals: { membershipId: string; name: string }[];
    pms: { membershipId: string; name: string }[];
    people: { membershipId: string; name: string; title: string | null }[];
    defaultMarkupBp: number;
  };
};

/** Fields the basic view never hears about, not even that they changed. */
const MONEY_FIELDS = new Set([
  "feeCents",
  "totalFeeCents",
  "budgetHours",
  "totalBudgetHours",
  "markupBp",
  "billedThrough",
  "billRateOverrideCents",
  "percentCompleteBp",
]);

const fullName = (u: { firstName: string; lastName: string; email: string }) =>
  `${u.firstName} ${u.lastName}`.trim() || u.email;
const contactName = (c: { firstName: string; lastName: string }) => `${c.firstName} ${c.lastName}`.trim();

/** Hours used per phase and person, drafts included (decision #20). */
function usedHours(db: TenantDb, projectId: string): Promise<{ phaseId: string; membershipId: string; hours: number }[]> {
  return hoursByPhaseAndPerson(db, projectId);
}

/** This project's invoice lines (only counted ones count as billed) and open balance. */
export async function invoiceFacts(db: TenantDb, projectId: string) {
  const [lines, money] = await Promise.all([linesForProjects(db, [projectId]), invoiceMoneyForProject(db, projectId)]);
  return { lines: lines as Parameters<typeof projectBilled>[1], outstandingCents: outstandingCents(money) };
}

export async function loadProjectPage(
  db: TenantDb,
  viewer: Viewer,
  id: string,
  firm: { id: string; timezone: string } | null = null,
): Promise<ProjectPage | null> {
  const loadedAt = new Date().toISOString();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [p] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), isNull(projects.archivedAt)));
  if (!p) return null;
  const assigned = (await assignedProjectIds(db, viewer.membershipId)).has(p.id);
  if (!can(viewer, "projects.view", { isAssigned: assigned })) return null;

  const own = p.pmMembershipId === viewer.membershipId || p.principalMembershipId === viewer.membershipId;
  const financial = can(viewer, "projects.view_fees", { isProjectManager: own });
  const canEdit = can(viewer, "projects.edit", { isProjectManager: own });
  const canSetOverride = can(viewer, "projects.rate_override");

  const [client] = await db.select({ id: companies.id, name: companies.name }).from(companies).where(eq(companies.id, p.clientCompanyId));
  const [clientContact] = p.clientContactId
    ? await db.select().from(contacts).where(eq(contacts.id, p.clientContactId))
    : [];

  // Phases: the basic view never selects fees or hours.
  const phaseRows = await db
    .select({
      id: projectPhases.id,
      code: projectPhases.code,
      name: projectPhases.name,
      description: projectPhases.description,
      sortOrder: projectPhases.sortOrder,
      status: projectPhases.status,
      startDate: projectPhases.startDate,
      endDate: projectPhases.endDate,
    })
    .from(projectPhases)
    .where(and(eq(projectPhases.projectId, p.id), isNull(projectPhases.archivedAt)))
    .orderBy(asc(projectPhases.sortOrder));

  // Team.
  const memberRows = await db
    .select({
      id: projectMembers.id,
      membershipId: projectMembers.membershipId,
      projectRole: projectMembers.projectRole,
      override: projectMembers.billRateOverrideCents,
      title: memberships.title,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      initials: users.initials,
    })
    .from(projectMembers)
    .innerJoin(memberships, eq(memberships.id, projectMembers.membershipId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(projectMembers.projectId, p.id), isNull(projectMembers.archivedAt)));

  const used = financial ? await usedHours(db, p.id) : [];
  const nameOf = new Map(memberRows.map((m) => [m.membershipId, m]));

  let phases: PhaseRow[] = phaseRows;
  let money: ProjectPage["money"];
  if (financial) {
    const moneyRows = await db
      .select({
        id: projectPhases.id,
        feeType: projectPhases.feeType,
        feeCents: projectPhases.feeCents,
        budgetHours: projectPhases.budgetHours,
        percentCompleteBp: projectPhases.percentCompleteBp,
        budgetHoursManual: projectPhases.budgetHoursManual,
        isAdditionalService: projectPhases.isAdditionalService,
      })
      .from(projectPhases)
      .where(and(eq(projectPhases.projectId, p.id), isNull(projectPhases.archivedAt)));
    const byId = new Map(moneyRows.map((m) => [m.id, m]));
    const mixRows = moneyRows.length
      ? await db
          .select({
            phaseId: projectPhaseRoles.projectPhaseId,
            firmRoleId: projectPhaseRoles.firmRoleId,
            roleName: firmRoles.name,
            shareBp: projectPhaseRoles.shareBp,
            rateCents: projectPhaseRoles.rateCents,
            hours: projectPhaseRoles.hours,
          })
          .from(projectPhaseRoles)
          .innerJoin(firmRoles, eq(firmRoles.id, projectPhaseRoles.firmRoleId))
          .where(and(inArray(projectPhaseRoles.projectPhaseId, moneyRows.map((m) => m.id)), isNull(projectPhaseRoles.archivedAt)))
          .orderBy(asc(projectPhaseRoles.sortOrder))
      : [];
    const inv = await invoiceFacts(db, p.id);
    // Each person's billing role, to show hours used by role.
    const usedIds = [...new Set(used.map((u) => u.membershipId))];
    const roleOfPerson = new Map(
      (usedIds.length
        ? await db
            .select({ id: memberships.id, roleId: memberships.firmRoleId, roleName: firmRoles.name })
            .from(memberships)
            .leftJoin(firmRoles, eq(firmRoles.id, memberships.firmRoleId))
            .where(inArray(memberships.id, usedIds))
        : []
      ).map((r) => [r.id, { roleId: r.roleId, roleName: r.roleName ?? "No role" }]),
    );
    phases = phaseRows.map((ph) => {
      const m = byId.get(ph.id)!;
      const mine = used.filter((u) => u.phaseId === ph.id);
      const people = new Map<string, number>();
      for (const u of mine) people.set(u.membershipId, (people.get(u.membershipId) ?? 0) + u.hours);
      return {
        ...ph,
        money: {
          feeType: m.feeType,
          feeCents: m.feeCents,
          budgetHours: Number(m.budgetHours),
          usedHours: mine.reduce((n, u) => n + u.hours, 0),
          percentCompleteBp: m.percentCompleteBp,
          budgetHoursManual: m.budgetHoursManual,
          isAdditionalService: m.isAdditionalService,
          roles: mixRows
            .filter((r) => r.phaseId === ph.id)
            .map((r) => ({ firmRoleId: r.firmRoleId, roleName: r.roleName, shareBp: r.shareBp, rateCents: r.rateCents, hours: Number(r.hours) })),
          usedByRole: (() => {
            const by = new Map<string, { firmRoleId: string | null; roleName: string; hours: number }>();
            for (const u of mine) {
              const r = roleOfPerson.get(u.membershipId) ?? { roleId: null, roleName: "No role" };
              const k = r.roleId ?? "none";
              const cur = by.get(k) ?? { firmRoleId: r.roleId, roleName: r.roleName, hours: 0 };
              cur.hours += u.hours;
              by.set(k, cur);
            }
            return [...by.values()];
          })(),
          billedCents: projectBilled([{ id: ph.id, feeType: m.feeType }], inv.lines),
          byPerson: [...people].map(([membershipId, hours]) => {
            const who = nameOf.get(membershipId);
            return {
              membershipId,
              name: who ? fullName(who) : "Former team member",
              initials: who?.initials || (who ? initialsFrom(fullName(who)) : "?"),
              title: who?.title ?? null,
              hours,
            };
          }),
        },
      };
    });
    const facts = phases.map((ph) => ({
      id: ph.id,
      status: ph.status,
      feeType: ph.money!.feeType,
      feeCents: ph.money!.feeCents,
      budgetHours: ph.money!.budgetHours,
    }));
    const usedBy = new Map(phases.map((ph) => [ph.id, ph.money!.usedHours]));
    const fee = projectFee(facts);
    const billed = projectBilled(facts, inv.lines);
    money = {
      feeCents: fee,
      billedCents: billed,
      billedPct: billedPct(billed, fee),
      outstandingCents: inv.outstandingCents,
      health: projectHealth(p.status, facts, usedBy),
    };
  }

  const roleOrder = (m: (typeof memberRows)[number]) =>
    m.membershipId === p.principalMembershipId ? 0 : m.membershipId === p.pmMembershipId ? 1 : 2;
  const team: TeamMember[] = memberRows
    .sort((a, b) => roleOrder(a) - roleOrder(b) || a.lastName.localeCompare(b.lastName))
    .map((m) => ({
      id: m.id,
      membershipId: m.membershipId,
      name: fullName(m),
      initials: m.initials || initialsFrom(fullName(m)),
      title: m.title,
      projectRole: m.projectRole,
      isPm: m.membershipId === p.pmMembershipId,
      isPrincipal: m.membershipId === p.principalMembershipId,
      ...(financial ? { hours: used.filter((u) => u.membershipId === m.membershipId).reduce((n, u) => n + u.hours, 0) } : {}),
      ...(canSetOverride ? { rateOverrideCents: m.override } : {}),
    }));

  // Consultants and other linked companies.
  const consultantRows = await db
    .select({
      id: consultants.id,
      companyId: consultants.companyId,
      companyName: companies.name,
      billingContactId: companies.billingContactId,
      contactId: consultants.contactId,
      discipline: consultants.discipline,
      feeCents: consultants.feeCents,
      markupBp: consultants.markupBp,
      billedThrough: consultants.billedThrough,
    })
    .from(consultants)
    .innerJoin(companies, eq(companies.id, consultants.companyId))
    .where(and(eq(consultants.projectId, p.id), isNull(consultants.archivedAt)))
    .orderBy(asc(consultants.discipline));
  const linkRows = await db
    .select({
      id: projectContacts.id,
      companyId: projectContacts.companyId,
      companyName: companies.name,
      kind: companies.kind,
      role: projectContacts.role,
      contactId: projectContacts.contactId,
      billingContactId: companies.billingContactId,
    })
    .from(projectContacts)
    .innerJoin(companies, eq(companies.id, projectContacts.companyId))
    .where(and(eq(projectContacts.projectId, p.id), isNull(projectContacts.archivedAt)))
    .orderBy(asc(companies.name));
  // A consultant's contact falls back to the company's billing contact.
  const contactIds = [
    ...consultantRows.map((c) => c.contactId ?? c.billingContactId),
    ...linkRows.map((l) => l.contactId ?? l.billingContactId),
  ].filter((x): x is string => Boolean(x));
  const contactRows = contactIds.length
    ? await db.select().from(contacts).where(and(inArray(contacts.id, contactIds), isNull(contacts.archivedAt)))
    : [];
  const contactBy = new Map(
    contactRows.map((c) => [c.id, { name: contactName(c), title: c.title, email: c.email }]),
  );

  const consultantList: ConsultantRow[] = consultantRows.map((c) => ({
    id: c.id,
    companyId: c.companyId,
    companyName: c.companyName,
    contactId: c.contactId,
    contact: contactBy.get(c.contactId ?? c.billingContactId ?? "") ?? null,
    discipline: c.discipline,
    ...(financial
      ? {
          money: {
            feeCents: c.feeCents,
            markupBp: c.markupBp,
            billedThrough: c.billedThrough,
            feeToClientCents: consultantFeeToClient(c),
          },
        }
      : {}),
  }));
  const linked: LinkedCompany[] = linkRows.map((l) => ({
    id: l.id,
    companyId: l.companyId,
    companyName: l.companyName,
    kind: l.kind,
    role: l.role,
    contact: contactBy.get(l.contactId ?? l.billingContactId ?? "") ?? null,
  }));

  // Recent activity on the project and the things that hang off it.
  // Archived phases, team rows, consultants and links keep their history.
  const [allPhases, allMembers, allConsultants, allLinks] = await Promise.all([
    db.select({ id: projectPhases.id, label: projectPhases.code }).from(projectPhases).where(eq(projectPhases.projectId, p.id)),
    db
      .select({ id: projectMembers.id, initials: users.initials, firstName: users.firstName, lastName: users.lastName, email: users.email })
      .from(projectMembers)
      .innerJoin(memberships, eq(memberships.id, projectMembers.membershipId))
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(projectMembers.projectId, p.id)),
    db.select({ id: consultants.id, label: consultants.discipline }).from(consultants).where(eq(consultants.projectId, p.id)),
    db
      .select({ id: projectContacts.id, label: companies.name })
      .from(projectContacts)
      .innerJoin(companies, eq(companies.id, projectContacts.companyId))
      .where(eq(projectContacts.projectId, p.id)),
  ]);
  const childIds = [...allPhases, ...allMembers, ...allConsultants, ...allLinks].map((x) => x.id);
  const types = ["project_phase", "project_member", "consultant", "project_contact", ...(financial ? ["invoice"] : [])];
  const logRows = await db
    .select({
      id: activityLog.id,
      at: activityLog.createdAt,
      entityType: activityLog.entityType,
      entityId: activityLog.entityId,
      action: activityLog.action,
      changes: activityLog.changes,
      actorInitials: users.initials,
      actorFirst: users.firstName,
      actorLast: users.lastName,
    })
    .from(activityLog)
    .leftJoin(users, eq(users.id, activityLog.actorUserId))
    .where(
      or(
        and(eq(activityLog.entityType, "project"), eq(activityLog.entityId, p.id)),
        childIds.length ? and(inArray(activityLog.entityType, types), inArray(activityLog.entityId, childIds)) : undefined,
      ),
    )
    .orderBy(desc(activityLog.createdAt))
    .limit(10);
  const labelOf = new Map<string, string>([
    ...allPhases.map((x) => [x.id, x.label] as [string, string]),
    ...allMembers.map((x) => [x.id, x.initials || initialsFrom(fullName(x))] as [string, string]),
    ...allConsultants.map((x) => [x.id, x.label] as [string, string]),
    ...allLinks.map((x) => [x.id, x.label] as [string, string]),
  ]);
  const activity: ActivityItem[] = logRows.map((r) => ({
    id: r.id,
    at: r.at.toISOString(),
    actor: r.actorInitials || (r.actorFirst !== null ? initialsFrom(`${r.actorFirst} ${r.actorLast ?? ""}`) : "System"),
    entityType: r.entityType,
    action: r.action,
    label: labelOf.get(r.entityId) ?? "",
    // The basic view never gets field values, only which fields changed.
    changes: (r.changes as Record<string, unknown> | null) && financial
      ? (r.changes as Record<string, unknown>)
      : r.changes
        ? Object.fromEntries(
            Object.entries(r.changes as Record<string, unknown>)
              .filter(([k]) => !MONEY_FIELDS.has(k))
              .map(([k, v]) => [k, k === "status" ? v : null]),
          )
        : null,
  }));

  const personRef = (membershipId: string) => {
    const m = nameOf.get(membershipId);
    return m ? { membershipId, name: fullName(m) } : null;
  };

  let edit: ProjectPage["edit"];
  if (canEdit) {
    const people = await activePeople(db);
    const [settings] = await db.select({ markup: firmSettings.defaultConsultantMarkupBp }).from(firmSettings);
    const titles = await db
      .select({ id: memberships.id, title: memberships.title })
      .from(memberships)
      .where(inArray(memberships.id, people.map((x) => x.membershipId).length ? people.map((x) => x.membershipId) : [p.pmMembershipId]));
    const titleOf = new Map(titles.map((t) => [t.id, t.title]));
    edit = {
      clientContactId: p.clientContactId,
      principals: principalChoices(people).map(({ membershipId, name }) => ({ membershipId, name })),
      pms: pmChoices(people).map(({ membershipId, name }) => ({ membershipId, name })),
      people: people.map(({ membershipId, name }) => ({ membershipId, name, title: titleOf.get(membershipId) ?? null })),
      defaultMarkupBp: settings?.markup ?? 1000,
    };
  }

  let phaseEdit: ProjectPage["phaseEdit"];
  if (canEdit && financial && firm) {
    const rates = await billRates(db, firm.id, todayIn(firm.timezone));
    const templates = await db
      .select()
      .from(phaseTemplates)
      .where(isNull(phaseTemplates.archivedAt))
      .orderBy(asc(phaseTemplates.sortOrder));
    const mixes = await templateMixes(db);
    phaseEdit = {
      loadedAt,
      roles: rates.roles,
      blendedBillRateCents: rates.blended,
      optionalTemplates: templates
        .filter((t) => t.isOptional)
        .map((t) => ({ id: t.id, code: t.code, name: t.name, description: t.description, feeType: t.defaultFeeType, mix: mixes.get(t.id) ?? [] })),
      templateShareByCode: Object.fromEntries(templates.filter((t) => !t.isOptional).map((t) => [t.code.toLowerCase(), t.defaultFeeShareBp])),
    };
  }

  return {
    phaseEdit,
    id: p.id,
    number: p.number,
    name: p.name,
    status: p.status,
    projectType: p.projectType,
    scopeKind: p.scopeKind,
    squareFeet: p.squareFeet,
    constructionCostCents: p.constructionCostCents,
    address: {
      addressLine1: p.addressLine1,
      addressLine2: p.addressLine2,
      city: p.city,
      state: p.state,
      postalCode: p.postalCode,
    },
    startDate: p.startDate,
    targetEndDate: p.targetEndDate,
    client: client ?? { id: p.clientCompanyId, name: "—" },
    clientContact: clientContact
      ? { id: clientContact.id, name: contactName(clientContact), title: clientContact.title, email: clientContact.email }
      : null,
    principal: personRef(p.principalMembershipId),
    pm: personRef(p.pmMembershipId),
    phaseText: phaseText(p.status, phaseRows),
    phases,
    team,
    consultants: consultantList,
    linked,
    activity,
    money,
    financial,
    canEdit,
    canSetOverride,
    edit,
  };
}

// ---------------------------------------------------------------------------
// Company pickers on the project page

export type CompanyChoice = { id: string; name: string; kind: string; contacts: { id: string; name: string }[] };

/** Consultant companies, and contractors / agencies / vendors / other. */
export async function loadCompanyChoices(db: TenantDb): Promise<{ consultants: CompanyChoice[]; linkable: CompanyChoice[] }> {
  const rows = await db
    .select({ id: companies.id, name: companies.name, kind: companies.kind })
    .from(companies)
    .where(and(isNull(companies.archivedAt), inArray(companies.kind, ["consultant", "contractor", "agency", "vendor", "other"])))
    .orderBy(asc(companies.name));
  const people = rows.length
    ? await db
        .select({ id: contacts.id, companyId: contacts.companyId, firstName: contacts.firstName, lastName: contacts.lastName })
        .from(contacts)
        .where(and(isNull(contacts.archivedAt), inArray(contacts.companyId, rows.map((r) => r.id))))
        .orderBy(asc(contacts.lastName), asc(contacts.firstName))
    : [];
  const choices = rows.map((r) => ({
    ...r,
    contacts: people.filter((c) => c.companyId === r.id).map((c) => ({ id: c.id, name: contactName(c) })),
  }));
  return {
    consultants: choices.filter((c) => c.kind === "consultant"),
    linkable: choices.filter((c) => c.kind !== "consultant"),
  };
}
