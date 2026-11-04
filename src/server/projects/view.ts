import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  companies,
  contacts,
  memberships,
  phaseTemplates,
  projectMembers,
  projectPhases,
  projects,
  users,
} from "@/db/schema";
import type { TenantDb } from "@/db/tenant";
import { type AppRole, can } from "@/lib/auth/permissions";
import {
  type BilledLine,
  type FeeType,
  type Health,
  type PhaseStatus,
  type ProjectStatus,
  billedPct,
  nextProjectNumber,
  phaseText,
  projectBilled,
  projectFee,
  projectHealth,
} from "@/lib/calc/projects";
import { blendedBillRateCents } from "@/lib/calc/rates";
import { todayIn } from "@/lib/format";
import { loadRates } from "@/server/settings/rates";
import { templateMixes } from "./roles";
import { initials } from "@/lib/initials";
import type { ScopeKind } from "@/lib/projects/form";

// Projects list and New project data (projects-list spec). Who sees what:
// - staff only get projects they're assigned to, and no money at all;
// - PMs get every project, but fee, billed and health only on their own;
// - owners and admins get everything plus the KPI band.
// Hidden values are left out here, on the server, never just hidden in the UI.

export type Viewer = { appRole: AppRole; active: boolean; membershipId: string };

export type Person = { membershipId: string; name: string; lastName: string; initials: string };

export type ProjectRow = {
  id: string;
  number: string;
  name: string;
  clientName: string;
  projectType: string;
  scopeKind: ScopeKind | null;
  status: ProjectStatus;
  /** Phase stepper, in order. */
  steps: PhaseStatus[];
  phaseText: string;
  pm: Person | null;
  constructionCostCents: number | null;
  /** Only when the viewer may see this project's money. */
  money?: { feeCents: number; billedCents: number; billedPct: number | null; health: Health };
};

export type ProjectsView = {
  rows: ProjectRow[];
  counts: Record<ProjectStatus, number>;
  /** Fee, Billed and Health columns exist at all (not for staff). */
  showMoneyColumns: boolean;
  /** Owner/admin only. */
  kpis?: { activeFeesCents: number; billedCents: number; activeCount: number; flagged: number };
  canCreate: boolean;
  types: string[];
  pms: Person[];
};

const nameOf = (u: { firstName: string; lastName: string; email: string }) =>
  `${u.firstName} ${u.lastName}`.trim() || u.email;

const personOf = (u: {
  membershipId: string;
  firstName: string;
  lastName: string;
  email: string;
  initials: string;
}): Person => ({
  membershipId: u.membershipId,
  name: nameOf(u),
  lastName: u.lastName || nameOf(u),
  initials: u.initials || initials(nameOf(u)),
});

/** Hours logged per phase. Time entries arrive in 1.6; until then none. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- reads time_entries from 1.6
async function usedHoursByPhase(db: TenantDb, projectIds: string[]): Promise<Map<string, number>> {
  return new Map();
}

/** Invoice lines per project. Invoices arrive in 1.8; until then none. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- reads invoice_lines from 1.8
async function billedLines(db: TenantDb, projectIds: string[]): Promise<Map<string, BilledLine[]>> {
  return new Map();
}

/** Projects this member is on the team of. */
export async function assignedProjectIds(db: TenantDb, membershipId: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: projectMembers.projectId })
    .from(projectMembers)
    .where(and(eq(projectMembers.membershipId, membershipId), isNull(projectMembers.archivedAt)));
  return new Set(rows.map((r) => r.id));
}

export async function loadProjects(db: TenantDb, viewer: Viewer): Promise<ProjectsView> {
  const staff = !can(viewer, "projects.view");
  const assigned = staff ? await assignedProjectIds(db, viewer.membershipId) : null;

  const all = await db
    .select({
      id: projects.id,
      number: projects.number,
      name: projects.name,
      clientName: companies.name,
      projectType: projects.projectType,
      scopeKind: projects.scopeKind,
      status: projects.status,
      pmMembershipId: projects.pmMembershipId,
      principalMembershipId: projects.principalMembershipId,
      constructionCostCents: projects.constructionCostCents,
    })
    .from(projects)
    .innerJoin(companies, eq(companies.id, projects.clientCompanyId))
    .where(isNull(projects.archivedAt));
  const visible = assigned ? all.filter((p) => assigned.has(p.id)) : all;
  const ids = visible.map((p) => p.id);

  const phases = ids.length
    ? await db
        .select({
          id: projectPhases.id,
          projectId: projectPhases.projectId,
          name: projectPhases.name,
          sortOrder: projectPhases.sortOrder,
          status: projectPhases.status,
          feeType: projectPhases.feeType,
          feeCents: projectPhases.feeCents,
          budgetHours: projectPhases.budgetHours,
        })
        .from(projectPhases)
        .where(and(inArray(projectPhases.projectId, ids), isNull(projectPhases.archivedAt)))
        .orderBy(asc(projectPhases.sortOrder))
    : [];
  const phasesBy = new Map<string, (typeof phases)[number][]>();
  for (const ph of phases) phasesBy.set(ph.projectId, [...(phasesBy.get(ph.projectId) ?? []), ph]);

  const pmIds = [...new Set(visible.map((p) => p.pmMembershipId))];
  const pmRows = pmIds.length
    ? await db
        .select({
          membershipId: memberships.id,
          active: memberships.active,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
          initials: users.initials,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(inArray(memberships.id, pmIds))
    : [];
  const pmBy = new Map(pmRows.map((r) => [r.membershipId, r]));

  const showMoneyColumns = !staff;
  const [used, lines] = showMoneyColumns
    ? await Promise.all([usedHoursByPhase(db, ids), billedLines(db, ids)])
    : [new Map<string, number>(), new Map<string, BilledLine[]>()];

  const rows: ProjectRow[] = visible
    .map((p) => {
      const ph = (phasesBy.get(p.id) ?? []).map((x) => ({
        ...x,
        feeType: x.feeType as FeeType,
        budgetHours: Number(x.budgetHours),
      }));
      const pm = pmBy.get(p.pmMembershipId);
      const row: ProjectRow = {
        id: p.id,
        number: p.number,
        name: p.name,
        clientName: p.clientName,
        projectType: p.projectType,
        scopeKind: p.scopeKind,
        status: p.status,
        steps: ph.map((x) => x.status),
        phaseText: phaseText(p.status, ph),
        pm: pm ? personOf(pm) : null,
        constructionCostCents: p.constructionCostCents,
      };
      const own =
        p.pmMembershipId === viewer.membershipId || p.principalMembershipId === viewer.membershipId;
      if (showMoneyColumns && can(viewer, "projects.view_fees", { isProjectManager: own })) {
        const fee = projectFee(ph);
        const billed = projectBilled(ph, lines.get(p.id) ?? []);
        row.money = {
          feeCents: fee,
          billedCents: billed,
          billedPct: billedPct(billed, fee),
          health: projectHealth(p.status, ph, used),
        };
      }
      return row;
    })
    .sort((a, b) => b.number.localeCompare(a.number, "en", { numeric: true }));

  const counts: Record<ProjectStatus, number> = { active: 0, on_hold: 0, closed: 0, pursuit: 0 };
  for (const r of rows) counts[r.status] += 1;

  let kpis: ProjectsView["kpis"];
  if (can(viewer, "financials.view")) {
    const active = rows.filter((r) => r.status === "active");
    kpis = {
      activeCount: active.length,
      activeFeesCents: active.reduce((n, r) => n + (r.money?.feeCents ?? 0), 0),
      billedCents: active.reduce((n, r) => n + (r.money?.billedCents ?? 0), 0),
      flagged: active.filter((r) => r.money?.health === "at_risk" || r.money?.health === "over_budget")
        .length,
    };
  }

  const types = [...new Set(rows.map((r) => r.projectType))].sort((a, b) =>
    a.localeCompare(b, "en", { sensitivity: "base" }),
  );
  const pms = pmRows
    .filter((r) => r.active)
    .map(personOf)
    .sort((a, b) => a.lastName.localeCompare(b.lastName, "en", { sensitivity: "base" }));

  return {
    rows,
    counts,
    showMoneyColumns,
    kpis,
    canCreate: can(viewer, "projects.create"),
    types,
    pms,
  };
}

// ---------------------------------------------------------------------------
// New project form

export type TemplateRow = {
  id: string;
  code: string;
  name: string;
  feeType: FeeType;
  shareBp: number;
  /** Default role mix (Settings → Phases & fees). */
  mix: { firmRoleId: string; shareBp: number }[];
};

export type NewProjectOptions = {
  suggestedNumber: string;
  clients: { id: string; name: string }[];
  contactsByClient: Record<string, { id: string; name: string }[]>;
  principals: Person[];
  pms: Person[];
  types: string[];
  templates: TemplateRow[];
  /** Firm-wide blended bill rate for budget hours; null if rates aren't set up. Bill only, never cost. */
  blendedBillRateCents: number | null;
  /** Billable roles with today's bill rate (for role mixes). Never cost. */
  roles: { id: string; name: string; billCents: number }[];
};

/** Active people in the firm with their app role and principal flag. */
export async function activePeople(db: TenantDb) {
  const rows = await db
    .select({
      membershipId: memberships.id,
      appRole: memberships.appRole,
      isPrincipal: memberships.isPrincipal,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      initials: users.initials,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.active, true), isNull(memberships.archivedAt)));
  return rows
    .map((r) => ({ ...personOf(r), appRole: r.appRole, isPrincipal: r.isPrincipal }))
    .sort((a, b) => a.lastName.localeCompare(b.lastName, "en", { sensitivity: "base" }));
}

/**
 * Who can be principal in charge: people marked Principal on the Team page
 * (Blake, 2026-11-03). If nobody is marked yet, owners and admins.
 */
export function principalChoices<T extends { appRole: AppRole; isPrincipal: boolean }>(people: T[]): T[] {
  const marked = people.filter((p) => p.isPrincipal);
  return marked.length ? marked : people.filter((p) => p.appRole === "owner" || p.appRole === "admin");
}

export function pmChoices<T extends { appRole: AppRole }>(people: T[]): T[] {
  return people.filter((p) => p.appRole !== "staff");
}

export async function loadNewProjectOptions(
  db: TenantDb,
  firmId: string,
  timezone: string,
): Promise<NewProjectOptions> {
  const [numbers, clientRows, contactRows, people, typeRows, templates] = await Promise.all([
    db.select({ n: projects.number }).from(projects),
    db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(and(eq(companies.kind, "client"), isNull(companies.archivedAt)))
      .orderBy(asc(companies.name)),
    db
      .select({
        id: contacts.id,
        companyId: contacts.companyId,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
      })
      .from(contacts)
      .where(isNull(contacts.archivedAt))
      .orderBy(asc(contacts.lastName), asc(contacts.firstName)),
    activePeople(db),
    db.selectDistinct({ t: projects.projectType }).from(projects),
    db
      .select({
        id: phaseTemplates.id,
        code: phaseTemplates.code,
        name: phaseTemplates.name,
        feeType: phaseTemplates.defaultFeeType,
        shareBp: phaseTemplates.defaultFeeShareBp,
      })
      .from(phaseTemplates)
      .where(and(eq(phaseTemplates.isOptional, false), isNull(phaseTemplates.archivedAt)))
      .orderBy(asc(phaseTemplates.sortOrder)),
  ]);

  const today = todayIn(timezone);
  const year = Number(today.slice(0, 4));
  // Only the single blended bill rate leaves this function (Blake,
  // 2026-11-03: PMs may see bill rates; cost stays owner/admin only).
  const rateView = await loadRates(db, firmId, today);
  const mixes = await templateMixes(db);
  const blended = blendedBillRateCents(
    rateView.roles.map((r) => ({ billCents: r.billCents, costCents: r.costCents, people: r.people })),
  );
  const contactsByClient: NewProjectOptions["contactsByClient"] = {};
  for (const c of contactRows) {
    if (!c.companyId) continue;
    (contactsByClient[c.companyId] ??= []).push({
      id: c.id,
      name: `${c.firstName} ${c.lastName}`.trim(),
    });
  }
  const strip = ({ membershipId, name, lastName, initials }: Person) => ({
    membershipId,
    name,
    lastName,
    initials,
  });

  return {
    suggestedNumber: nextProjectNumber(
      numbers.map((r) => r.n),
      year,
    ),
    clients: clientRows,
    contactsByClient,
    principals: principalChoices(people).map(strip),
    pms: pmChoices(people).map(strip),
    types: typeRows.map((r) => r.t),
    templates: templates.map((t) => ({ ...t, feeType: t.feeType as FeeType, mix: mixes.get(t.id) ?? [] })),
    blendedBillRateCents: blended,
    roles: rateView.roles.filter((r) => r.isBillable).map((r) => ({ id: r.id, name: r.name, billCents: r.billCents })),
  };
}
