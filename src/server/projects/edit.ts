import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  activityLog,
  companies,
  consultants,
  contacts,
  projectContacts,
  projectMembers,
  projects,
} from "@/db/schema";
import { type TenantDb, withFirm } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import { todayIn } from "@/lib/format";
import {
  PROJECT_MESSAGES,
  consultantSchema,
  fieldErrorsOf,
  linkSchema,
  memberSchema,
  updateProjectSchema,
} from "@/lib/projects/form";
import {
  type ActionResult,
  SAVE_FAILED_MESSAGE,
  type SettingsActor,
  isUniqueViolation,
} from "@/server/settings/common";
import { activePeople, pmChoices, principalChoices } from "./view";

// Editing a project, its team, consultants and linked companies
// (project-detail spec, Actions). Owners, admins, and PMs on their own
// projects (PM or principal). Every write logs to activity_log with
// before/after.

class Refused extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

type Result<D = { id: string }> = ActionResult<string, D>;

function fail(err: unknown, what: string): Result<never> {
  if (err instanceof Refused)
    return err.field ? { ok: false, fieldErrors: { [err.field]: err.message } } : { ok: false, error: err.message };
  console.error(`${what} failed`, err);
  return { ok: false, error: SAVE_FAILED_MESSAGE };
}

function log(
  db: TenantDb,
  actor: SettingsActor,
  entityType: string,
  entityId: string,
  action: string,
  changes: Record<string, unknown> | null,
) {
  return db.insert(activityLog).values({
    firmId: actor.firmId,
    actorUserId: actor.userId,
    entityType,
    entityId,
    action,
    changes,
  });
}

/** { field: { before, after } } for fields that changed. */
function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const out: Record<string, { before: unknown; after: unknown }> = {};
  for (const [k, v] of Object.entries(after)) {
    if (JSON.stringify(before[k] ?? null) !== JSON.stringify(v ?? null)) out[k] = { before: before[k] ?? null, after: v };
  }
  return out;
}

/** Load the project and check this person may edit it. */
async function editable(db: TenantDb, actor: SettingsActor, projectId: string) {
  const [p] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.archivedAt)))
    .for("update");
  if (!p) throw new Refused(PROJECT_MESSAGES.notFound);
  const own = p.pmMembershipId === actor.member.membershipId || p.principalMembershipId === actor.member.membershipId;
  if (!can(actor.member, "projects.edit", { isProjectManager: own })) throw new Refused(PROJECT_MESSAGES.editForbidden);
  return p;
}

async function ensureMember(db: TenantDb, actor: SettingsActor, projectId: string, membershipId: string, role: string) {
  const [row] = await db
    .select({ id: projectMembers.id })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.membershipId, membershipId), isNull(projectMembers.archivedAt)));
  if (row) return;
  const [added] = await db
    .insert(projectMembers)
    .values({ firmId: actor.firmId, projectId, membershipId, projectRole: role })
    .returning({ id: projectMembers.id });
  await log(db, actor, "project_member", added.id, "created", { membershipId, projectRole: role });
}

// ---------- Edit project ----------

export async function updateProjectCore(actor: SettingsActor, raw: unknown, timezone: string): Promise<Result> {
  const parsed = updateProjectSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error.issues) };
  const { id, ...v } = parsed.data;
  try {
    await withFirm(actor.firmId, async (db) => {
      const before = await editable(db, actor, id);

      const [taken] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(sql`lower(${projects.number}) = lower(${v.number})`, ne(projects.id, id)));
      if (taken) throw new Refused(PROJECT_MESSAGES.numberUsed, "number");

      const [client] = await db
        .select({ id: companies.id })
        .from(companies)
        .where(and(eq(companies.id, v.clientCompanyId), eq(companies.kind, "client"), isNull(companies.archivedAt)));
      if (!client) throw new Refused(PROJECT_MESSAGES.notClient, "clientCompanyId");
      if (v.clientContactId) {
        const [c] = await db
          .select({ id: contacts.id })
          .from(contacts)
          .where(and(eq(contacts.id, v.clientContactId), eq(contacts.companyId, v.clientCompanyId), isNull(contacts.archivedAt)));
        if (!c) throw new Refused(PROJECT_MESSAGES.badContact, "clientContactId");
      }
      const people = await activePeople(db);
      // Keeping the current person is always fine, even if they'd no longer be offered.
      if (v.principalMembershipId !== before.principalMembershipId && !principalChoices(people).some((x) => x.membershipId === v.principalMembershipId))
        throw new Refused(PROJECT_MESSAGES.badPerson, "principalMembershipId");
      if (v.pmMembershipId !== before.pmMembershipId && !pmChoices(people).some((x) => x.membershipId === v.pmMembershipId))
        throw new Refused(PROJECT_MESSAGES.badPerson, "pmMembershipId");

      // closed_on follows the status.
      const closedOn =
        v.status === "closed" ? (before.status === "closed" ? before.closedOn : todayIn(timezone)) : null;
      const after = { ...v, closedOn };
      const changes = diff(before as unknown as Record<string, unknown>, after);
      if (Object.keys(changes).length === 0) return;
      await db.update(projects).set(after).where(eq(projects.id, id));

      // A new PM or principal joins the team; the old one stays a member.
      if (v.pmMembershipId !== before.pmMembershipId) await ensureMember(db, actor, id, v.pmMembershipId, "PM");
      if (v.principalMembershipId !== before.principalMembershipId)
        await ensureMember(db, actor, id, v.principalMembershipId, "Principal");

      await log(db, actor, "project", id, changes.status ? "status_changed" : "updated", changes);
    });
    return { ok: true, data: { id } };
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, fieldErrors: { number: PROJECT_MESSAGES.numberUsed } };
    return fail(err, "updateProject");
  }
}

// ---------- Team ----------

export async function saveMemberCore(actor: SettingsActor, raw: unknown): Promise<Result> {
  const parsed = memberSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error.issues) };
  const v = parsed.data;
  // Rate overrides: owners and admins only (rule 4). Sending one is refused.
  if (v.billRateOverrideCents !== undefined && !can(actor.member, "projects.rate_override"))
    return { ok: false, error: PROJECT_MESSAGES.editForbidden };
  try {
    const id = await withFirm(actor.firmId, async (db) => {
      await editable(db, actor, v.projectId);
      if (v.id) {
        const [before] = await db
          .select()
          .from(projectMembers)
          .where(and(eq(projectMembers.id, v.id), eq(projectMembers.projectId, v.projectId), isNull(projectMembers.archivedAt)));
        if (!before) throw new Refused(PROJECT_MESSAGES.notFound);
        const after: Record<string, unknown> = { projectRole: v.projectRole };
        if (v.billRateOverrideCents !== undefined) after.billRateOverrideCents = v.billRateOverrideCents;
        const changes = diff(before as unknown as Record<string, unknown>, after);
        if (Object.keys(changes).length) {
          await db.update(projectMembers).set(after).where(eq(projectMembers.id, v.id));
          await log(db, actor, "project_member", v.id, "updated", changes);
        }
        return v.id;
      }
      const people = await activePeople(db);
      if (!people.some((x) => x.membershipId === v.membershipId)) throw new Refused(PROJECT_MESSAGES.badPerson, "membershipId");
      const [dupe] = await db
        .select({ id: projectMembers.id })
        .from(projectMembers)
        .where(and(eq(projectMembers.projectId, v.projectId), eq(projectMembers.membershipId, v.membershipId), isNull(projectMembers.archivedAt)));
      if (dupe) throw new Refused(PROJECT_MESSAGES.alreadyOnTeam, "membershipId");
      const [row] = await db
        .insert(projectMembers)
        .values({
          firmId: actor.firmId,
          projectId: v.projectId,
          membershipId: v.membershipId,
          projectRole: v.projectRole,
          billRateOverrideCents: v.billRateOverrideCents ?? null,
        })
        .returning({ id: projectMembers.id });
      await log(db, actor, "project_member", row.id, "created", { membershipId: v.membershipId, projectRole: v.projectRole });
      return row.id;
    });
    return { ok: true, data: { id } };
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, fieldErrors: { membershipId: PROJECT_MESSAGES.alreadyOnTeam } };
    return fail(err, "saveMember");
  }
}

const ids = z.object({ projectId: z.uuid(), id: z.uuid() });

export async function removeMemberCore(actor: SettingsActor, raw: unknown): Promise<Result> {
  const parsed = ids.safeParse(raw);
  if (!parsed.success) return { ok: false, error: PROJECT_MESSAGES.notFound };
  const { projectId, id } = parsed.data;
  try {
    await withFirm(actor.firmId, async (db) => {
      const p = await editable(db, actor, projectId);
      const [row] = await db
        .select()
        .from(projectMembers)
        .where(and(eq(projectMembers.id, id), eq(projectMembers.projectId, projectId), isNull(projectMembers.archivedAt)));
      if (!row) throw new Refused(PROJECT_MESSAGES.notFound);
      if (row.membershipId === p.pmMembershipId || row.membershipId === p.principalMembershipId)
        throw new Refused(PROJECT_MESSAGES.keepPmPrincipal);
      // Logged time stays; only the team row is archived.
      await db.update(projectMembers).set({ archivedAt: new Date() }).where(eq(projectMembers.id, id));
      await log(db, actor, "project_member", id, "archived", { membershipId: row.membershipId });
    });
    return { ok: true, data: { id } };
  } catch (err) {
    return fail(err, "removeMember");
  }
}

// ---------- Consultants ----------

async function checkContact(db: TenantDb, companyId: string, contactId: string | null) {
  if (!contactId) return;
  const [c] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.companyId, companyId), isNull(contacts.archivedAt)));
  if (!c) throw new Refused(PROJECT_MESSAGES.badCompanyContact, "contactId");
}

export async function saveConsultantCore(actor: SettingsActor, raw: unknown): Promise<Result> {
  const parsed = consultantSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error.issues) };
  const { id: consultantId, projectId, ...v } = parsed.data;
  try {
    const id = await withFirm(actor.firmId, async (db) => {
      await editable(db, actor, projectId);
      const [co] = await db
        .select({ id: companies.id })
        .from(companies)
        .where(and(eq(companies.id, v.companyId), eq(companies.kind, "consultant"), isNull(companies.archivedAt)));
      if (!co) throw new Refused(PROJECT_MESSAGES.notConsultant, "companyId");
      await checkContact(db, v.companyId, v.contactId);
      if (consultantId) {
        const [before] = await db
          .select()
          .from(consultants)
          .where(and(eq(consultants.id, consultantId), eq(consultants.projectId, projectId), isNull(consultants.archivedAt)));
        if (!before) throw new Refused(PROJECT_MESSAGES.notFound);
        const changes = diff(before as unknown as Record<string, unknown>, v);
        if (Object.keys(changes).length) {
          await db.update(consultants).set(v).where(eq(consultants.id, consultantId));
          await log(db, actor, "consultant", consultantId, "updated", changes);
        }
        return consultantId;
      }
      const [row] = await db
        .insert(consultants)
        .values({ firmId: actor.firmId, projectId, ...v })
        .returning({ id: consultants.id });
      await log(db, actor, "consultant", row.id, "created", v);
      return row.id;
    });
    return { ok: true, data: { id } };
  } catch (err) {
    return fail(err, "saveConsultant");
  }
}

export async function removeConsultantCore(actor: SettingsActor, raw: unknown): Promise<Result> {
  const parsed = ids.safeParse(raw);
  if (!parsed.success) return { ok: false, error: PROJECT_MESSAGES.notFound };
  const { projectId, id } = parsed.data;
  try {
    await withFirm(actor.firmId, async (db) => {
      await editable(db, actor, projectId);
      const [row] = await db
        .update(consultants)
        .set({ archivedAt: new Date() })
        .where(and(eq(consultants.id, id), eq(consultants.projectId, projectId), isNull(consultants.archivedAt)))
        .returning({ discipline: consultants.discipline });
      if (!row) throw new Refused(PROJECT_MESSAGES.notFound);
      await log(db, actor, "consultant", id, "archived", { discipline: row.discipline });
    });
    return { ok: true, data: { id } };
  } catch (err) {
    return fail(err, "removeConsultant");
  }
}

// ---------- Contractors, agencies, vendors ----------

const LINKABLE = ["contractor", "agency", "vendor", "other"] as const;

export async function addLinkCore(actor: SettingsActor, raw: unknown): Promise<Result> {
  const parsed = linkSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error.issues) };
  const { projectId, ...v } = parsed.data;
  try {
    const id = await withFirm(actor.firmId, async (db) => {
      await editable(db, actor, projectId);
      const [co] = await db
        .select({ id: companies.id, kind: companies.kind })
        .from(companies)
        .where(and(eq(companies.id, v.companyId), isNull(companies.archivedAt)));
      if (!co || !(LINKABLE as readonly string[]).includes(co.kind)) throw new Refused(PROJECT_MESSAGES.notLinkable, "companyId");
      await checkContact(db, v.companyId, v.contactId);
      const [dupe] = await db
        .select({ id: projectContacts.id })
        .from(projectContacts)
        .where(and(eq(projectContacts.projectId, projectId), eq(projectContacts.companyId, v.companyId), isNull(projectContacts.archivedAt)));
      if (dupe) throw new Refused(PROJECT_MESSAGES.alreadyLinked, "companyId");
      const [row] = await db
        .insert(projectContacts)
        .values({ firmId: actor.firmId, projectId, ...v })
        .returning({ id: projectContacts.id });
      await log(db, actor, "project_contact", row.id, "created", v);
      return row.id;
    });
    return { ok: true, data: { id } };
  } catch (err) {
    return fail(err, "addLink");
  }
}

export async function removeLinkCore(actor: SettingsActor, raw: unknown): Promise<Result> {
  const parsed = ids.safeParse(raw);
  if (!parsed.success) return { ok: false, error: PROJECT_MESSAGES.notFound };
  const { projectId, id } = parsed.data;
  try {
    await withFirm(actor.firmId, async (db) => {
      await editable(db, actor, projectId);
      const [row] = await db
        .update(projectContacts)
        .set({ archivedAt: new Date() })
        .where(and(eq(projectContacts.id, id), eq(projectContacts.projectId, projectId), isNull(projectContacts.archivedAt)))
        .returning({ companyId: projectContacts.companyId });
      if (!row) throw new Refused(PROJECT_MESSAGES.notFound);
      await log(db, actor, "project_contact", id, "archived", { companyId: row.companyId });
    });
    return { ok: true, data: { id } };
  } catch (err) {
    return fail(err, "removeLink");
  }
}
