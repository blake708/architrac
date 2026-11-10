import { and, asc, desc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import {
  memberships,
  projects,
  rates,
  reviewSteps,
  teams,
  timeEntries,
  timesheetReviewSteps,
  users,
} from "@/db/schema";
import type { TenantDb } from "@/db/tenant";
import {
  type RouteStep,
  buildReview,
  freezeRates,
} from "@/lib/calc/review-route";

// A sheet's review (timesheet-approval spec, rule 1; decisions #22, #23).
// Reads the firm's route and the facts it needs, then saves the sheet's own
// copy so later route, team or PIC changes never move a waiting sheet.

/** The firm's route, in order. */
export async function loadRoute(db: TenantDb): Promise<(RouteStep & { id: string })[]> {
  const rows = await db
    .select({ id: reviewSteps.id, kind: reviewSteps.kind, membershipId: reviewSteps.membershipId })
    .from(reviewSteps)
    .where(isNull(reviewSteps.archivedAt))
    .orderBy(asc(reviewSteps.sortOrder), asc(reviewSteps.createdAt));
  return rows;
}

/** A sheet's current (non-archived) review rows, in step order. */
export async function loadReview(db: TenantDb, timesheetId: string) {
  return db
    .select({
      stepNo: timesheetReviewSteps.stepNo,
      kind: timesheetReviewSteps.kind,
      approverMembershipId: timesheetReviewSteps.approverMembershipId,
      status: timesheetReviewSteps.status,
      skipReason: timesheetReviewSteps.skipReason,
      actedBy: timesheetReviewSteps.actedBy,
      actedAt: timesheetReviewSteps.actedAt,
      onBehalf: timesheetReviewSteps.onBehalf,
    })
    .from(timesheetReviewSteps)
    .where(and(eq(timesheetReviewSteps.timesheetId, timesheetId), isNull(timesheetReviewSteps.archivedAt)))
    .orderBy(asc(timesheetReviewSteps.stepNo), asc(timesheetReviewSteps.createdAt));
}

/** Recall and Return: the review is kept for history, the next submit builds a new one. */
export async function archiveReview(db: TenantDb, timesheetId: string, now: Date) {
  await db
    .update(timesheetReviewSteps)
    .set({ archivedAt: now, updatedAt: now })
    .where(and(eq(timesheetReviewSteps.timesheetId, timesheetId), isNull(timesheetReviewSteps.archivedAt)));
}

type Submitter = { firmId: string; membershipId: string };

export type StartResult =
  | { ok: true; status: "submitted"; rows: number }
  | { ok: true; status: "approved" }
  | { ok: false; message: string };

/**
 * Submit: build and save the sheet's review, or approve a principal's own
 * sheet straight away with its rates frozen (#22). Call inside the submit
 * transaction, after the sheet is locked and validated.
 */
export async function startReview(db: TenantDb, who: Submitter, timesheetId: string): Promise<StartResult> {
  const [me] = await db
    .select({
      isPrincipal: memberships.isPrincipal,
      teamId: memberships.teamId,
      firmRoleId: memberships.firmRoleId,
      initials: users.initials,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.id, who.membershipId));

  if (me.isPrincipal) {
    const frozen = await freezeSheetRates(db, timesheetId, who.membershipId, me.firmRoleId, me.initials);
    return frozen.ok ? { ok: true, status: "approved" } : frozen;
  }

  const route = await loadRoute(db);

  let teamLeader: { membershipId: string; active: boolean } | null = null;
  if (me.teamId) {
    const [t] = await db
      .select({ membershipId: teams.leaderMembershipId, active: memberships.active, archivedAt: memberships.archivedAt })
      .from(teams)
      .leftJoin(memberships, eq(memberships.id, teams.leaderMembershipId))
      .where(and(eq(teams.id, me.teamId), isNull(teams.archivedAt)));
    if (t?.membershipId) teamLeader = { membershipId: t.membershipId, active: !!t.active && !t.archivedAt };
  }

  const picRows = await db
    .selectDistinct({ membershipId: projects.principalMembershipId, active: memberships.active, archivedAt: memberships.archivedAt })
    .from(timeEntries)
    .innerJoin(projects, eq(projects.id, timeEntries.projectId))
    .innerJoin(memberships, eq(memberships.id, projects.principalMembershipId))
    .where(and(eq(timeEntries.timesheetId, timesheetId), isNull(timeEntries.archivedAt), isNotNull(timeEntries.projectId)));
  const pics = picRows
    .map((p) => ({ membershipId: p.membershipId, active: p.active && !p.archivedAt }))
    .sort((a, b) => a.membershipId.localeCompare(b.membershipId));

  const namedIds = route.flatMap((s) => (s.membershipId ? [s.membershipId] : []));
  const named = namedIds.length
    ? await db
        .select({ membershipId: memberships.id, active: memberships.active, archivedAt: memberships.archivedAt })
        .from(memberships)
        .where(inArray(memberships.id, namedIds))
    : [];

  const principals = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.isPrincipal, true), eq(memberships.active, true), isNull(memberships.archivedAt)));

  const result = buildReview(route, {
    submitterId: who.membershipId,
    submitterIsPrincipal: false,
    teamLeader,
    pics,
    people: new Map(named.map((p) => [p.membershipId, { membershipId: p.membershipId, active: p.active && !p.archivedAt }])),
    activePrincipalIds: principals.map((p) => p.id),
  });
  if (result.kind === "refuse") return { ok: false, message: result.message };
  if (result.kind === "auto_approve") return { ok: true, status: "approved" }; // not reached: principals return above

  await db.insert(timesheetReviewSteps).values(
    result.rows.map((r) => ({
      firmId: who.firmId,
      timesheetId,
      stepNo: r.stepNo,
      kind: r.kind,
      approverMembershipId: r.approverMembershipId,
      status: r.status,
      skipReason: r.skipReason,
    })),
  );
  return { ok: true, status: "submitted", rows: result.rows.length };
}

/**
 * Rules 2 and 3c: freeze bill and cost rates onto every live entry of the
 * sheet, from the person's override or their role's rate on each work date.
 * Writes nothing if any date has no rate.
 */
export async function freezeSheetRates(
  db: TenantDb,
  timesheetId: string,
  membershipId: string,
  firmRoleId: string | null,
  initials: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const entries = await db
    .select({ id: timeEntries.id, workDate: timeEntries.workDate })
    .from(timeEntries)
    .where(and(eq(timeEntries.timesheetId, timesheetId), isNull(timeEntries.archivedAt)));
  if (!entries.length) return { ok: true };

  const rateRows = await db
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
      firmRoleId
        ? or(eq(rates.membershipId, membershipId), eq(rates.firmRoleId, firmRoleId))
        : eq(rates.membershipId, membershipId),
    )
    // Latest start first, so the newest of overlapping periods wins (rule 1).
    .orderBy(desc(rates.effectiveFrom));
  const latestFirst = rateRows;
  const plan = freezeRates(
    entries.map((e) => e.workDate),
    latestFirst.filter((r) => r.membershipId === membershipId),
    latestFirst.filter((r) => r.firmRoleId !== null && r.firmRoleId === firmRoleId),
    initials,
  );
  if (!plan.ok) return plan;
  for (const [i, e] of entries.entries()) {
    await db
      .update(timeEntries)
      .set({ billRateCents: plan.rates[i].billRateCents, costRateCents: plan.rates[i].costRateCents })
      .where(eq(timeEntries.id, e.id));
  }
  return { ok: true };
}
