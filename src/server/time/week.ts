import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  activities,
  memberships,
  overheadCategories,
  projectMembers,
  projectPhases,
  projects,
  timeEntries,
  timesheetRows,
  timesheets,
  users,
} from "@/db/schema";
import type { TenantDb } from "@/db/tenant";
import {
  type CalcRow,
  type NotesRule,
  type RowType,
  type TimesheetStatus,
  addDays,
  dueDate,
  isEditable,
  isHourlyFee,
  weekDates,
  weekStartOf,
  zonedInstant,
} from "@/lib/calc/timesheet";
import { canRecallReview, routeLabel, waitingLabel } from "@/lib/calc/review-route";
import { todayIn } from "@/lib/format";
import { initials as initialsFromName } from "@/lib/initials";
import { loadReview } from "./review";

// Loads one person's week for the timesheet page (timesheet spec, Data
// shown). Only their own timesheet, and never rates: the view model has no
// bill or cost fields at all (rule 16).

/** Who is asking and the firm rules the page needs. Built on the server. */
export type TimeContext = {
  firmId: string;
  userId: string;
  membershipId: string;
  timezone: string;
  weekStartsOn: number;
  lockDay: number;
  /** "09:00:00" */
  dueTime: string;
  notesRule: NotesRule;
};

export type PhaseOption = {
  id: string;
  label: string;
  closed: boolean;
  current: boolean;
};

export type OptionList = { id: string; name: string }[];

export type TimesheetOptions = {
  myProjects: { id: string; label: string }[];
  otherProjects: { id: string; label: string }[];
  /** Phases of every project offered or used on a row. */
  phases: Record<string, PhaseOption[]>;
  projectActivities: OptionList;
  /** Overhead phases (non-leave), each with its activities. */
  overhead: { id: string; name: string; activities: OptionList }[];
  leave: { id: string; name: string; activities: OptionList }[];
};

export type ViewRow = CalcRow & {
  projectId: string | null;
  sortOrder: number;
  /** The row's category is switched off (shows "· inactive"). */
  categoryInactive: boolean;
};

export type TimesheetView = {
  weekStart: string;
  /** The firm's time zone, for showing times. */
  timezone: string;
  dates: string[];
  today: string;
  currentWeekStart: string;
  /** Next is disabled after this week (8 weeks ahead). */
  lastWeekStart: string;
  /** "Mon Oct 19, 9:00 AM" */
  dueLabel: string;
  dueAt: string;
  late: boolean;
  timesheetId: string | null;
  status: TimesheetStatus | null;
  editable: boolean;
  canRecall: boolean;
  submittedAt: string | null;
  /** Who the sheet waits on now: "JR", "BM, PD" or "a principal" (null = not in review). */
  waitingOn: string | null;
  /** The route still ahead: "JR, then BM" (null = not in review). */
  routeAhead: string | null;
  /** The latest approval in this review, if any. */
  lastApprovedBy: string | null;
  lastApprovedAt: string | null;
  /** A principal's own sheet, approved when they submitted (#22). */
  autoApproved: boolean;
  /** Submitting approves at once (#22): the button reads "Submit and approve". */
  isPrincipal: boolean;
  approvedAt: string | null;
  approvedBy: string | null;
  rejectedAt: string | null;
  rejectedBy: string | null;
  rejectionNote: string | null;
  targetHours: number;
  targetUtilizationPct: number | null;
  notesRule: NotesRule;
  rows: ViewRow[];
  options: TimesheetOptions;
};

/** Weeks ahead someone may open (Next is disabled after this). */
export const WEEKS_AHEAD = 8;

const DUE_PARTS: Intl.DateTimeFormatOptions = {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

/** "Mon Oct 19, 9:00 AM" in the firm's time zone. */
function dueLabel(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { ...DUE_PARTS, timeZone }).formatToParts(at);
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return `${p("weekday")} ${p("month")} ${p("day")}, ${p("hour")}:${p("minute")} ${p("dayPeriod")}`;
}

const phaseSuffix = (status: string, additional: boolean) =>
  [status === "current" && "current", status === "closed" && "closed", status === "complete" && "complete", additional && "additional service"]
    .filter(Boolean)
    .map((s) => ` · ${s}`)
    .join("");

type PersonRef = { firstName: string; lastName: string; initials: string };
const initialsOf = (u: PersonRef | undefined) =>
  u ? u.initials || initialsFromName(`${u.firstName} ${u.lastName}`) : null;

/** The person's timesheet row for a week, if there is one. */
export async function findTimesheet(db: TenantDb, membershipId: string, weekStart: string) {
  const [t] = await db
    .select()
    .from(timesheets)
    .where(and(eq(timesheets.membershipId, membershipId), eq(timesheets.weekStart, weekStart)));
  return t ?? null;
}

/** Load the week. `weekStart` must already be a week-start day. */
export async function loadWeek(
  db: TenantDb,
  ctx: TimeContext,
  weekStart: string,
  now: Date = new Date(),
): Promise<TimesheetView> {
  const today = todayIn(ctx.timezone, now);
  const currentWeekStart = weekStartOf(today, ctx.weekStartsOn);
  const dates = weekDates(weekStart);
  const due = dueDate(weekStart, ctx.lockDay);
  const dueAt = zonedInstant(due, ctx.dueTime, ctx.timezone);

  const [me] = await db
    .select({
      capacity: memberships.weeklyCapacityHours,
      target: memberships.targetUtilizationBp,
      isPrincipal: memberships.isPrincipal,
    })
    .from(memberships)
    .where(eq(memberships.id, ctx.membershipId));

  const sheet = await findTimesheet(db, ctx.membershipId, weekStart);

  // Rows and their hours.
  const rowRecords = sheet
    ? await db
        .select()
        .from(timesheetRows)
        .where(and(eq(timesheetRows.timesheetId, sheet.id), isNull(timesheetRows.archivedAt)))
        .orderBy(asc(timesheetRows.sortOrder), asc(timesheetRows.createdAt))
    : [];
  const entries = sheet
    ? await db
        .select({ rowId: timeEntries.timesheetRowId, workDate: timeEntries.workDate, hours: timeEntries.hours, note: timeEntries.note })
        .from(timeEntries)
        .where(and(eq(timeEntries.timesheetId, sheet.id), isNull(timeEntries.archivedAt)))
    : [];

  // Options: active projects (mine first), plus any project already on a row.
  const active = await db
    .select({ id: projects.id, number: projects.number, name: projects.name })
    .from(projects)
    .where(and(eq(projects.status, "active"), isNull(projects.archivedAt)))
    .orderBy(asc(projects.number));
  const mine = new Set(
    (
      await db
        .select({ id: projectMembers.projectId })
        .from(projectMembers)
        .where(and(eq(projectMembers.membershipId, ctx.membershipId), isNull(projectMembers.archivedAt)))
    ).map((r) => r.id),
  );
  const rowProjectIds = [...new Set(rowRecords.flatMap((r) => (r.projectId ? [r.projectId] : [])))];
  const rowProjects = rowProjectIds.length
    ? await db
        .select({ id: projects.id, number: projects.number, name: projects.name, status: projects.status })
        .from(projects)
        .where(inArray(projects.id, rowProjectIds))
    : [];
  const projectIds = [...new Set([...active.map((p) => p.id), ...rowProjectIds])];
  const projectInfo = new Map<string, { number: string; name: string; closed: boolean }>();
  for (const p of active) projectInfo.set(p.id, { number: p.number, name: p.name, closed: false });
  for (const p of rowProjects) projectInfo.set(p.id, { number: p.number, name: p.name, closed: p.status === "closed" });

  const phaseRecords = projectIds.length
    ? await db
        .select()
        .from(projectPhases)
        .where(and(inArray(projectPhases.projectId, projectIds), isNull(projectPhases.archivedAt)))
        .orderBy(asc(projectPhases.sortOrder))
    : [];
  const phases: Record<string, PhaseOption[]> = {};
  const phaseById = new Map(phaseRecords.map((p) => [p.id, p]));
  for (const p of phaseRecords) {
    const projectClosed = projectInfo.get(p.projectId)?.closed ?? false;
    (phases[p.projectId] ??= []).push({
      id: p.id,
      label: `${p.name}${phaseSuffix(p.status, p.isAdditionalService)}`,
      closed: p.status === "closed" || projectClosed,
      current: p.status === "current",
    });
  }

  const categoryRecords = await db.select().from(overheadCategories).orderBy(asc(overheadCategories.sortOrder));
  const activityRecords = await db.select().from(activities).orderBy(asc(activities.sortOrder));
  const actsFor = (categoryId: string) =>
    activityRecords
      .filter((a) => a.active && a.appliesTo === "overhead" && a.overheadCategoryId === categoryId)
      .map((a) => ({ id: a.id, name: a.name }));
  const categoryById = new Map(categoryRecords.map((c) => [c.id, c]));
  const activityById = new Map(activityRecords.map((a) => [a.id, a]));

  // The sheet's review: who it waits on and who has approved (rules 14, 18).
  const review = sheet ? await loadReview(db, sheet.id) : [];
  const approvals = review
    .filter((r) => r.status === "approved" && r.actedAt)
    .sort((x, y) => x.actedAt!.getTime() - y.actedAt!.getTime());
  const lastApproval = approvals.at(-1) ?? null;

  // Names of the people who acted on the sheet or are on its review.
  const actorIds = [
    ...(sheet ? [sheet.approvedBy, sheet.rejectedBy] : []),
    lastApproval?.actedBy,
  ].filter((v): v is string => !!v);
  const actorRecords = actorIds.length
    ? await db
        .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, initials: users.initials })
        .from(users)
        .where(inArray(users.id, actorIds))
    : [];
  const actors = new Map(actorRecords.map((u) => [u.id, u]));
  const reviewerIds = [...new Set(review.flatMap((r) => (r.approverMembershipId ? [r.approverMembershipId] : [])))];
  const reviewerRecords = reviewerIds.length
    ? await db
        .select({ id: memberships.id, firstName: users.firstName, lastName: users.lastName, initials: users.initials })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(inArray(memberships.id, reviewerIds))
    : [];
  const reviewers = new Map(reviewerRecords.map((u) => [u.id, u]));
  const reviewerInitials = (id: string) => initialsOf(reviewers.get(id)) ?? "?";
  const inReview = sheet?.status === "submitted";

  const rows: ViewRow[] = rowRecords.map((r) => {
    const hours = dates.map(() => 0);
    const notes: (string | null)[] = dates.map(() => null);
    for (const e of entries) {
      if (e.rowId !== r.id) continue;
      const i = dates.indexOf(e.workDate);
      if (i < 0) continue;
      hours[i] = Number(e.hours);
      notes[i] = e.note;
    }
    const project = r.projectId ? projectInfo.get(r.projectId) : undefined;
    const phase = r.projectPhaseId ? phaseById.get(r.projectPhaseId) : undefined;
    const category = r.overheadCategoryId ? categoryById.get(r.overheadCategoryId) : undefined;
    const activity = r.activityId ? activityById.get(r.activityId) : undefined;
    return {
      id: r.id,
      sortOrder: r.sortOrder,
      rowType: r.rowType as RowType | null,
      projectId: r.projectId,
      projectPhaseId: r.projectPhaseId,
      overheadCategoryId: r.overheadCategoryId,
      activityId: r.activityId,
      billable: r.billable,
      hours,
      notes,
      projectNumber: project?.number ?? null,
      projectName: project?.name ?? null,
      phaseName: phase?.name ?? null,
      categoryName: category?.name ?? null,
      activityName: activity?.name ?? null,
      closed: (project?.closed ?? false) || phase?.status === "closed",
      activityInactive: activity ? !activity.active : false,
      hourly: isHourlyFee(phase?.feeType),
      categoryInactive: category ? !category.active : false,
    };
  });

  const label = (p: { number: string; name: string }) => `${p.number} · ${p.name}`;
  const status = (sheet?.status ?? null) as TimesheetStatus | null;
  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
  return {
    weekStart,
    timezone: ctx.timezone,
    dates,
    today,
    currentWeekStart,
    lastWeekStart: addDays(currentWeekStart, 7 * WEEKS_AHEAD),
    dueLabel: dueLabel(dueAt, ctx.timezone),
    dueAt: dueAt.toISOString(),
    late: now > dueAt && isEditable(status),
    timesheetId: sheet?.id ?? null,
    status,
    editable: isEditable(status),
    canRecall: canRecallReview(status, review),
    submittedAt: iso(sheet?.submittedAt),
    waitingOn: inReview ? waitingLabel(review, reviewerInitials) : null,
    routeAhead: inReview ? routeLabel(review, reviewerInitials) : null,
    lastApprovedBy: initialsOf(lastApproval?.actedBy ? actors.get(lastApproval.actedBy) : undefined),
    lastApprovedAt: iso(lastApproval?.actedAt),
    autoApproved: status === "approved" && review.length === 0 && !!sheet?.approvedBy && sheet.approvedBy === ctx.userId,
    isPrincipal: me?.isPrincipal ?? false,
    approvedAt: iso(sheet?.approvedAt),
    approvedBy: initialsOf(sheet?.approvedBy ? actors.get(sheet.approvedBy) : undefined),
    rejectedAt: iso(sheet?.rejectedAt),
    rejectedBy: initialsOf(sheet?.rejectedBy ? actors.get(sheet.rejectedBy) : undefined),
    rejectionNote: sheet?.rejectionNote ?? null,
    targetHours: Number(me?.capacity ?? 40),
    targetUtilizationPct: me?.target == null ? null : me.target / 100,
    notesRule: ctx.notesRule,
    rows,
    options: {
      myProjects: active.filter((p) => mine.has(p.id)).map((p) => ({ id: p.id, label: label(p) })),
      otherProjects: active.filter((p) => !mine.has(p.id)).map((p) => ({ id: p.id, label: label(p) })),
      phases,
      projectActivities: activityRecords
        .filter((a) => a.active && a.appliesTo === "project")
        .map((a) => ({ id: a.id, name: a.name })),
      overhead: categoryRecords
        .filter((c) => c.active && !c.isLeave)
        .map((c) => ({ id: c.id, name: c.name, activities: actsFor(c.id) })),
      leave: categoryRecords
        .filter((c) => c.active && c.isLeave)
        .map((c) => ({ id: c.id, name: c.name, activities: actsFor(c.id) })),
    },
  };
}

/** Past timesheets for History (newest first), with their totals. */
export async function loadHistory(db: TenantDb, ctx: TimeContext, now: Date = new Date(), limit = 26, before?: string) {
  const currentWeekStart = weekStartOf(todayIn(ctx.timezone, now), ctx.weekStartsOn);
  const cutoff = before && before < currentWeekStart ? before : currentWeekStart;
  const sheets = await db
    .select({ id: timesheets.id, weekStart: timesheets.weekStart, status: timesheets.status })
    .from(timesheets)
    .where(eq(timesheets.membershipId, ctx.membershipId))
    .orderBy(asc(timesheets.weekStart));
  const past = sheets.filter((s) => s.weekStart < cutoff).reverse();
  const page = past.slice(0, limit);
  const ids = page.map((s) => s.id);
  const sums = ids.length
    ? await db
        .select({ id: timeEntries.timesheetId, hours: timeEntries.hours, billable: timeEntries.billable })
        .from(timeEntries)
        .where(and(inArray(timeEntries.timesheetId, ids), isNull(timeEntries.archivedAt)))
    : [];
  return {
    total: past.length,
    hasMore: past.length > limit,
    weeks: page.map((s) => {
      const mineRows = sums.filter((x) => x.id === s.id);
      const total = mineRows.reduce((a, x) => a + Number(x.hours), 0);
      const billable = mineRows.filter((x) => x.billable).reduce((a, x) => a + Number(x.hours), 0);
      return { weekStart: s.weekStart, status: s.status as TimesheetStatus, total, billable };
    }),
  };
}
