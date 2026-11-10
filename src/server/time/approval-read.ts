import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { activityLog, memberships, timeEntries, timesheetReviewSteps, timesheets, users } from "@/db/schema";
import type { TenantDb } from "@/db/tenant";
import { type SavedReviewRow, STEP_LABELS, andList, currentRows, rowsFor, stepSummary } from "@/lib/calc/review-route";
import { type Flag, billablePct, timesheetFlags } from "@/lib/calc/timesheet-flags";
import { isWeekend, weekDates } from "@/lib/calc/timesheet";
import { formatMoney } from "@/lib/format";
import { initials as initialsFromName } from "@/lib/initials";
import { type ReviewChip, dayTimeLabel, historyLine, reviewChips, shortWeekRange } from "@/lib/time/approval";
import { weekRange } from "@/lib/time/display";
import { type ApprovalAccess, type ApprovalActor, approvalAccess, loadRateBook } from "./approval";
import { loadRoute } from "./review";
import { type ViewRow, loadWeek } from "./week";

// What the Approvals tab reads (timesheet-approval spec, Layout 2–5 and Data
// shown). Rates only ever leave this file for owner/admin (rule 12): the
// types below keep them in an optional `rates` field that is left out for
// everyone else.

type Person = {
  membershipId: string;
  firmRoleId: string | null;
  name: string;
  initials: string;
  title: string | null;
  capacity: number;
  avatarUrl: string | null;
};

export type QueueItem = {
  timesheetId: string;
  weekStart: string;
  person: Omit<Person, "firmRoleId">;
  /** Mon–Fri hours, for the bars. */
  days: number[];
  total: number;
  billable: number;
  billablePct: number;
  step: { label: string; note: string } | null;
  /** First flag (Layout 3), or null when clean. */
  flag: Flag | null;
};

export type QueueWeek = { weekStart: string; label: string; ready: number; withOthers: number; items: QueueItem[] };

export type ApprovalsQueue = {
  /** The firm's route, as chip labels. */
  route: string[];
  weeks: QueueWeek[];
  count: number;
};

type SheetRow = typeof timesheets.$inferSelect;
type Review = (SavedReviewRow & { id: string; timesheetId: string; skipReason: string | null; actedBy: string | null; onBehalf: boolean })[];

const nameOf = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`.trim();
const initialsOf = (u: { firstName: string; lastName: string; initials: string }) => u.initials || initialsFromName(nameOf(u));

/** A person without their role id, for the page. */
const publicPerson = (p: Person): Omit<Person, "firmRoleId"> => ({
  membershipId: p.membershipId,
  name: p.name,
  initials: p.initials,
  title: p.title,
  capacity: p.capacity,
  avatarUrl: p.avatarUrl,
});

async function peopleFor(db: TenantDb, ids: readonly string[]): Promise<Map<string, Person>> {
  if (!ids.length) return new Map();
  const rows = await db
    .select({
      membershipId: memberships.id,
      firmRoleId: memberships.firmRoleId,
      title: memberships.title,
      capacity: memberships.weeklyCapacityHours,
      firstName: users.firstName,
      lastName: users.lastName,
      initials: users.initials,
      avatarUrl: users.avatarUrl,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(inArray(memberships.id, [...new Set(ids)]));
  return new Map(
    rows.map((r) => [
      r.membershipId,
      {
        membershipId: r.membershipId,
        firmRoleId: r.firmRoleId,
        name: nameOf(r),
        initials: initialsOf(r),
        title: r.title,
        capacity: Number(r.capacity ?? 40),
        avatarUrl: r.avatarUrl,
      },
    ]),
  );
}

async function reviewsFor(db: TenantDb, sheetIds: readonly string[]): Promise<Map<string, Review>> {
  if (!sheetIds.length) return new Map();
  const rows = await db
    .select({
      id: timesheetReviewSteps.id,
      timesheetId: timesheetReviewSteps.timesheetId,
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
    .where(and(inArray(timesheetReviewSteps.timesheetId, [...sheetIds]), isNull(timesheetReviewSteps.archivedAt)))
    .orderBy(asc(timesheetReviewSteps.stepNo), asc(timesheetReviewSteps.createdAt));
  const out = new Map<string, Review>();
  for (const r of rows) (out.get(r.timesheetId) ?? out.set(r.timesheetId, []).get(r.timesheetId)!).push(r);
  return out;
}

/** Can this person see a sheet they aren't (yet) asked to act on? */
function canSee(access: ApprovalAccess, actor: ApprovalActor, sheet: SheetRow, review: Review, submitterTeamId: string | null) {
  if (sheet.membershipId === actor.membershipId) return false;
  if (access.ownerAdmin || access.isPrincipal) return true;
  if (submitterTeamId && access.leadsTeamIds.includes(submitterTeamId)) return true;
  return review.some((r) => r.approverMembershipId === actor.membershipId);
}

const me = (actor: ApprovalActor, access: ApprovalAccess) => ({
  membershipId: actor.membershipId,
  isActivePrincipal: access.isPrincipal,
});

/** Sheets in review, with who they're waiting on. */
async function inReview(db: TenantDb) {
  const sheets = await db.select().from(timesheets).where(eq(timesheets.status, "submitted"));
  const reviews = await reviewsFor(db, sheets.map((s) => s.id));
  const teamRows = sheets.length
    ? await db
        .select({ id: memberships.id, teamId: memberships.teamId })
        .from(memberships)
        .where(inArray(memberships.id, [...new Set(sheets.map((s) => s.membershipId))]))
    : [];
  const teamOf = new Map(teamRows.map((t) => [t.id, t.teamId]));
  return { sheets, reviews, teamOf };
}

/** The ids of sheets waiting on me, in queue order (newest week, then last name). */
export async function queueOrder(db: TenantDb, actor: ApprovalActor, access: ApprovalAccess): Promise<string[]> {
  return (await loadQueue(db, actor, access)).weeks.flatMap((w) => w.items.map((i) => i.timesheetId));
}

/** How many sheets wait on me (tab count and KPI "Ready for you"). */
export async function queueCount(db: TenantDb, actor: ApprovalActor, access: ApprovalAccess): Promise<number> {
  if (!access.canOpen) return 0;
  const { sheets, reviews } = await inReview(db);
  return sheets.filter(
    (s) => s.membershipId !== actor.membershipId && rowsFor(reviews.get(s.id) ?? [], me(actor, access), s.membershipId).length,
  ).length;
}

/** "Waiting on me" (Layout 3). */
export async function loadQueue(db: TenantDb, actor: ApprovalActor, access: ApprovalAccess): Promise<ApprovalsQueue> {
  const route = await loadRoute(db);
  const { sheets, reviews, teamOf } = await inReview(db);
  const routeNames = await peopleFor(db, route.flatMap((s) => (s.membershipId ? [s.membershipId] : [])));
  const routeLabels = route.map((s) => (s.kind === "person" ? (routeNames.get(s.membershipId!)?.name ?? "Someone") : STEP_LABELS[s.kind]));

  const mine = sheets.filter((s) => rowsFor(reviews.get(s.id) ?? [], me(actor, access), s.membershipId).length > 0);
  const others = sheets.filter(
    (s) => !mine.includes(s) && canSee(access, actor, s, reviews.get(s.id) ?? [], teamOf.get(s.membershipId) ?? null),
  );

  const people = await peopleFor(db, [
    ...mine.map((s) => s.membershipId),
    ...[...reviews.values()].flat().flatMap((r) => (r.approverMembershipId ? [r.approverMembershipId] : [])),
  ]);
  const entries = mine.length
    ? await db
        .select({ timesheetId: timeEntries.timesheetId, workDate: timeEntries.workDate, hours: timeEntries.hours, billable: timeEntries.billable })
        .from(timeEntries)
        .where(and(inArray(timeEntries.timesheetId, mine.map((s) => s.id)), isNull(timeEntries.archivedAt)))
    : [];
  const rateOf = await loadRateBook(db, mine.map((s) => people.get(s.membershipId)!));
  const initials = (id: string) => people.get(id)?.initials ?? "?";

  const items: QueueItem[] = mine.map((s) => {
    const p = people.get(s.membershipId)!;
    const mineEntries = entries.filter((e) => e.timesheetId === s.id);
    const dates = weekDates(s.weekStart).filter((d) => !isWeekend(d));
    const days = dates.map((d) => mineEntries.filter((e) => e.workDate === d).reduce((a, e) => a + Number(e.hours), 0));
    const total = mineEntries.reduce((a, e) => a + Number(e.hours), 0);
    const billable = mineEntries.filter((e) => e.billable).reduce((a, e) => a + Number(e.hours), 0);
    const missing = mineEntries.filter((e) => !rateOf(p.membershipId, p.firmRoleId, e.workDate)).map((e) => e.workDate);
    const flags = timesheetFlags({ total, capacity: p.capacity, missingRateDates: missing, showRateDates: access.ownerAdmin });
    return {
      timesheetId: s.id,
      weekStart: s.weekStart,
      person: publicPerson(p),
      days,
      total,
      billable,
      billablePct: billablePct(billable, total),
      step: stepSummary(reviews.get(s.id) ?? [], actor.membershipId, initials),
      flag: flags[0] ?? null,
    };
  });
  const lastName = (i: QueueItem) => i.person.name.split(" ").slice(-1)[0] ?? "";
  items.sort((a, b) => b.weekStart.localeCompare(a.weekStart) || lastName(a).localeCompare(lastName(b)) || a.person.name.localeCompare(b.person.name));

  const weekStarts = [...new Set(items.map((i) => i.weekStart))];
  const weeks = weekStarts.map((w) => {
    const here = items.filter((i) => i.weekStart === w);
    return {
      weekStart: w,
      label: shortWeekRange(w),
      ready: here.length,
      withOthers: others.filter((s) => s.weekStart === w).length,
      items: here,
    };
  });
  return { route: routeLabels, weeks, count: items.length };
}

// ---------- Detail (Layout 5) ----------

export type RowRates = { bill: string; cost: string; missing: boolean };

export type ApprovalDetail = {
  timesheetId: string;
  weekStart: string;
  status: string;
  person: Omit<Person, "firmRoleId">;
  meta: string;
  chips: ReviewChip[];
  dates: string[];
  rows: ViewRow[];
  total: number;
  billable: number;
  billablePct: number;
  flags: Flag[];
  history: string[];
  rejectionNote: string | null;
  /** Owner/admin only (rule 12). */
  rates?: Record<string, RowRates>;
  canApprove: boolean;
  /** "BM, PD" when an owner/admin can step in for whoever the step waits on. */
  approveFor: string | null;
  canReturn: boolean;
  canReopen: boolean;
  prevId: string | null;
  nextId: string | null;
};

/** One sheet for review, or null when this person can't see it (→ 404). */
export async function loadApprovalDetail(
  db: TenantDb,
  actor: ApprovalActor,
  access: ApprovalAccess,
  timesheetId: string,
): Promise<ApprovalDetail | null> {
  if (!access.canOpen) return null;
  const [sheet] = await db.select().from(timesheets).where(eq(timesheets.id, timesheetId));
  if (!sheet || sheet.status === "draft") return null;
  const review = (await reviewsFor(db, [sheet.id])).get(sheet.id) ?? [];
  const [sub] = await db
    .select({ teamId: memberships.teamId })
    .from(memberships)
    .where(eq(memberships.id, sheet.membershipId));
  const ownerAdminOnReopen = access.ownerAdmin && sheet.status === "approved";
  if (!canSee(access, actor, sheet, review, sub?.teamId ?? null) && !ownerAdminOnReopen) return null;
  if (sheet.membershipId === actor.membershipId) return null;

  const reviewerIds = review.flatMap((r) => (r.approverMembershipId ? [r.approverMembershipId] : []));
  const people = await peopleFor(db, [sheet.membershipId, ...reviewerIds]);
  const p = people.get(sheet.membershipId)!;
  const initials = (id: string) => people.get(id)?.initials ?? "?";

  const week = await loadWeek(db, { ...actor, membershipId: sheet.membershipId }, sheet.weekStart);
  const entries = await db
    .select({
      rowId: timeEntries.timesheetRowId,
      workDate: timeEntries.workDate,
      hours: timeEntries.hours,
      billable: timeEntries.billable,
      bill: timeEntries.billRateCents,
      cost: timeEntries.costRateCents,
    })
    .from(timeEntries)
    .where(and(eq(timeEntries.timesheetId, sheet.id), isNull(timeEntries.archivedAt)));
  const total = entries.reduce((a, e) => a + Number(e.hours), 0);
  const billable = entries.filter((e) => e.billable).reduce((a, e) => a + Number(e.hours), 0);

  // Frozen rates once approved, else the lookup preview.
  const rateOf = await loadRateBook(db, [p]);
  const perEntry = entries.map((e) => {
    if (sheet.status === "approved" && e.bill !== null && e.cost !== null) return { ...e, rate: { billRateCents: e.bill, costRateCents: e.cost } };
    const r = rateOf(p.membershipId, p.firmRoleId, e.workDate);
    return { ...e, rate: r ? { billRateCents: r.billRateCents, costRateCents: r.costRateCents } : null };
  });
  const missing = perEntry.filter((e) => !e.rate).map((e) => e.workDate);
  const flags = timesheetFlags({ total, capacity: p.capacity, missingRateDates: missing, showRateDates: access.ownerAdmin });

  let rates: Record<string, RowRates> | undefined;
  if (access.ownerAdmin) {
    rates = {};
    const show = (vals: number[]) => [...new Set(vals)].sort((a, b) => a - b).map((c) => formatMoney(c)).join(" / ");
    for (const row of week.rows) {
      const es = perEntry.filter((e) => e.rowId === row.id);
      const known = es.flatMap((e) => (e.rate ? [e.rate] : []));
      rates[row.id] = {
        bill: show(known.map((r) => r.billRateCents)),
        cost: show(known.map((r) => r.costRateCents)),
        missing: known.length < es.length,
      };
    }
  }

  // History: every activity on this sheet, oldest first.
  const logs = await db
    .select({ action: activityLog.action, changes: activityLog.changes, at: activityLog.createdAt, actorUserId: activityLog.actorUserId })
    .from(activityLog)
    .where(and(eq(activityLog.entityType, "timesheet"), eq(activityLog.entityId, sheet.id)))
    .orderBy(asc(activityLog.createdAt));
  const actorIds = [...new Set([...logs.map((l) => l.actorUserId), ...review.map((r) => r.actedBy)].filter((v): v is string => !!v))];
  const actorRows = actorIds.length
    ? await db
        .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, initials: users.initials })
        .from(users)
        .where(inArray(users.id, actorIds))
    : [];
  const actorInitials = new Map(actorRows.map((u) => [u.id, initialsOf(u)]));
  const history = logs
    .map((l) =>
      historyLine(
        {
          action: l.action,
          changes: (l.changes as Record<string, unknown> | null) ?? null,
          actor: l.actorUserId ? (actorInitials.get(l.actorUserId) ?? null) : null,
          at: l.at,
        },
        actor.timezone,
      ),
    )
    .filter((l): l is string => !!l);

  const chips = reviewChips(
    review.map((r) => ({
      stepNo: r.stepNo,
      kind: r.kind,
      status: r.status,
      skipReason: r.skipReason,
      approver: r.approverMembershipId ? initials(r.approverMembershipId) : null,
      actedBy: r.actedBy ? (actorInitials.get(r.actedBy) ?? null) : null,
      actedAt: r.actedAt,
      onBehalf: r.onBehalf,
    })),
    actor.timezone,
  );

  const submitted = sheet.status === "submitted";
  const canApprove = submitted && rowsFor(review, me(actor, access), sheet.membershipId).length > 0;
  const waitingNow = submitted ? currentRows(review) : [];
  const approveFor =
    access.ownerAdmin && submitted && !canApprove && waitingNow.length
      ? waitingNow.some((r) => r.approverMembershipId === null)
        ? "a principal"
        : andList(waitingNow.map((r) => initials(r.approverMembershipId!)).sort())
      : null;
  const onReview = review.some((r) => r.approverMembershipId === actor.membershipId && r.status !== "skipped");
  const canReturn = submitted && (access.ownerAdmin || canApprove || onReview);

  const order = await queueOrder(db, actor, access);
  const at = order.indexOf(sheet.id);

  return {
    timesheetId: sheet.id,
    weekStart: sheet.weekStart,
    status: sheet.status,
    person: publicPerson(p),
    meta: [
      p.initials,
      p.title,
      `Week of ${weekRange(sheet.weekStart)}`,
      sheet.submittedAt ? `Submitted ${dayTimeLabel(sheet.submittedAt, actor.timezone)}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    chips,
    dates: week.dates,
    rows: week.rows,
    total,
    billable,
    billablePct: billablePct(billable, total),
    flags,
    history,
    rejectionNote: sheet.rejectionNote,
    ...(rates ? { rates } : {}),
    canApprove,
    approveFor,
    canReturn,
    canReopen: access.ownerAdmin && sheet.status === "approved",
    prevId: at > 0 ? order[at - 1] : null,
    nextId: at >= 0 && at < order.length - 1 ? order[at + 1] : null,
  };
}

/** The Approvals tab count, or null when this person has no Approvals tab. */
export async function approvalsTabCount(db: TenantDb, actor: ApprovalActor): Promise<number | null> {
  const access = await approvalAccess(db, actor);
  return access.canOpen ? queueCount(db, actor, access) : null;
}
