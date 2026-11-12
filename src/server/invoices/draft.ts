import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import {
  activityLog,
  companies,
  consultants,
  contacts,
  firmRoles,
  firmSettings,
  invoiceExcludedEntries,
  invoiceLines,
  invoices,
  projectPhases,
  projects,
  timeEntries,
  timesheets,
} from "@/db/schema";
import { type TenantDb, withFirm } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import { COUNTED_STATUSES, endOfMonth, invoiceDueDate, invoiceTotals, periodStart } from "@/lib/calc/invoice";
import { type DraftPlan, type PlannedLine, planDraft } from "@/lib/calc/invoice-plan";
import { todayIn } from "@/lib/format";
import { INVOICE_MESSAGES } from "@/lib/invoices/builder";
import { type ActionResult, SAVE_FAILED_MESSAGE, type SettingsActor } from "@/server/settings/common";
import { linesForProjects } from "./facts";

// The draft invoice engine (invoicing spec rules 3–7, 12, 13): who may touch
// a draft, reserving time on it, and recalculating its lines and totals.
// Every function here runs inside the caller's withFirm transaction.

/** Who is asking. Built from the session on the server. */
export type InvoiceActor = SettingsActor & { timezone: string };

export class InvoiceError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}
export class Forbidden extends Error {}

export type InvoiceRow = typeof invoices.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;

export type Access = {
  project: ProjectRow;
  /** Create and edit drafts: owner/admin, or the project's PM or principal. */
  canDraft: boolean;
  /** Return to draft (and send, in 1.8 C): owner/admin, or a PM who is the Principal in Charge (#26). */
  canReview: boolean;
};

export async function projectAccess(db: TenantDb, actor: InvoiceActor, projectId: string): Promise<Access | null> {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.archivedAt)));
  if (!project) return null;
  const me = actor.member.membershipId;
  const isOwn = project.pmMembershipId === me || project.principalMembershipId === me;
  const isPic = project.principalMembershipId === me;
  return {
    project,
    canDraft: can(actor.member, "invoices.create_draft", { isProjectManager: isOwn }),
    canReview: can(actor.member, "invoices.review", { isProjectManager: isPic }),
  };
}

/**
 * Sending started (it has its number) but didn't finish (rule 15). It's
 * frozen so the saved PDF and the email match it; only Retry is left.
 */
export const sendStarted = (inv: Pick<InvoiceRow, "status" | "number">) =>
  inv.number !== null && (inv.status === "draft" || inv.status === "in_review");

/** Can this person change the draft as it stands? */
export const canEdit = (inv: Pick<InvoiceRow, "status" | "number">, a: Access) =>
  !sendStarted(inv) && a.canDraft && (inv.status === "draft" || (inv.status === "in_review" && a.canReview));

/** The version a page holds: the invoice's last change. */
export const versionOf = (inv: Pick<InvoiceRow, "updatedAt">) => inv.updatedAt.toISOString();

/**
 * Load and lock an invoice for a write, check who's asking, and that the
 * page isn't stale. Throws Forbidden (no access: same answer as "not
 * found", rule: PMs get 403) or InvoiceError.
 */
export async function lockForWrite(
  db: TenantDb,
  actor: InvoiceActor,
  invoiceId: string,
  version: string | null,
  need: "edit" | "review" | "delete" = "edit",
): Promise<{ inv: InvoiceRow; access: Access }> {
  const [inv] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), isNull(invoices.archivedAt)))
    .for("update");
  if (!inv) throw new InvoiceError(INVOICE_MESSAGES.notFound);
  const access = await projectAccess(db, actor, inv.projectId);
  if (!access?.canDraft && !access?.canReview) throw new Forbidden();
  if (sendStarted(inv)) throw new InvoiceError(INVOICE_MESSAGES.sending);
  if (need === "review") {
    if (!access.canReview) throw new Forbidden();
    if (inv.status !== "in_review") throw new InvoiceError(INVOICE_MESSAGES.notInReview);
  } else if (need === "delete") {
    if (!access.canDraft) throw new Forbidden();
    if (inv.status !== "draft") throw new InvoiceError(INVOICE_MESSAGES.notDraft);
  } else if (!canEdit(inv, access)) {
    if (!access.canDraft) throw new Forbidden();
    throw new InvoiceError(inv.status === "in_review" ? INVOICE_MESSAGES.notEditable : INVOICE_MESSAGES.notDraft);
  }
  if (version !== null && versionOf(inv) !== version) throw new InvoiceError(INVOICE_MESSAGES.stale);
  return { inv, access };
}

/** Run a builder write; turn refusals into results. */
export async function runInvoice<T>(
  actor: InvoiceActor,
  what: string,
  fn: (db: TenantDb) => Promise<T>,
): Promise<ActionResult<string, T>> {
  if (!actor.member.active) return { ok: false, error: "You don't have access to this." };
  try {
    return { ok: true, data: await withFirm(actor.firmId, fn) };
  } catch (err) {
    if (err instanceof Forbidden) return { ok: false, error: "You don't have access to this." };
    if (err instanceof InvoiceError)
      return err.field ? { ok: false, error: err.message, fieldErrors: { [err.field]: err.message } } : { ok: false, error: err.message };
    console.error(`${what} failed`, err);
    return { ok: false, error: SAVE_FAILED_MESSAGE };
  }
}

export async function logInvoice(
  db: TenantDb,
  actor: InvoiceActor,
  invoiceId: string,
  action: string,
  changes: Record<string, unknown> | null = null,
) {
  await db.insert(activityLog).values({
    firmId: actor.firmId,
    actorUserId: actor.userId,
    entityType: "invoice",
    entityId: invoiceId,
    action,
    changes,
  });
}

// ---------------------------------------------------------------------------
// Time on a draft (rule 13)

/** Phases of the project that bill by the hour. */
export async function projectPhaseRows(db: TenantDb, projectId: string) {
  return db
    .select()
    .from(projectPhases)
    .where(and(eq(projectPhases.projectId, projectId), isNull(projectPhases.archivedAt)));
}

async function excludedIds(db: TenantDb, invoiceId: string): Promise<string[]> {
  const rows = await db
    .select({ id: invoiceExcludedEntries.timeEntryId })
    .from(invoiceExcludedEntries)
    .where(and(eq(invoiceExcludedEntries.invoiceId, invoiceId), isNull(invoiceExcludedEntries.archivedAt)));
  return rows.map((r) => r.id);
}

/**
 * Release time that no longer belongs on the draft, then reserve every
 * eligible entry (rule 4): approved, billable, rated, live, on an hourly or
 * NTE phase of this project, worked on or before "period through", not
 * already on an invoice, and not unticked on this draft.
 */
export async function syncReservedTime(db: TenantDb, inv: InvoiceRow, hourlyPhaseIds: string[]): Promise<number> {
  const excluded = await excludedIds(db, inv.id);
  // Release: after the period, unticked, or no longer on an hourly phase.
  const released = await db
    .update(timeEntries)
    .set({ invoiceId: null })
    .where(
      and(
        eq(timeEntries.invoiceId, inv.id),
        or(
          sql`${timeEntries.workDate} > ${inv.periodEnd}`,
          excluded.length ? inArray(timeEntries.id, excluded) : sql`false`,
          hourlyPhaseIds.length
            ? or(isNull(timeEntries.projectPhaseId), notInArray(timeEntries.projectPhaseId, hourlyPhaseIds))
            : sql`true`,
        ),
      ),
    )
    .returning({ id: timeEntries.id });
  if (!hourlyPhaseIds.length) return released.length;
  const reserved = await db
    .update(timeEntries)
    .set({ invoiceId: inv.id })
    .where(
      and(
        isNull(timeEntries.invoiceId),
        isNull(timeEntries.archivedAt),
        eq(timeEntries.billable, true),
        isNotNull(timeEntries.billRateCents),
        inArray(timeEntries.projectPhaseId, hourlyPhaseIds),
        lte(timeEntries.workDate, inv.periodEnd),
        excluded.length ? notInArray(timeEntries.id, excluded) : sql`true`,
        sql`exists (select 1 from ${timesheets} t where t.id = ${timeEntries.timesheetId} and t.status = 'approved')`,
      ),
    )
    .returning({ id: timeEntries.id });
  return released.length + reserved.length;
}

/** Entries reserved on this draft, with the role frozen on each (decision #30). */
export async function reservedEntries(db: TenantDb, invoiceId: string) {
  const rows = await db
    .select({
      id: timeEntries.id,
      phaseId: timeEntries.projectPhaseId,
      roleName: firmRoles.name,
      billRateCents: timeEntries.billRateCents,
      hours: timeEntries.hours,
    })
    .from(timeEntries)
    .leftJoin(firmRoles, eq(firmRoles.id, timeEntries.firmRoleId))
    .where(and(eq(timeEntries.invoiceId, invoiceId), isNull(timeEntries.archivedAt)));
  return rows.flatMap((r) =>
    r.phaseId && r.billRateCents !== null
      ? [{ id: r.id, phaseId: r.phaseId, roleName: r.roleName, billRateCents: r.billRateCents, hours: r.hours }]
      : [],
  );
}

// ---------------------------------------------------------------------------
// Recalculate (rules 3–7)

/** The plan for a draft as things stand (no writes). */
/** Consultants on the project whose fees pass through (decision #31). */
export async function billedConsultants(db: TenantDb, projectId: string) {
  return db
    .select({
      id: consultants.id,
      discipline: consultants.discipline,
      company: companies.name,
      feeCents: consultants.feeCents,
      markupBp: consultants.markupBp,
      percentCompleteBp: consultants.percentCompleteBp,
    })
    .from(consultants)
    .innerJoin(companies, eq(companies.id, consultants.companyId))
    .where(and(eq(consultants.projectId, projectId), eq(consultants.billedThrough, true), isNull(consultants.archivedAt)))
    .orderBy(asc(consultants.discipline), asc(companies.name));
}

export async function planFor(db: TenantDb, inv: InvoiceRow): Promise<DraftPlan> {
  const [phases, priorLines, entries, cons] = await Promise.all([
    projectPhaseRows(db, inv.projectId),
    linesForProjects(db, [inv.projectId]),
    reservedEntries(db, inv.id),
    billedConsultants(db, inv.projectId),
  ]);
  return planDraft({
    invoiceId: inv.id,
    phases: phases.map((p) => ({
      id: p.id,
      name: p.name,
      sortOrder: p.sortOrder,
      feeType: p.feeType,
      feeCents: p.feeCents,
      percentCompleteBp: p.percentCompleteBp,
    })),
    priorLines,
    entries,
    consultants: cons.map((c) => ({
      id: c.id,
      label: `${c.discipline} · ${c.company}`,
      feeCents: c.feeCents,
      markupBp: c.markupBp,
      percentCompleteBp: c.percentCompleteBp,
    })),
  });
}

/** Calculated lines: phase fees, hourly lines, consultants, and adjustments tied to a phase (NTE write-downs). */
const isPlanned = (l: Pick<typeof invoiceLines.$inferSelect, "lineType" | "projectPhaseId">) =>
  l.lineType === "phase_fee" ||
  l.lineType === "hourly" ||
  l.lineType === "consultant" ||
  (l.lineType === "adjustment" && l.projectPhaseId !== null);

const signature = (l: {
  lineType: string;
  projectPhaseId: string | null;
  consultantId: string | null;
  markupBp: number | null;
  description: string;
  quantity: string;
  rateCents: number;
  amountCents: number;
  percentCompleteBp: number | null;
  phaseFeeCents: number | null;
  priorBilledCents: number | null;
  sortOrder: number;
}) =>
  JSON.stringify([
    l.lineType,
    l.projectPhaseId,
    l.consultantId,
    l.markupBp,
    l.description,
    Number(l.quantity).toFixed(2),
    l.rateCents,
    l.amountCents,
    l.percentCompleteBp,
    l.phaseFeeCents,
    l.priorBilledCents,
    l.sortOrder,
  ]);

export type RecalcResult = { plan: DraftPlan; added: string[]; removed: string[]; changed: boolean };

/**
 * Bring a draft up to date: reserve/release time, rewrite the calculated
 * lines that changed (unchanged ones stay as they are), and store totals.
 * Touches the invoice (moving the page's version on) only when something
 * changed, so opening a draft that's already current changes nothing.
 */
export async function recalculate(db: TenantDb, inv: InvoiceRow): Promise<RecalcResult> {
  const phases = await projectPhaseRows(db, inv.projectId);
  const timeMoved = await syncReservedTime(
    db,
    inv,
    phases.filter((p) => p.feeType !== "fixed").map((p) => p.id),
  );
  const plan = await planFor(db, inv);

  const live = await db
    .select()
    .from(invoiceLines)
    .where(and(eq(invoiceLines.invoiceId, inv.id), isNull(invoiceLines.archivedAt)));
  const existing = live.filter(isPlanned);
  const remaining = new Map<string, (typeof live)[number][]>();
  for (const l of existing) {
    const k = signature(l);
    remaining.set(k, [...(remaining.get(k) ?? []), l]);
  }
  const toInsert: PlannedLine[] = [];
  for (const p of plan.lines) {
    const match = remaining.get(signature(p))?.pop();
    if (!match) toInsert.push(p);
  }
  const toArchive = [...remaining.values()].flat();
  const now = new Date();
  if (toArchive.length)
    await db
      .update(invoiceLines)
      .set({ archivedAt: now })
      .where(inArray(invoiceLines.id, toArchive.map((l) => l.id)));
  if (toInsert.length)
    await db.insert(invoiceLines).values(
      toInsert.map((p) => ({
        firmId: inv.firmId,
        invoiceId: inv.id,
        projectPhaseId: p.projectPhaseId,
        consultantId: p.consultantId,
        markupBp: p.markupBp,
        lineType: p.lineType,
        description: p.description,
        quantity: p.quantity,
        rateCents: p.rateCents,
        amountCents: p.amountCents,
        percentCompleteBp: p.percentCompleteBp,
        phaseFeeCents: p.phaseFeeCents,
        priorBilledCents: p.priorBilledCents,
        sortOrder: p.sortOrder,
      })),
    );

  const kept = live.filter((l) => !toArchive.includes(l));
  const totals = invoiceTotals([...kept, ...toInsert]);
  const changed =
    timeMoved > 0 ||
    toInsert.length > 0 ||
    toArchive.length > 0 ||
    totals.totalCents !== inv.totalCents ||
    totals.subtotalCents !== inv.subtotalCents;
  if (changed)
    await db
      .update(invoices)
      .set({ subtotalCents: totals.subtotalCents, taxCents: totals.taxCents, totalCents: totals.totalCents, updatedAt: now })
      .where(eq(invoices.id, inv.id));
  return { plan, added: toInsert.map((l) => l.description), removed: toArchive.map((l) => l.description), changed };
}

/** Lines that changed in a save, for the activity log (rule 18: batched per save). */
export const lineChanges = (r: RecalcResult) =>
  r.added.length || r.removed.length ? { lines: { added: r.added, removed: r.removed } } : null;

// ---------------------------------------------------------------------------
// New invoice

/** The end of the project's last counted invoice period (rule 8), or null. */
export async function lastCountedPeriodEnd(db: TenantDb, projectId: string): Promise<string | null> {
  const [row] = await db
    .select({ end: invoices.periodEnd })
    .from(invoices)
    .where(
      and(
        eq(invoices.projectId, projectId),
        isNull(invoices.archivedAt),
        inArray(invoices.status, [...COUNTED_STATUSES]),
      ),
    )
    .orderBy(desc(invoices.periodEnd))
    .limit(1);
  return row?.end ?? null;
}

async function openDraftId(db: TenantDb, projectId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(
      and(eq(invoices.projectId, projectId), isNull(invoices.archivedAt), inArray(invoices.status, ["draft", "in_review"])),
    );
  return row?.id ?? null;
}

/**
 * New invoice for a project (rule 12): open its draft if it has one,
 * otherwise create one through the end of this month and fill it in.
 */
export async function createDraft(db: TenantDb, actor: InvoiceActor, projectId: string): Promise<{ id: string; created: boolean }> {
  const access = await projectAccess(db, actor, projectId);
  if (!access?.canDraft) throw new Forbidden();
  const p = access.project;
  const existing = await openDraftId(db, projectId);
  if (existing) return { id: existing, created: false };
  if (p.status !== "active" && p.status !== "on_hold") throw new InvoiceError(INVOICE_MESSAGES.projectNotBillable);

  const [settings] = await db.select({ terms: firmSettings.defaultPaymentTermsDays }).from(firmSettings);
  const today = todayIn(actor.timezone);
  const start = periodStart(await lastCountedPeriodEnd(db, projectId), p.startDate);
  let periodEnd = endOfMonth(today);
  if (start && periodEnd < start) periodEnd = endOfMonth(start);
  const billTo = await defaultBillTo(db, p);

  // Two people clicking at once: the one-draft index lets one in.
  const inserted = await db
    .insert(invoices)
    .values({
      firmId: actor.firmId,
      projectId,
      clientCompanyId: p.clientCompanyId,
      billToContactId: billTo,
      issueDate: today,
      dueDate: invoiceDueDate(today, settings?.terms ?? 30),
      periodStart: start,
      periodEnd,
      createdBy: actor.userId,
      updatedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning();
  const inv = inserted[0];
  if (!inv) {
    const id = await openDraftId(db, projectId);
    if (id) return { id, created: false };
    throw new InvoiceError(SAVE_FAILED_MESSAGE);
  }
  const r = await recalculate(db, inv);
  await logInvoice(db, actor, inv.id, "created", { project: p.number, ...lineChanges(r) });
  return { id: inv.id, created: true };
}

/** The client's billing contact, else the project's client contact (live ones only; decision #32). */
async function defaultBillTo(db: TenantDb, p: ProjectRow): Promise<string | null> {
  const [company] = await db
    .select({ billing: companies.billingContactId })
    .from(companies)
    .where(eq(companies.id, p.clientCompanyId));
  const candidates = [company?.billing, p.clientContactId].filter((id): id is string => !!id);
  if (!candidates.length) return null;
  const live = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(inArray(contacts.id, candidates), eq(contacts.companyId, p.clientCompanyId), isNull(contacts.archivedAt)),
    );
  const ids = new Set(live.map((c) => c.id));
  return candidates.find((id) => ids.has(id)) ?? null;
}
