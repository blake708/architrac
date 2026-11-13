import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import { activityLog, memberships, reviewSteps, teams, timeEntries, timesheets } from "@/db/schema";
import type { TenantDb } from "@/db/tenant";
import { andList, currentRows, rowsFor } from "@/lib/calc/review-route";
import {
  type DueRules,
  type OverviewStatus,
  REMIND_GAP_MS,
  type StatusBadge,
  canSendAgain,
  cardSummary,
  dueAt,
  isMissing,
  lastDueWeek,
  statusBadge,
} from "@/lib/calc/reminders";
import { type Flag, billablePct, timesheetFlags } from "@/lib/calc/timesheet-flags";
import { addDays, isWeekend, weekDates, weekStartOf, zonedInstant } from "@/lib/calc/timesheet";
import { todayIn } from "@/lib/format";
import { dayTimeLabel } from "@/lib/time/approval";
import { weekRange } from "@/lib/time/display";
import { type ApprovalAccess, type ApprovalActor } from "./approval";
import { loadRateBook } from "./rate-book";
import { type Person, peopleFor, publicPerson, reviewsFor } from "./approval-read";

// Time → Approvals → Week overview (timesheet-approval spec, Layout 4 and
// rules 7–8). One card per team with everyone's status for one week, and
// what this person may do about each row. Names are shown in full.

export const rulesOf = (a: ApprovalActor): DueRules => ({
  timezone: a.timezone,
  weekStartsOn: a.weekStartsOn,
  lockDay: a.lockDay,
  dueTime: a.dueTime,
});

export type OverviewRow = {
  membershipId: string;
  person: Omit<Person, "firmRoleId">;
  timesheetId: string | null;
  status: OverviewStatus;
  badge: StatusBadge;
  days: number[];
  total: number;
  billablePct: number;
  flag: Flag | null;
  /** Approve / Return: the sheet waits on me. */
  canApprove: boolean;
  /** "Jo Reyes" / "Blake Mason and Pat Dunn": owner/admin can step in. */
  approveFor: string | null;
  /** Send reminder: allowed, and when the last manual one went (blocks for 12 h). */
  remind: { allowed: boolean; sentAt: string | null } | null;
  /** Nudge the named approvers the sheet waits on (owner/admin/principals). */
  nudge: { label: string; membershipIds: string[]; sentAt: string | null } | null;
};

export type OverviewCard = {
  teamId: string | null;
  name: string;
  leader: { name: string; initials: string; avatarUrl: string | null } | null;
  summary: string;
  rows: OverviewRow[];
  /** Missing people this person may remind and who weren't reminded in the last 12 h. */
  remindable: number;
  missing: number;
};

export type WeekOverview = {
  weekStart: string;
  meta: string;
  defaultWeek: string;
  prevWeek: string;
  nextWeek: string | null;
  cards: OverviewCard[];
  notSubmitted: number;
};

type Scope = "everyone" | "teams" | "waiting";

async function scopeOf(db: TenantDb, actor: ApprovalActor, access: ApprovalAccess): Promise<Scope> {
  if (access.ownerAdmin || access.isPrincipal) return "everyone";
  const [named] = await db
    .select({ id: reviewSteps.id })
    .from(reviewSteps)
    .where(and(eq(reviewSteps.membershipId, actor.membershipId), isNull(reviewSteps.archivedAt)))
    .limit(1);
  if (named) return "everyone";
  return access.leadsTeamIds.length ? "teams" : "waiting";
}

/** May this person remind that one (rule: owner/admin/principal; team leaders for their team)? */
export function canRemind(access: ApprovalAccess, personTeamId: string | null): boolean {
  return access.ownerAdmin || access.isPrincipal || (!!personTeamId && access.leadsTeamIds.includes(personTeamId));
}
export const canNudge = (access: ApprovalAccess) => access.ownerAdmin || access.isPrincipal;

/** The latest manual reminder per person for this week, within the last 12 h. */
export async function recentReminders(db: TenantDb, weekStart: string, now: Date): Promise<Map<string, Date>> {
  const rows = await db
    .select({ id: activityLog.entityId, at: activityLog.createdAt })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.entityType, "membership"),
        eq(activityLog.action, "reminder_sent"),
        sql`${activityLog.changes}->>'week_start' = ${weekStart}`,
        sql`coalesce((${activityLog.changes}->>'automatic')::boolean, false) = false`,
        gt(activityLog.createdAt, new Date(now.getTime() - REMIND_GAP_MS)),
      ),
    )
    .orderBy(desc(activityLog.createdAt));
  const out = new Map<string, Date>();
  for (const r of rows) if (!out.has(r.id)) out.set(r.id, r.at);
  return out;
}

/** The latest nudge per approver within the last 12 h. */
export async function recentNudges(db: TenantDb, now: Date): Promise<Map<string, Date>> {
  const rows = await db
    .select({ id: activityLog.entityId, at: activityLog.createdAt })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.entityType, "membership"),
        eq(activityLog.action, "nudged"),
        gt(activityLog.createdAt, new Date(now.getTime() - REMIND_GAP_MS)),
      ),
    )
    .orderBy(desc(activityLog.createdAt));
  const out = new Map<string, Date>();
  for (const r of rows) if (!out.has(r.id)) out.set(r.id, r.at);
  return out;
}

/** Active people who belong in a week: joined before it ended (rule 8). */
export async function peopleInWeek(db: TenantDb, weekStart: string, timezone: string) {
  const end = zonedInstant(addDays(weekStart, 7), "00:00", timezone);
  return db
    .select({ id: memberships.id, teamId: memberships.teamId })
    .from(memberships)
    .where(and(eq(memberships.active, true), isNull(memberships.archivedAt), lt(memberships.createdAt, end)));
}

export async function loadWeekOverview(
  db: TenantDb,
  actor: ApprovalActor,
  access: ApprovalAccess,
  weekStart: string,
  now: Date = new Date(),
): Promise<WeekOverview> {
  const rules = rulesOf(actor);
  const defaultWeek = lastDueWeek(now, rules);
  const currentWeek = weekStartOf(todayIn(actor.timezone, now), actor.weekStartsOn);
  const due = dueAt(weekStart, rules);
  const pastDue = now > due;
  const scope = await scopeOf(db, actor, access);

  let members = (await peopleInWeek(db, weekStart, actor.timezone)).filter((m) => m.id !== actor.membershipId);
  if (scope === "teams") members = members.filter((m) => m.teamId && access.leadsTeamIds.includes(m.teamId));
  const people = await peopleFor(db, members.map((m) => m.id));
  const teamOf = new Map(members.map((m) => [m.id, m.teamId]));

  const sheets = members.length
    ? await db
        .select()
        .from(timesheets)
        .where(and(eq(timesheets.weekStart, weekStart), inArray(timesheets.membershipId, members.map((m) => m.id))))
    : [];
  const sheetOf = new Map(sheets.map((s) => [s.membershipId, s]));
  const reviews = await reviewsFor(db, sheets.filter((s) => s.status === "submitted").map((s) => s.id));
  const approverIds = [...reviews.values()].flat().flatMap((r) => (r.approverMembershipId ? [r.approverMembershipId] : []));
  const names = await peopleFor(db, approverIds);
  const nameOf = (id: string) => names.get(id)?.name ?? people.get(id)?.name ?? "someone";

  const entries = sheets.length
    ? await db
        .select({ timesheetId: timeEntries.timesheetId, projectId: timeEntries.projectId, workDate: timeEntries.workDate, hours: timeEntries.hours, billable: timeEntries.billable })
        .from(timeEntries)
        .where(and(inArray(timeEntries.timesheetId, sheets.map((s) => s.id)), isNull(timeEntries.archivedAt)))
    : [];
  const { rateOf } = await loadRateBook(db, [...people.values()], entries.map((e) => e.projectId));
  const reminded = await recentReminders(db, weekStart, now);
  const nudged = await recentNudges(db, now);
  const me = { membershipId: actor.membershipId, isActivePrincipal: access.isPrincipal };
  const weekdays = weekDates(weekStart).filter((d) => !isWeekend(d));

  const rows: OverviewRow[] = members.flatMap((m) => {
    const p = people.get(m.id);
    if (!p) return [];
    const sheet = sheetOf.get(m.id);
    const review = sheet ? (reviews.get(sheet.id) ?? []) : [];
    const mineHere = sheet?.status === "submitted" && rowsFor(review, me, sheet.membershipId).length > 0;
    const status: OverviewStatus = !sheet
      ? "not_submitted"
      : sheet.status === "draft"
        ? "draft"
        : sheet.status === "rejected"
          ? "returned"
          : sheet.status === "approved"
            ? "approved"
            : mineHere
              ? "waiting_on_you"
              : "waiting_on_others";
    const waiting = sheet?.status === "submitted" ? currentRows(review) : [];
    const waitingNames = waiting.some((r) => r.approverMembershipId === null)
      ? "a principal"
      : andList(waiting.map((r) => nameOf(r.approverMembershipId!)).sort());
    const es = sheet ? entries.filter((e) => e.timesheetId === sheet.id) : [];
    const total = es.reduce((a, e) => a + Number(e.hours), 0);
    const billable = es.filter((e) => e.billable).reduce((a, e) => a + Number(e.hours), 0);
    const missingRates = es.filter((e) => !rateOf(p.membershipId, p.firmRoleId, e.workDate, e.projectId)).map((e) => e.workDate);
    const flags = sheet
      ? timesheetFlags({ total, capacity: p.capacity, missingRateDates: missingRates, showRateDates: access.ownerAdmin })
      : [];
    const namedWaiting = waiting.flatMap((r) => (r.approverMembershipId ? [r.approverMembershipId] : []));
    const lastNudge = namedWaiting.map((id) => nudged.get(id)).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
    return [
      {
        membershipId: m.id,
        person: publicPerson(p),
        timesheetId: sheet && sheet.status !== "draft" ? sheet.id : null,
        status,
        badge: statusBadge(status, { pastDue, waitingOn: waitingNames }),
        days: weekdays.map((d) => es.filter((e) => e.workDate === d).reduce((a, e) => a + Number(e.hours), 0)),
        total,
        billablePct: billablePct(billable, total),
        flag: flags[0] ?? null,
        canApprove: status === "waiting_on_you",
        approveFor: access.ownerAdmin && status === "waiting_on_others" && waiting.length ? waitingNames : null,
        remind: isMissing(status) && weekStart <= currentWeek
          ? { allowed: canRemind(access, m.teamId), sentAt: reminded.get(m.id)?.toISOString() ?? null }
          : null,
        nudge:
          status === "waiting_on_others" && canNudge(access) && namedWaiting.length && !namedWaiting.includes(actor.membershipId)
            ? { label: waitingNames, membershipIds: namedWaiting, sentAt: lastNudge && !canSendAgain(lastNudge, now) ? lastNudge.toISOString() : null }
            : null,
      },
    ];
  });
  const visible = scope === "waiting" ? rows.filter((r) => r.status === "waiting_on_you") : rows;

  // Cards: teams in order, then "No team".
  const teamRows = await db
    .select({ id: teams.id, name: teams.name, leaderId: teams.leaderMembershipId })
    .from(teams)
    .where(isNull(teams.archivedAt))
    .orderBy(asc(teams.sortOrder), asc(teams.name));
  const leaders = await peopleFor(db, teamRows.flatMap((t) => (t.leaderId ? [t.leaderId] : [])));
  const lastName = (r: OverviewRow) => r.person.name.split(" ").slice(-1)[0] ?? "";
  const byName = (a: OverviewRow, b: OverviewRow) => lastName(a).localeCompare(lastName(b)) || a.person.name.localeCompare(b.person.name);
  const card = (teamId: string | null, name: string, leaderId: string | null): OverviewCard | null => {
    const here = visible.filter((r) => (teamOf.get(r.membershipId) ?? null) === teamId).sort(byName);
    if (!here.length) return null;
    const l = leaderId ? leaders.get(leaderId) : undefined;
    const missing = here.filter((r) => isMissing(r.status));
    return {
      teamId,
      name,
      leader: l ? { name: l.name, initials: l.initials, avatarUrl: l.avatarUrl } : null,
      summary: cardSummary(here.map((r) => r.status)),
      rows: here,
      missing: missing.length,
      remindable: missing.filter((r) => r.remind?.allowed && !r.remind.sentAt).length,
    };
  };
  const cards = [
    ...teamRows.map((t) => card(t.id, t.name, t.leaderId)),
    card(null, "No team", null),
  ].filter((c): c is OverviewCard => !!c);

  const dueLine = dayTimeLabel(due, actor.timezone);
  return {
    weekStart,
    meta: `Week of ${weekRange(weekStart)} · Due ${dueLine}`,
    defaultWeek,
    prevWeek: addDays(weekStart, -7),
    nextWeek: weekStart < currentWeek ? addDays(weekStart, 7) : null,
    cards,
    notSubmitted: visible.filter((r) => isMissing(r.status)).length,
  };
}

/** KPI "Not submitted": missing people in my overview of the last due week. */
export async function notSubmittedKpi(db: TenantDb, actor: ApprovalActor, access: ApprovalAccess, now: Date = new Date()) {
  const week = lastDueWeek(now, rulesOf(actor));
  const o = await loadWeekOverview(db, actor, access, week, now);
  return { count: o.notSubmitted, weekStart: week };
}

