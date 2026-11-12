import { and, count, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  activityLog,
  consultants,
  contacts,
  invoiceExcludedEntries,
  invoiceLines,
  invoices,
  memberships,
  projectPhases,
  timeEntries,
  users,
} from "@/db/schema";
import type { TenantDb } from "@/db/tenant";
import { consultantLastBilledBp, formatPercentBp, invoiceDueDate, lastBilledBp } from "@/lib/calc/invoice";
import { ADJUSTMENT_SORT_BASE, money } from "@/lib/calc/invoice-plan";
import { formatDate } from "@/lib/format";
import {
  INVOICE_MESSAGES,
  adjustmentInput,
  consultantPercentInput,
  createDraftInput,
  entryInput,
  lineInput,
  percentInput,
  returnInput,
  settingsInput,
  versionInput,
} from "@/lib/invoices/builder";
import { notify } from "@/server/notifications/notify";
import type { ActionResult } from "@/server/settings/common";
import {
  type InvoiceActor,
  InvoiceError,
  type InvoiceRow,
  createDraft,
  lineChanges,
  lockForWrite,
  logInvoice,
  recalculate,
  runInvoice,
} from "./draft";
import { linesForProjects } from "./facts";
import { type BuilderView, buildView } from "./view";

// Invoice builder actions (invoicing spec, Actions table). Every one checks
// who's asking on the server, refuses a stale page, recalculates the draft
// and returns the fresh builder view.

type Result = ActionResult<string, BuilderView>;

const bad = (message: string, field?: string): ActionResult<string, never> =>
  field ? { ok: false, error: message, fieldErrors: { [field]: message } } : { ok: false, error: message };

/** First Zod message, keyed by field. */
function invalid(issues: { path: PropertyKey[]; message: string }[]): ActionResult<string, never> {
  const first = issues[0];
  const field = typeof first?.path[0] === "string" ? first.path[0] : undefined;
  return bad(first?.message ?? INVOICE_MESSAGES.notFound, field === "invoiceId" || field === "version" ? undefined : field);
}

/** Lock, change, recalculate, log, and return the view. */
async function edit(
  actor: InvoiceActor,
  what: string,
  invoiceId: string,
  version: string,
  change: (db: TenantDb, inv: InvoiceRow) => Promise<Record<string, unknown> | null>,
): Promise<Result> {
  return runInvoice(actor, what, async (db) => {
    const { inv, access } = await lockForWrite(db, actor, invoiceId, version);
    const changes = await change(db, inv);
    const [fresh] = await db.select().from(invoices).where(eq(invoices.id, inv.id));
    const r = await recalculate(db, fresh);
    const lines = lineChanges(r);
    if (changes || lines) await logInvoice(db, actor, inv.id, "updated", { ...changes, ...lines });
    const [after] = await db.select().from(invoices).where(eq(invoices.id, inv.id));
    return buildView(db, after, access);
  });
}

// ---------------------------------------------------------------------------

/** New invoice: opens the project's draft, or creates one (rule 12). */
export async function createDraftInvoiceCore(actor: InvoiceActor, raw: unknown): Promise<ActionResult<string, { id: string; created: boolean }>> {
  const parsed = createDraftInput.safeParse(raw);
  if (!parsed.success) return bad(INVOICE_MESSAGES.notFound);
  return runInvoice(actor, "createDraftInvoice", (db) => createDraft(db, actor, parsed.data.projectId));
}

/** Period through, issue and due dates, bill-to, memo (Layout C.2). */
export async function updateDraftSettingsCore(actor: InvoiceActor, raw: unknown): Promise<Result> {
  const parsed = settingsInput.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error.issues);
  const v = parsed.data;
  return edit(actor, "updateDraftSettings", v.invoiceId, v.version, async (db, inv) => {
    const next = {
      periodEnd: v.periodEnd ?? inv.periodEnd,
      issueDate: v.issueDate ?? inv.issueDate,
      dueDate: v.dueDate ?? inv.dueDate,
      billToContactId: v.billToContactId === undefined ? inv.billToContactId : v.billToContactId,
      memo: v.memo === undefined ? inv.memo : v.memo.trim() || null,
    };
    // A new issue date moves the due date with it, unless a due date came too (rule 8).
    if (v.issueDate && !v.dueDate && v.issueDate !== inv.issueDate) {
      const shift = (Date.parse(inv.dueDate) - Date.parse(inv.issueDate)) / 86_400_000;
      next.dueDate = invoiceDueDate(v.issueDate, shift);
    }
    if (inv.periodStart && next.periodEnd < inv.periodStart)
      throw new InvoiceError(INVOICE_MESSAGES.periodBeforeStart(formatDate(inv.periodStart)), "periodEnd");
    if (next.dueDate < next.issueDate) throw new InvoiceError(INVOICE_MESSAGES.dueBeforeIssue, "dueDate");
    if (next.billToContactId && next.billToContactId !== inv.billToContactId) {
      const [c] = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          and(eq(contacts.id, next.billToContactId), eq(contacts.companyId, inv.clientCompanyId), isNull(contacts.archivedAt)),
        );
      if (!c) throw new InvoiceError(INVOICE_MESSAGES.billToNotClient, "billToContactId");
    }
    const changes: Record<string, { before: unknown; after: unknown }> = {};
    const before: Record<string, unknown> = {
      periodEnd: inv.periodEnd,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      billToContactId: inv.billToContactId,
      memo: inv.memo,
    };
    for (const [k, after] of Object.entries(next)) if (before[k] !== after) changes[k] = { before: before[k], after };
    if (!Object.keys(changes).length) return null;
    await db.update(invoices).set(next).where(eq(invoices.id, inv.id));
    return changes;
  });
}

/** % complete on a fixed-fee phase: saved on the phase and the line (rule 3). */
export async function setPhasePercentCore(actor: InvoiceActor, raw: unknown): Promise<Result> {
  const parsed = percentInput.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error.issues);
  const v = parsed.data;
  return edit(actor, "setPhasePercent", v.invoiceId, v.version, async (db, inv) => {
    const [phase] = await db
      .select()
      .from(projectPhases)
      .where(
        and(
          eq(projectPhases.id, v.phaseId),
          eq(projectPhases.projectId, inv.projectId),
          eq(projectPhases.feeType, "fixed"),
          isNull(projectPhases.archivedAt),
        ),
      )
      .for("update");
    if (!phase) throw new InvoiceError(INVOICE_MESSAGES.notFixedPhase);
    const last = lastBilledBp(await linesForProjects(db, [inv.projectId]), phase.id, inv.id);
    if (v.percentCompleteBp < last)
      throw new InvoiceError(`% complete is below what's already billed (${formatPercentBp(last)}).`, "percentCompleteBp");
    if (phase.percentCompleteBp === v.percentCompleteBp) return null;
    await db.update(projectPhases).set({ percentCompleteBp: v.percentCompleteBp }).where(eq(projectPhases.id, phase.id));
    await db.insert(activityLog).values({
      firmId: actor.firmId,
      actorUserId: actor.userId,
      entityType: "project_phase",
      entityId: phase.id,
      action: "updated",
      changes: { percent_complete_bp: { before: phase.percentCompleteBp, after: v.percentCompleteBp } },
    });
    return { phase: phase.name, percentCompleteBp: { before: phase.percentCompleteBp, after: v.percentCompleteBp } };
  });
}

/** Tick or untick one time entry (Layout C.5). Unticked ones stay off on Recalculate. */
export async function toggleEntryCore(actor: InvoiceActor, raw: unknown): Promise<Result> {
  const parsed = entryInput.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error.issues);
  const v = parsed.data;
  return edit(actor, "toggleEntry", v.invoiceId, v.version, async (db, inv) => {
    const [entry] = await db
      .select({ id: timeEntries.id, invoiceId: timeEntries.invoiceId, projectId: timeEntries.projectId })
      .from(timeEntries)
      .where(and(eq(timeEntries.id, v.entryId), isNull(timeEntries.archivedAt)));
    const [excluded] = await db
      .select({ id: invoiceExcludedEntries.id })
      .from(invoiceExcludedEntries)
      .where(
        and(
          eq(invoiceExcludedEntries.invoiceId, inv.id),
          eq(invoiceExcludedEntries.timeEntryId, v.entryId),
          isNull(invoiceExcludedEntries.archivedAt),
        ),
      );
    if (!entry || entry.projectId !== inv.projectId || (entry.invoiceId !== inv.id && !excluded))
      throw new InvoiceError(INVOICE_MESSAGES.entryNotHere);
    if (v.include) {
      if (!excluded) return null;
      await db.update(invoiceExcludedEntries).set({ archivedAt: new Date() }).where(eq(invoiceExcludedEntries.id, excluded.id));
      return { entry: { id: v.entryId, included: true } };
    }
    if (excluded) return null;
    await db.insert(invoiceExcludedEntries).values({ firmId: actor.firmId, invoiceId: inv.id, timeEntryId: v.entryId });
    await db.update(timeEntries).set({ invoiceId: null }).where(eq(timeEntries.id, v.entryId));
    return { entry: { id: v.entryId, included: false } };
  });
}

/** Pull in newly approved time and refresh every calculated line. */
export async function recalculateDraftCore(actor: InvoiceActor, raw: unknown): Promise<Result> {
  const parsed = versionInput.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error.issues);
  return edit(actor, "recalculateDraft", parsed.data.invoiceId, parsed.data.version, async () => null);
}

async function nextSort(db: TenantDb, invoiceId: string, base: number) {
  const [row] = await db
    .select({ n: count() })
    .from(invoiceLines)
    .where(and(eq(invoiceLines.invoiceId, invoiceId), isNull(invoiceLines.archivedAt)));
  return base + (row?.n ?? 0);
}

/** A free adjustment on this invoice (no phase): the only kind typed in by hand. */
async function ownAdjustment(db: TenantDb, inv: InvoiceRow, lineId: string) {
  const [line] = await db
    .select()
    .from(invoiceLines)
    .where(and(eq(invoiceLines.id, lineId), eq(invoiceLines.invoiceId, inv.id), isNull(invoiceLines.archivedAt)));
  if (!line || line.lineType !== "adjustment" || line.projectPhaseId !== null)
    throw new InvoiceError(INVOICE_MESSAGES.lineNotRemovable);
  return line;
}

/** % complete on a consultant's fee: saved on the consultant and the line (rule 6, decision #31). */
export async function setConsultantPercentCore(actor: InvoiceActor, raw: unknown): Promise<Result> {
  const parsed = consultantPercentInput.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error.issues);
  const v = parsed.data;
  return edit(actor, "setConsultantPercent", v.invoiceId, v.version, async (db, inv) => {
    const [c] = await db
      .select()
      .from(consultants)
      .where(
        and(
          eq(consultants.id, v.consultantId),
          eq(consultants.projectId, inv.projectId),
          eq(consultants.billedThrough, true),
          isNull(consultants.archivedAt),
        ),
      )
      .for("update");
    if (!c) throw new InvoiceError(INVOICE_MESSAGES.consultantNotBilled);
    const last = consultantLastBilledBp(await linesForProjects(db, [inv.projectId]), c.id, inv.id);
    if (v.percentCompleteBp < last)
      throw new InvoiceError(`% complete is below what's already billed (${formatPercentBp(last)}).`, "percentCompleteBp");
    if (c.percentCompleteBp === v.percentCompleteBp) return null;
    await db.update(consultants).set({ percentCompleteBp: v.percentCompleteBp }).where(eq(consultants.id, c.id));
    await db.insert(activityLog).values({
      firmId: actor.firmId,
      actorUserId: actor.userId,
      entityType: "consultant",
      entityId: c.id,
      action: "updated",
      changes: { percent_complete_bp: { before: c.percentCompleteBp, after: v.percentCompleteBp } },
    });
    return { consultant: c.discipline, percentCompleteBp: { before: c.percentCompleteBp, after: v.percentCompleteBp } };
  });
}

/** Add or change a free adjustment line; may be negative (rule 7, decision #12). */
export async function saveAdjustmentCore(actor: InvoiceActor, raw: unknown): Promise<Result> {
  const parsed = adjustmentInput.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error.issues);
  const v = parsed.data;
  return edit(actor, "saveAdjustment", v.invoiceId, v.version, async (db, inv) => {
    const values = { description: v.description, quantity: "1.00", rateCents: v.amountCents, amountCents: v.amountCents };
    if (v.lineId) {
      const line = await ownAdjustment(db, inv, v.lineId);
      await db.update(invoiceLines).set(values).where(eq(invoiceLines.id, line.id));
      return { adjustment: { description: v.description, before: line.amountCents, after: v.amountCents } };
    }
    await db.insert(invoiceLines).values({
      ...values,
      firmId: actor.firmId,
      invoiceId: inv.id,
      lineType: "adjustment",
      sortOrder: await nextSort(db, inv.id, ADJUSTMENT_SORT_BASE),
    });
    return { adjustment: { description: v.description, added: v.amountCents } };
  });
}

/** Remove a free adjustment (archived). Calculated lines change through % complete instead. */
export async function removeLineCore(actor: InvoiceActor, raw: unknown): Promise<Result> {
  const parsed = lineInput.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error.issues);
  const v = parsed.data;
  return edit(actor, "removeLine", v.invoiceId, v.version, async (db, inv) => {
    const line = await ownAdjustment(db, inv, v.lineId);
    await db.update(invoiceLines).set({ archivedAt: new Date() }).where(eq(invoiceLines.id, line.id));
    return { removed: line.description };
  });
}

// ---------------------------------------------------------------------------
// Review

/** Owners, admins and the project's Principal in Charge, minus whoever is asking. */
async function reviewers(db: TenantDb, principalId: string, except: string): Promise<string[]> {
  const rows = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.active, true), inArray(memberships.appRole, ["owner", "admin"])));
  return [...new Set([...rows.map((r) => r.id), principalId])].filter((id) => id !== except);
}

/** draft → in_review once the send checks pass; reviewers are notified (bell). */
export async function submitForReviewCore(actor: InvoiceActor, raw: unknown): Promise<Result> {
  const parsed = versionInput.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error.issues);
  return runInvoice(actor, "submitForReview", async (db) => {
    const { inv, access } = await lockForWrite(db, actor, parsed.data.invoiceId, parsed.data.version);
    if (inv.status !== "draft") throw new InvoiceError(INVOICE_MESSAGES.notDraft);
    await recalculate(db, inv);
    const [fresh] = await db.select().from(invoices).where(eq(invoices.id, inv.id));
    const view = await buildView(db, fresh, access);
    if (view.problems.length) throw new InvoiceError(view.problems.join(" "));
    await db.update(invoices).set({ status: "in_review" }).where(eq(invoices.id, inv.id));
    await logInvoice(db, actor, inv.id, "status_changed", { status: { before: "draft", after: "in_review" } });
    const p = access.project;
    const [me] = await db.select({ first: users.firstName, last: users.lastName }).from(users).where(eq(users.id, actor.userId));
    await notify(db, {
      firmId: actor.firmId,
      recipients: await reviewers(db, p.principalMembershipId, actor.member.membershipId),
      kind: "invoice_review",
      title: `Invoice ready to review: ${p.number} ${p.name}`,
      body: `${money(fresh.totalCents)} · from ${`${me?.first ?? ""} ${me?.last ?? ""}`.trim()}`,
      link: `/app/invoices/${inv.id}/edit`,
      entity: { type: "invoice", id: inv.id },
    });
    const [after] = await db.select().from(invoices).where(eq(invoices.id, inv.id));
    return buildView(db, after, access);
  });
}

/** in_review → draft with a note, back to whoever submitted it. */
export async function returnToDraftCore(actor: InvoiceActor, raw: unknown): Promise<Result> {
  const parsed = returnInput.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error.issues);
  const note = parsed.data.note.trim();
  if (note.length < 3) return bad(INVOICE_MESSAGES.returnNote, "note");
  return runInvoice(actor, "returnToDraft", async (db) => {
    const { inv, access } = await lockForWrite(db, actor, parsed.data.invoiceId, parsed.data.version, "review");
    await db.update(invoices).set({ status: "draft" }).where(eq(invoices.id, inv.id));
    await logInvoice(db, actor, inv.id, "status_changed", { status: { before: "in_review", after: "draft" }, note });
    // Whoever submitted it last hears about it.
    const [submitted] = await db
      .select({ userId: activityLog.actorUserId })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.entityType, "invoice"),
          eq(activityLog.entityId, inv.id),
          eq(activityLog.action, "status_changed"),
          sql`${activityLog.changes} -> 'status' ->> 'after' = 'in_review'`,
        ),
      )
      .orderBy(desc(activityLog.createdAt))
      .limit(1);
    const submitter = submitted?.userId ?? inv.createdBy;
    const [m] = submitter
      ? await db
          .select({ id: memberships.id })
          .from(memberships)
          .where(and(eq(memberships.userId, submitter), ne(memberships.id, actor.member.membershipId)))
      : [];
    const p = access.project;
    await notify(db, {
      firmId: actor.firmId,
      recipients: [m?.id],
      kind: "invoice_returned",
      title: `Invoice returned: ${p.number} ${p.name}`,
      body: note,
      link: `/app/invoices/${inv.id}/edit`,
      entity: { type: "invoice", id: inv.id },
    });
    const [after] = await db.select().from(invoices).where(eq(invoices.id, inv.id));
    return buildView(db, after, access);
  });
}

/** Delete a draft: archived with its lines; its time is free again. */
export async function deleteDraftCore(actor: InvoiceActor, raw: unknown): Promise<ActionResult<string, { projectId: string }>> {
  const parsed = versionInput.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error.issues);
  return runInvoice(actor, "deleteDraft", async (db) => {
    const { inv } = await lockForWrite(db, actor, parsed.data.invoiceId, parsed.data.version, "delete");
    const now = new Date();
    await db.update(timeEntries).set({ invoiceId: null }).where(eq(timeEntries.invoiceId, inv.id));
    await db
      .update(invoiceLines)
      .set({ archivedAt: now })
      .where(and(eq(invoiceLines.invoiceId, inv.id), isNull(invoiceLines.archivedAt)));
    await db
      .update(invoiceExcludedEntries)
      .set({ archivedAt: now })
      .where(and(eq(invoiceExcludedEntries.invoiceId, inv.id), isNull(invoiceExcludedEntries.archivedAt)));
    await db.update(invoices).set({ archivedAt: now }).where(eq(invoices.id, inv.id));
    await logInvoice(db, actor, inv.id, "archived", null);
    return { projectId: inv.projectId };
  });
}
