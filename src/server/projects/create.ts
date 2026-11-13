import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  activityLog,
  companies,
  consultants as consultantsTable,
  contacts,
  memberships,
  phaseTemplates,
  projectMembers,
  projectPhases,
  projects,
} from "@/db/schema";
import { withFirm } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import { PROJECT_MESSAGES, createProjectSchema, fieldErrorsOf } from "@/lib/projects/form";
import {
  type ActionResult,
  SAVE_FAILED_MESSAGE,
  type SettingsActor,
  isUniqueViolation,
} from "@/server/settings/common";
import { todayIn } from "@/lib/format";
import { billRates, writePhaseMix } from "./roles";
import { activePeople, pmChoices, principalChoices } from "./view";

// createProject (projects-list spec, "Save"). Owners, admins and PMs.
// Every check the page makes is made again here.

class Refused extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

export type CreateProjectResult = ActionResult<string, { id: string; number: string }>;

export async function createProjectCore(
  actor: SettingsActor,
  raw: unknown,
  timezone = "America/New_York",
): Promise<CreateProjectResult> {
  if (!can(actor.member, "projects.create")) return { ok: false, error: PROJECT_MESSAGES.forbidden };
  const parsed = createProjectSchema.safeParse(raw);
  if (!parsed.success) {
    // Consultant rows keep their row number ("consultants.1.feeCents") so the page can mark the row.
    const fieldErrors = fieldErrorsOf(parsed.error.issues.filter((i) => i.path[0] !== "consultants"));
    for (const i of parsed.error.issues.filter((x) => x.path[0] === "consultants")) fieldErrors[i.path.join(".")] ??= i.message;
    return { ok: false, fieldErrors };
  }
  const { phases, consultants, totalFeeCents, totalBudgetHours, ...p } = parsed.data;

  try {
    const result = await withFirm(actor.firmId, async (db) => {
      const [taken] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(sql`lower(${projects.number}) = lower(${p.number})`);
      if (taken) throw new Refused(PROJECT_MESSAGES.numberUsed, "number");

      const [client] = await db
        .select({ id: companies.id })
        .from(companies)
        .where(
          and(
            eq(companies.id, p.clientCompanyId),
            eq(companies.kind, "client"),
            isNull(companies.archivedAt),
          ),
        );
      if (!client) throw new Refused(PROJECT_MESSAGES.notClient, "clientCompanyId");

      if (p.clientContactId) {
        const [c] = await db
          .select({ id: contacts.id })
          .from(contacts)
          .where(
            and(
              eq(contacts.id, p.clientContactId),
              eq(contacts.companyId, p.clientCompanyId),
              isNull(contacts.archivedAt),
            ),
          );
        if (!c) throw new Refused(PROJECT_MESSAGES.badContact, "clientContactId");
      }

      const people = await activePeople(db);
      if (!principalChoices(people).some((x) => x.membershipId === p.principalMembershipId))
        throw new Refused(PROJECT_MESSAGES.badPerson, "principalMembershipId");
      if (!pmChoices(people).some((x) => x.membershipId === p.pmMembershipId))
        throw new Refused(PROJECT_MESSAGES.badPerson, "pmMembershipId");

      // Consultants must be the firm's consultant companies, and their contacts.
      const consultantIds = [...new Set(consultants.map((c) => c.companyId))];
      const okCompanies = new Set(
        consultantIds.length
          ? (
              await db
                .select({ id: companies.id })
                .from(companies)
                .where(and(inArray(companies.id, consultantIds), eq(companies.kind, "consultant"), isNull(companies.archivedAt)))
            ).map((r) => r.id)
          : [],
      );
      const contactIds = consultants.flatMap((c) => (c.contactId ? [c.contactId] : []));
      const contactCompany = new Map(
        contactIds.length
          ? (
              await db
                .select({ id: contacts.id, companyId: contacts.companyId })
                .from(contacts)
                .where(and(inArray(contacts.id, contactIds), isNull(contacts.archivedAt)))
            ).map((r) => [r.id, r.companyId])
          : [],
      );
      consultants.forEach((c, i) => {
        if (!okCompanies.has(c.companyId)) throw new Refused(PROJECT_MESSAGES.notConsultant, `consultants.${i}.companyId`);
        if (c.contactId && contactCompany.get(c.contactId) !== c.companyId)
          throw new Refused(PROJECT_MESSAGES.badCompanyContact, `consultants.${i}.contactId`);
      });

      // Descriptions come from the firm's own templates, never the browser.
      const templateIds = phases.flatMap((x) => (x.templateId ? [x.templateId] : []));
      const templates = templateIds.length
        ? await db
            .select({ id: phaseTemplates.id, description: phaseTemplates.description })
            .from(phaseTemplates)
            .where(inArray(phaseTemplates.id, templateIds))
        : [];
      const descriptionOf = new Map(templates.map((t) => [t.id, t.description]));

      const [project] = await db
        .insert(projects)
        .values({ firmId: actor.firmId, ...p, createdBy: actor.userId })
        .returning({ id: projects.id, number: projects.number });

      const created = await db.insert(projectPhases).values(
        phases.map((x, i) => ({
          firmId: actor.firmId,
          projectId: project.id,
          code: x.code,
          name: x.name,
          description: x.templateId ? (descriptionOf.get(x.templateId) ?? null) : null,
          sortOrder: i + 1,
          feeType: x.feeType,
          feeCents: x.feeCents,
          budgetHours: String(x.budgetHours),
          status: p.status === "active" && i === 0 ? ("current" as const) : ("upcoming" as const),
          budgetHoursManual: x.budgetHoursManual,
        })),
      ).returning({ id: projectPhases.id, sortOrder: projectPhases.sortOrder });

      // Role mixes: today's bill rates and the hours they give are saved.
      if (phases.some((x) => x.mix.length)) {
        const { roles } = await billRates(db, actor.firmId, todayIn(timezone));
        const rates = new Map(roles.map((r) => [r.id, r.billCents]));
        for (const row of created) {
          const x = phases[row.sortOrder - 1];
          if (x.mix.length) await writePhaseMix(db, actor.firmId, row.id, x.feeCents, x.mix, rates);
        }
      }

      // Consultant fees (separate from the architectural fee), each logged.
      if (consultants.length) {
        const added = await db
          .insert(consultantsTable)
          .values(consultants.map((c) => ({ firmId: actor.firmId, projectId: project.id, ...c })))
          .returning({ id: consultantsTable.id });
        for (const [i, row] of added.entries())
          await db.insert(activityLog).values({
            firmId: actor.firmId,
            actorUserId: actor.userId,
            entityType: "consultant",
            entityId: row.id,
            action: "created",
            changes: consultants[i],
          });
      }

      // The PM and principal join the team with their own roles (ADR 0008).
      const members = [...new Set([p.pmMembershipId, p.principalMembershipId])];
      const own = await db
        .select({ membershipId: memberships.id, firmRoleId: memberships.firmRoleId })
        .from(memberships)
        .where(inArray(memberships.id, members));
      await db.insert(projectMembers).values(
        members.map((membershipId) => ({
          firmId: actor.firmId,
          projectId: project.id,
          membershipId,
          firmRoleId: own.find((o) => o.membershipId === membershipId)?.firmRoleId ?? null,
        })),
      );

      await db.insert(activityLog).values({
        firmId: actor.firmId,
        actorUserId: actor.userId,
        entityType: "project",
        entityId: project.id,
        action: "created",
        changes: {
          number: p.number,
          name: p.name,
          status: p.status,
          phaseCount: phases.length,
          consultantCount: consultants.length,
          totalFeeCents,
          totalBudgetHours,
        },
      });
      return project;
    });
    return { ok: true, data: result };
  } catch (err) {
    if (err instanceof Refused)
      return err.field
        ? { ok: false, fieldErrors: { [err.field]: err.message } }
        : { ok: false, error: err.message };
    // Two people saving the same number at once: the unique index catches it.
    if (isUniqueViolation(err)) return { ok: false, fieldErrors: { number: PROJECT_MESSAGES.numberUsed } };
    console.error("createProject failed", err);
    return { ok: false, error: SAVE_FAILED_MESSAGE };
  }
}
