import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import {
  activityLog,
  memberships,
  rates,
  reviewSteps,
  teams,
  timeEntries,
  timesheetReviewSteps,
  timesheets,
  users,
} from "@/db/schema";
import { type TenantDb, withFirm } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import { type RateRow, advanceReview, currentRows, rowsFor } from "@/lib/calc/review-route";
import { lookupRate } from "@/lib/calc/rates";
import { APPROVAL_MESSAGES, RETURN_NOTE_MAX, bulkMessage, onBehalfNoteProblem, returnNoteProblem } from "@/lib/time/approval";
import { initials as initialsFromName } from "@/lib/initials";
import { FORBIDDEN_MESSAGE } from "@/server/settings/common";
import { archiveReview, freezeSheetRates, loadReview } from "./review";
import type { TimeActor } from "./write";

// Approving, returning and reopening timesheets (timesheet-approval spec,
// rules 3–5). Who may act comes from the sheet's own review, checked here on
// the server; owner/admin can also step in (rule 3f) and reopen (rule 5).
// Every write locks the timesheet row first, so two people clicking at once
// can't both approve the same step.

export type ApprovalActor = TimeActor;

export type ApprovalResult = { ok: true; message?: string; approved?: boolean } | { ok: false; error: string };

/** A refusal shown to the person; the transaction is rolled back. */
class ApprovalError extends Error {}

const forbidden = { ok: false, error: FORBIDDEN_MESSAGE } as const;

// ---------- Who can open Approvals ----------

export type ApprovalAccess = {
  /** May open the Approvals tab at all (Who can see it). */
  canOpen: boolean;
  ownerAdmin: boolean;
  /** Active principal: acts on `any_principal` steps. */
  isPrincipal: boolean;
  /** Teams this person leads. */
  leadsTeamIds: string[];
};

/**
 * Owner/admin, principals, team leaders, people named on the route, and
 * anyone a sheet is waiting on. Everyone else gets 404 / forbidden.
 */
export async function approvalAccess(db: TenantDb, actor: ApprovalActor): Promise<ApprovalAccess> {
  const ownerAdmin = can(actor.member, "time.approve_for");
  const [me] = await db
    .select({ isPrincipal: memberships.isPrincipal, active: memberships.active, archivedAt: memberships.archivedAt })
    .from(memberships)
    .where(eq(memberships.id, actor.membershipId));
  const active = !!me && me.active && !me.archivedAt && actor.member.active;
  const isPrincipal = active && me.isPrincipal;
  const led = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.leaderMembershipId, actor.membershipId), isNull(teams.archivedAt)));
  const leadsTeamIds = led.map((t) => t.id);
  let canOpen = active && (ownerAdmin || isPrincipal || leadsTeamIds.length > 0);
  if (active && !canOpen) {
    const [named] = await db
      .select({ id: reviewSteps.id })
      .from(reviewSteps)
      .where(and(eq(reviewSteps.membershipId, actor.membershipId), isNull(reviewSteps.archivedAt)))
      .limit(1);
    const [waiting] = named
      ? [named]
      : await db
          .select({ id: timesheetReviewSteps.id })
          .from(timesheetReviewSteps)
          .where(
            and(
              eq(timesheetReviewSteps.approverMembershipId, actor.membershipId),
              eq(timesheetReviewSteps.status, "waiting"),
              isNull(timesheetReviewSteps.archivedAt),
            ),
          )
          .limit(1);
    canOpen = !!waiting;
  }
  return { canOpen, ownerAdmin: active && ownerAdmin, isPrincipal, leadsTeamIds };
}

// ---------- Rates ----------

/** Every rate row for these people (their overrides and their roles), newest start first. */
export async function loadRateBook(db: TenantDb, people: readonly { membershipId: string; firmRoleId: string | null }[]) {
  const ids = [...new Set(people.map((p) => p.membershipId))];
  const roleIds = [...new Set(people.flatMap((p) => (p.firmRoleId ? [p.firmRoleId] : [])))];
  const rows: (RateRow & { membershipId: string | null; firmRoleId: string | null })[] = ids.length
    ? await db
        .select({
          membershipId: rates.membershipId,
          firmRoleId: rates.firmRoleId,
          effectiveFrom: rates.effectiveFrom,
          effectiveTo: rates.effectiveTo,
          billRateCents: rates.billRateCents,
          costRateCents: rates.costRateCents,
        })
        .from(rates)
        .where(
          roleIds.length
            ? or(inArray(rates.membershipId, ids), inArray(rates.firmRoleId, roleIds))
            : inArray(rates.membershipId, ids),
        )
        .orderBy(desc(rates.effectiveFrom))
    : [];
  /** The rate for one person on one date (person override → role → none). */
  return (membershipId: string, firmRoleId: string | null, workDate: string) =>
    lookupRate(
      rows.filter((r) => r.membershipId === membershipId),
      rows.filter((r) => r.firmRoleId !== null && r.firmRoleId === firmRoleId),
      workDate,
    );
}

// ---------- Helpers ----------

type Submitter = { membershipId: string; firmRoleId: string | null; initials: string; userId: string };

async function submitterOf(db: TenantDb, membershipId: string): Promise<Submitter> {
  const [p] = await db
    .select({
      membershipId: memberships.id,
      firmRoleId: memberships.firmRoleId,
      userId: memberships.userId,
      initials: users.initials,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.id, membershipId));
  return { ...p, initials: p.initials || initialsFromName(`${p.firstName} ${p.lastName}`) };
}

/** Initials for membership ids (for "on behalf of BM, PD"). */
async function initialsFor(db: TenantDb, ids: readonly string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await db
    .select({ id: memberships.id, initials: users.initials, firstName: users.firstName, lastName: users.lastName })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(inArray(memberships.id, [...ids]));
  return new Map(rows.map((r) => [r.id, r.initials || initialsFromName(`${r.firstName} ${r.lastName}`)]));
}

async function lockSheet(db: TenantDb, timesheetId: string) {
  const [sheet] = await db.select().from(timesheets).where(eq(timesheets.id, timesheetId)).for("update");
  if (!sheet) throw new ApprovalError(APPROVAL_MESSAGES.notFound);
  return sheet;
}

function log(db: TenantDb, actor: ApprovalActor, entityId: string, action: string, changes: Record<string, unknown>) {
  return db.insert(activityLog).values({
    firmId: actor.firmId,
    actorUserId: actor.userId,
    entityType: "timesheet",
    entityId,
    action,
    changes,
  });
}

async function run<T>(actor: ApprovalActor, write: (db: TenantDb) => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    return { ok: true, data: await withFirm(actor.firmId, write) };
  } catch (err) {
    if (err instanceof ApprovalError) return { ok: false, error: err.message };
    if (err instanceof Forbidden) return forbidden;
    console.error("approval write failed", err);
    return { ok: false, error: APPROVAL_MESSAGES.saveFailed };
  }
}

class Forbidden extends Error {}

const uuid = z.uuid();

// ---------- Approve (rule 3) ----------

const approveInput = z.object({
  timesheetId: uuid,
  onBehalf: z.boolean().optional(),
  note: z.string().max(RETURN_NOTE_MAX + 200).optional(),
});

/** Approve one sheet inside an open transaction. Throws ApprovalError / Forbidden. */
async function approveIn(
  db: TenantDb,
  actor: ApprovalActor,
  input: z.infer<typeof approveInput>,
  now: Date,
): Promise<{ approved: boolean; initials: string }> {
  const sheet = await lockSheet(db, input.timesheetId);
  // Nobody approves their own sheet.
  if (sheet.membershipId === actor.membershipId) throw new Forbidden();
  const access = await approvalAccess(db, actor);
  if (input.onBehalf ? !access.ownerAdmin : !access.canOpen) throw new Forbidden();
  const submitter = await submitterOf(db, sheet.membershipId);
  if (sheet.status !== "submitted") throw new ApprovalError(APPROVAL_MESSAGES.notWaiting);

  const review = await loadReview(db, sheet.id);
  const mine = input.onBehalf
    ? currentRows(review)
    : rowsFor(review, { membershipId: actor.membershipId, isActivePrincipal: access.isPrincipal }, sheet.membershipId);
  if (!mine.length) throw new ApprovalError(APPROVAL_MESSAGES.notWaiting);

  // b / f: mark the rows approved. An any_principal row records who it was,
  // unless an owner/admin stood in for "a principal".
  const mineIds = new Set(mine.map((r) => r.id));
  for (const r of mine) {
    await db
      .update(timesheetReviewSteps)
      .set({
        status: "approved",
        actedBy: actor.userId,
        actedAt: now,
        onBehalf: !!input.onBehalf,
        approverMembershipId: r.approverMembershipId ?? (input.onBehalf ? null : actor.membershipId),
        updatedAt: now,
      })
      .where(eq(timesheetReviewSteps.id, r.id));
  }
  const after = review.map((r) =>
    mineIds.has(r.id)
      ? {
          ...r,
          status: "approved" as const,
          approverMembershipId: r.approverMembershipId ?? (input.onBehalf ? null : actor.membershipId),
        }
      : r,
  );

  // c: move on, skipping an any_principal step a principal already covered.
  const principalRows = await db.select({ id: memberships.id }).from(memberships).where(eq(memberships.isPrincipal, true));
  const principals = new Set(principalRows.map((p) => p.id));
  const next = advanceReview(after, (id) => principals.has(id));
  for (const id of next.skip) {
    await db
      .update(timesheetReviewSteps)
      .set({ status: "skipped", skipReason: "principal_already_approved", updatedAt: now })
      .where(eq(timesheetReviewSteps.id, id));
  }

  // d: activity log.
  const stoodFor = input.onBehalf
    ? await initialsFor(db, mine.flatMap((r) => (r.approverMembershipId ? [r.approverMembershipId] : [])))
    : new Map<string, string>();
  const note = input.note?.trim() || undefined;
  await log(db, actor, sheet.id, "approved", {
    step_no: mine[0].stepNo,
    kind: mine[0].kind,
    ...(input.onBehalf
      ? {
          on_behalf_of: mine.map((r) => (r.approverMembershipId ? stoodFor.get(r.approverMembershipId) : "a principal")),
          ...(note ? { note } : {}),
        }
      : {}),
  });

  if (next.done) {
    // Rule 2: every entry needs a rate; if one is missing nothing is written.
    // (The sheet can't change while submitted, so timesheet rule 10 b–d still holds.)
    const frozen = await freezeSheetRates(db, sheet.id, submitter.membershipId, submitter.firmRoleId, submitter.initials);
    if (!frozen.ok) throw new ApprovalError(frozen.message);
    await db
      .update(timesheets)
      .set({ status: "approved", approvedAt: now, approvedBy: actor.userId, updatedAt: now })
      .where(eq(timesheets.id, sheet.id));
    await log(db, actor, sheet.id, "status_changed", { status: { before: "submitted", after: "approved" } });
  }
  // e: notifications for the next approvers / the submitter arrive in 1.7 C.
  return { approved: next.done, initials: submitter.initials };
}

/** Approve (row, detail) and Approve for … (owner/admin, rule 3f). */
export async function approveStepCore(actor: ApprovalActor, raw: unknown, now: Date = new Date()): Promise<ApprovalResult> {
  if (!actor.member.active) return forbidden;
  const parsed = approveInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: APPROVAL_MESSAGES.notFound };
  const noteProblem = onBehalfNoteProblem(parsed.data.note);
  if (noteProblem) return { ok: false, error: noteProblem };
  if (parsed.data.onBehalf && !can(actor.member, "time.approve_for")) return forbidden;
  const r = await run(actor, (db) => approveIn(db, actor, parsed.data, now));
  if (!r.ok) return r;
  return {
    ok: true,
    approved: r.data.approved,
    message: r.data.approved ? `Approved ${r.data.initials}'s timesheet.` : `Approved your step on ${r.data.initials}'s timesheet.`,
  };
}

const manyInput = z.object({ timesheetIds: z.array(uuid).min(1).max(200) });

/** Approve selected / Approve N with no flags: each sheet in its own transaction. */
export async function approveManyCore(actor: ApprovalActor, raw: unknown, now: Date = new Date()): Promise<ApprovalResult> {
  if (!actor.member.active) return forbidden;
  const parsed = manyInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: APPROVAL_MESSAGES.notFound };
  let approved = 0;
  const failures: { initials: string; error: string }[] = [];
  for (const timesheetId of [...new Set(parsed.data.timesheetIds)]) {
    const r = await run(actor, (db) => approveIn(db, actor, { timesheetId }, now));
    if (r.ok) {
      approved += 1;
      continue;
    }
    const who = await withFirm(actor.firmId, async (db) => {
      const [s] = await db.select({ m: timesheets.membershipId }).from(timesheets).where(eq(timesheets.id, timesheetId));
      return s ? (await submitterOf(db, s.m)).initials : "?";
    }).catch(() => "?");
    failures.push({ initials: who, error: r.error });
  }
  return { ok: true, message: bulkMessage(approved, failures) };
}

// ---------- Return and Reopen (rules 4, 5) ----------

const noteInput = z.object({ timesheetId: uuid, note: z.string().max(RETURN_NOTE_MAX * 2) });

/** Back to the person with a note: review archived, any frozen rates cleared. */
async function sendBack(
  db: TenantDb,
  actor: ApprovalActor,
  sheet: typeof timesheets.$inferSelect,
  note: string,
  action: "status_changed" | "reopened",
  now: Date,
) {
  await archiveReview(db, sheet.id, now);
  await db
    .update(timeEntries)
    .set({ billRateCents: null, costRateCents: null, updatedAt: now })
    .where(and(eq(timeEntries.timesheetId, sheet.id), isNull(timeEntries.archivedAt)));
  await db
    .update(timesheets)
    .set({
      status: "rejected",
      rejectionNote: note,
      rejectedAt: now,
      rejectedBy: actor.userId,
      approvedAt: null,
      approvedBy: null,
      updatedAt: now,
    })
    .where(eq(timesheets.id, sheet.id));
  await log(db, actor, sheet.id, action, { status: { before: sheet.status, after: "rejected" }, note });
  // The person is notified in 1.7 C.
}

/** Return: anyone with a row in the current review, or owner/admin. Only while submitted. */
export async function returnTimesheetCore(actor: ApprovalActor, raw: unknown, now: Date = new Date()): Promise<ApprovalResult> {
  if (!actor.member.active) return forbidden;
  const parsed = noteInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: APPROVAL_MESSAGES.notFound };
  const r = await run(actor, async (db) => {
    const sheet = await lockSheet(db, parsed.data.timesheetId);
    if (sheet.membershipId === actor.membershipId) throw new Forbidden();
    const access = await approvalAccess(db, actor);
    if (!access.canOpen) throw new Forbidden();
    const who = await submitterOf(db, sheet.membershipId);
    const problem = returnNoteProblem(parsed.data.note, who.initials);
    if (problem) throw new ApprovalError(problem);
    if (sheet.status !== "submitted") throw new ApprovalError(APPROVAL_MESSAGES.notInReview);
    const review = await loadReview(db, sheet.id);
    const onReview =
      review.some((r) => r.approverMembershipId === actor.membershipId && r.status !== "skipped") ||
      rowsFor(review, { membershipId: actor.membershipId, isActivePrincipal: access.isPrincipal }, sheet.membershipId).length > 0;
    if (!access.ownerAdmin && !onReview) throw new Forbidden();
    await sendBack(db, actor, sheet, parsed.data.note.trim(), "status_changed", now);
    return who.initials;
  });
  return r.ok ? { ok: true, message: `Returned to ${r.data}.` } : r;
}

/** Reopen an approved sheet: owner/admin, never their own. */
export async function reopenTimesheetCore(actor: ApprovalActor, raw: unknown, now: Date = new Date()): Promise<ApprovalResult> {
  if (!can(actor.member, "time.reopen")) return forbidden;
  const parsed = noteInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: APPROVAL_MESSAGES.notFound };
  const r = await run(actor, async (db) => {
    const sheet = await lockSheet(db, parsed.data.timesheetId);
    if (sheet.membershipId === actor.membershipId) throw new Forbidden();
    const who = await submitterOf(db, sheet.membershipId);
    const problem = returnNoteProblem(parsed.data.note, who.initials);
    if (problem) throw new ApprovalError(problem);
    if (sheet.status !== "approved") throw new ApprovalError(APPROVAL_MESSAGES.notApproved);
    // Invoiced entries block Reopen from 1.8 (invoices don't exist yet).
    await sendBack(db, actor, sheet, parsed.data.note.trim(), "reopened", now);
    return who.initials;
  });
  return r.ok ? { ok: true, message: `Reopened and returned to ${r.data}.` } : r;
}
