import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { activityLog, companies, contacts, projects } from "@/db/schema";
import { type TenantDb, withFirm } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import {
  CONTACT_MESSAGES,
  companySchema,
  contactSchema,
  fieldErrorsOf,
} from "@/lib/contacts/form";
import {
  type ActionResult,
  SAVE_FAILED_MESSAGE,
  type SettingsActor,
} from "@/server/settings/common";

// Contacts actions (contacts spec, Actions; rule 12). Create and edit:
// owners, admins and PMs. Archive: owners and admins. Every write logs to
// activity_log with before/after.

export const contactsForbidden = { ok: false, error: CONTACT_MESSAGES.forbidden } as const;

class Refused extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

function refusedResult(err: unknown, what: string) {
  if (err instanceof Refused)
    return err.field
      ? ({ ok: false, fieldErrors: { [err.field]: err.message } } as const)
      : ({ ok: false, error: err.message } as const);
  console.error(`${what} failed`, err);
  return { ok: false, error: SAVE_FAILED_MESSAGE } as const;
}

function log(
  db: TenantDb,
  actor: SettingsActor,
  entityType: "company" | "contact",
  entityId: string,
  action: string,
  changes: Record<string, unknown>,
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
function diff<T extends Record<string, unknown>>(before: T | null, after: Partial<T>) {
  const out: Record<string, { before: unknown; after: unknown }> = {};
  for (const [k, v] of Object.entries(after)) {
    const was = before ? before[k] : null;
    if (JSON.stringify(was) !== JSON.stringify(v)) out[k] = { before: was, after: v };
  }
  return out;
}

async function activeCompany(db: TenantDb, id: string) {
  const [row] = await db
    .select()
    .from(companies)
    .where(and(eq(companies.id, id), isNull(companies.archivedAt)))
    .for("update");
  return row ?? null;
}

/** Open projects (pursuit, active, on hold) where this company is the client. */
async function openProjectsAsClient(db: TenantDb, companyId: string): Promise<number> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.clientCompanyId, companyId),
        isNull(projects.archivedAt),
        inArray(projects.status, ["pursuit", "active", "on_hold"]),
      ),
    );
  return rows.length;
}

// ---------- Company ----------

export type SaveResult = ActionResult<string, { id: string }>;

export async function saveCompanyCore(actor: SettingsActor, raw: unknown): Promise<SaveResult> {
  if (!can(actor.member, "contacts.edit")) return contactsForbidden;
  const parsed = companySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error.issues) };
  const { id: companyId, ...input } = parsed.data;
  // Only clients have a billing contact and billing email.
  if (input.kind !== "client") {
    input.billingContactId = null;
    input.billingEmail = null;
  }

  try {
    const id = await withFirm(actor.firmId, async (db) => {
      const before = companyId ? await activeCompany(db, companyId) : null;
      if (companyId && !before) throw new Refused(CONTACT_MESSAGES.notFound);

      // Main and billing contacts must work here (and only exist once the
      // company does).
      for (const field of ["primaryContactId", "billingContactId"] as const) {
        const contactId = input[field];
        if (!contactId) continue;
        const [c] = before
          ? await db
              .select({ id: contacts.id })
              .from(contacts)
              .where(
                and(
                  eq(contacts.id, contactId),
                  eq(contacts.companyId, before.id),
                  isNull(contacts.archivedAt),
                ),
              )
          : [];
        if (!c) throw new Refused(CONTACT_MESSAGES.wrongCompanyContact, field);
      }

      if (before) {
        const changes = diff(before, input);
        if (Object.keys(changes).length > 0) {
          await db.update(companies).set(input).where(eq(companies.id, before.id));
          await log(db, actor, "company", before.id, "updated", changes);
        }
        return before.id;
      }
      const [created] = await db
        .insert(companies)
        .values({ ...input, firmId: actor.firmId, createdBy: actor.userId })
        .returning({ id: companies.id });
      await log(db, actor, "company", created.id, "created", diff(null, input));
      return created.id;
    });
    return { ok: true, data: { id } };
  } catch (err) {
    return refusedResult(err, "saveCompany");
  }
}

export async function archiveCompanyCore(
  actor: SettingsActor,
  rawId: unknown,
): Promise<ActionResult<never, { name: string }>> {
  if (!can(actor.member, "contacts.archive")) return contactsForbidden;
  const id = companySchema.shape.id.safeParse(rawId);
  if (!id.success || !id.data) return { ok: false, error: CONTACT_MESSAGES.notFound };

  try {
    const name = await withFirm(actor.firmId, async (db) => {
      const company = await activeCompany(db, id.data!);
      if (!company) throw new Refused(CONTACT_MESSAGES.notFound);
      const open = await openProjectsAsClient(db, company.id);
      if (open > 0) throw new Refused(CONTACT_MESSAGES.openProjects(open));
      await db
        .update(companies)
        .set({ archivedAt: new Date() })
        .where(eq(companies.id, company.id));
      await log(db, actor, "company", company.id, "archived", { name: company.name });
      return company.name;
    });
    return { ok: true, data: { name } };
  } catch (err) {
    return refusedResult(err, "archiveCompany");
  }
}

// ---------- Contact ----------

export async function saveContactCore(actor: SettingsActor, raw: unknown): Promise<SaveResult> {
  if (!can(actor.member, "contacts.edit")) return contactsForbidden;
  const parsed = contactSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error.issues) };
  const { id: contactId, isMain, isBilling, ...input } = parsed.data;

  try {
    const id = await withFirm(actor.firmId, async (db) => {
      const [before] = contactId
        ? await db
            .select()
            .from(contacts)
            .where(and(eq(contacts.id, contactId), isNull(contacts.archivedAt)))
            .for("update")
        : [];
      if (contactId && !before) throw new Refused(CONTACT_MESSAGES.contactNotFound);

      const company = input.companyId ? await activeCompany(db, input.companyId) : null;
      if (input.companyId && !company) throw new Refused(CONTACT_MESSAGES.notFound, "companyId");

      let id: string;
      if (before) {
        id = before.id;
        const changes = diff(before, input);
        if (Object.keys(changes).length > 0) {
          await db.update(contacts).set(input).where(eq(contacts.id, id));
          await log(db, actor, "contact", id, "updated", changes);
        }
        // Moved to another company: the old one can't keep them as its
        // main or billing contact.
        if (before.companyId && before.companyId !== input.companyId) {
          const old = await activeCompany(db, before.companyId);
          if (old && (old.primaryContactId === id || old.billingContactId === id)) {
            const set = {
              ...(old.primaryContactId === id && { primaryContactId: null }),
              ...(old.billingContactId === id && { billingContactId: null }),
            };
            await db.update(companies).set(set).where(eq(companies.id, old.id));
            await log(db, actor, "company", old.id, "updated", diff(old, set));
          }
        }
      } else {
        const [created] = await db
          .insert(contacts)
          .values({ ...input, firmId: actor.firmId, createdBy: actor.userId })
          .returning({ id: contacts.id });
        id = created.id;
        await log(db, actor, "contact", id, "created", diff(null, input));
      }

      // "Main contact for X" / "Billing contact for X" set the company's
      // links in the same transaction (billing only for clients).
      if (company) {
        const set: { primaryContactId?: string | null; billingContactId?: string | null } = {};
        if (isMain && company.primaryContactId !== id) set.primaryContactId = id;
        if (!isMain && company.primaryContactId === id) set.primaryContactId = null;
        const billing = isBilling && company.kind === "client";
        if (billing && company.billingContactId !== id) set.billingContactId = id;
        if (!billing && company.billingContactId === id) set.billingContactId = null;
        if (Object.keys(set).length > 0) {
          await db.update(companies).set(set).where(eq(companies.id, company.id));
          await log(db, actor, "company", company.id, "updated", diff(company, set));
        }
      }
      return id;
    });
    return { ok: true, data: { id } };
  } catch (err) {
    return refusedResult(err, "saveContact");
  }
}

export async function archiveContactCore(
  actor: SettingsActor,
  rawId: unknown,
): Promise<ActionResult<never, { name: string }>> {
  if (!can(actor.member, "contacts.archive")) return contactsForbidden;
  const id = contactSchema.shape.id.safeParse(rawId);
  if (!id.success || !id.data) return { ok: false, error: CONTACT_MESSAGES.contactNotFound };

  try {
    const name = await withFirm(actor.firmId, async (db) => {
      const [contact] = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, id.data!), isNull(contacts.archivedAt)))
        .for("update");
      if (!contact) throw new Refused(CONTACT_MESSAGES.contactNotFound);
      const name = `${contact.firstName} ${contact.lastName}`.trim();

      const linked = await db
        .select()
        .from(companies)
        .where(
          and(
            isNull(companies.archivedAt),
            or(
              eq(companies.billingContactId, contact.id),
              eq(companies.primaryContactId, contact.id),
            ),
          ),
        );
      const billingFor = linked.find((c) => c.billingContactId === contact.id);
      if (billingFor) throw new Refused(CONTACT_MESSAGES.billingArchive(billingFor.name));
      // Being someone's main contact doesn't block archiving; it just clears.
      for (const c of linked) {
        await db.update(companies).set({ primaryContactId: null }).where(eq(companies.id, c.id));
        await log(db, actor, "company", c.id, "updated", {
          primaryContactId: { before: contact.id, after: null },
        });
      }
      await db
        .update(contacts)
        .set({ archivedAt: new Date() })
        .where(eq(contacts.id, contact.id));
      await log(db, actor, "contact", contact.id, "archived", { name });
      return name;
    });
    return { ok: true, data: { name } };
  } catch (err) {
    return refusedResult(err, "archiveContact");
  }
}
