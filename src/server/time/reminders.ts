import { and, eq, inArray, isNull, sql, sum } from "drizzle-orm";
import { z } from "zod";
import { activityLog, firmSettings, firms, memberships, timeEntries, timesheets } from "@/db/schema";
import { type TenantDb, activeFirmIds, withFirm } from "@/db/tenant";
import { type DueRules, canSendAgain, dueAt, lastDueWeek } from "@/lib/calc/reminders";
import { isIsoDate, weekStartOf } from "@/lib/calc/timesheet";
import { todayIn } from "@/lib/format";
import { NOTICES } from "@/lib/time/notices";
import { FORBIDDEN_MESSAGE } from "@/server/settings/common";
import { notify } from "@/server/notifications/notify";
import { type ApprovalActor, approvalAccess } from "./approval";
import { waitingCounts } from "./approval-read";
import { canNudge, canRemind, loadWeekOverview, peopleInWeek, recentNudges, recentReminders, rulesOf } from "./week-overview";

// Reminders and nudges (timesheet-approval spec, Actions and rules 8–10).
// Manual: Send reminder, Remind all not submitted, Nudge. Automatic: the
// hourly cron, once per person per week after the due time.

export const REMINDER_MESSAGES = {
  notMissing: "That timesheet is already in.",
  tooSoon: "Already reminded in the last 12 hours.",
  futureWeek: "That week hasn't started yet.",
  nothingWaiting: "Nothing is waiting on them.",
  notFound: "That person wasn't found.",
} as const;

export type ReminderResult = { ok: true; message: string; sent: number } | { ok: false; error: string };

const forbidden = { ok: false, error: FORBIDDEN_MESSAGE } as const;

/** Hours someone has logged on a week (for the reminder's body). */
async function hoursOn(db: TenantDb, membershipId: string, weekStart: string): Promise<number> {
  const [r] = await db
    .select({ h: sum(timeEntries.hours) })
    .from(timeEntries)
    .innerJoin(timesheets, eq(timesheets.id, timeEntries.timesheetId))
    .where(and(eq(timesheets.membershipId, membershipId), eq(timesheets.weekStart, weekStart), isNull(timeEntries.archivedAt)));
  return Number(r?.h ?? 0);
}

/** Does this person still owe the week (no sheet, draft or returned)? */
async function stillMissing(db: TenantDb, membershipId: string, weekStart: string): Promise<boolean> {
  const [s] = await db
    .select({ status: timesheets.status })
    .from(timesheets)
    .where(and(eq(timesheets.membershipId, membershipId), eq(timesheets.weekStart, weekStart)));
  return !s || s.status === "draft" || s.status === "rejected";
}

/** One reminder: notification + activity_log (rule 9). */
async function remind(
  db: TenantDb,
  firmId: string,
  actorUserId: string | null,
  membershipId: string,
  weekStart: string,
  rules: DueRules,
  now: Date,
  automatic: boolean,
) {
  const n = NOTICES.reminder(weekStart, now > dueAt(weekStart, rules), await hoursOn(db, membershipId, weekStart));
  await notify(db, {
    firmId,
    recipients: [membershipId],
    kind: "timesheet_reminder",
    ...n,
    link: `/app/time/week/${weekStart}`,
    entity: { type: "membership", id: membershipId },
  });
  await db.insert(activityLog).values({
    firmId,
    actorUserId,
    entityType: "membership",
    entityId: membershipId,
    action: "reminder_sent",
    changes: { week_start: weekStart, automatic },
  });
}

const sendInput = z.object({ membershipId: z.uuid(), weekStart: z.string().refine(isIsoDate) });

/** Send reminder (one person). */
export async function sendReminderCore(actor: ApprovalActor, raw: unknown, now: Date = new Date()): Promise<ReminderResult> {
  if (!actor.member.active) return forbidden;
  const parsed = sendInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: REMINDER_MESSAGES.notFound };
  const { membershipId, weekStart } = parsed.data;
  if (weekStart > weekStartOf(todayIn(actor.timezone, now), actor.weekStartsOn)) return { ok: false, error: REMINDER_MESSAGES.futureWeek };
  return withFirm(actor.firmId, async (db) => {
    const access = await approvalAccess(db, actor);
    const [p] = await db
      .select({ teamId: memberships.teamId })
      .from(memberships)
      .where(and(eq(memberships.id, membershipId), eq(memberships.active, true), isNull(memberships.archivedAt)));
    if (!p) return { ok: false as const, error: REMINDER_MESSAGES.notFound };
    if (!access.canOpen || membershipId === actor.membershipId || !canRemind(access, p.teamId)) return forbidden;
    if (!(await stillMissing(db, membershipId, weekStart))) return { ok: false as const, error: REMINDER_MESSAGES.notMissing };
    if (!canSendAgain((await recentReminders(db, weekStart, now)).get(membershipId) ?? null, now))
      return { ok: false as const, error: REMINDER_MESSAGES.tooSoon };
    await remind(db, actor.firmId, actor.userId, membershipId, weekStart, rulesOf(actor), now, false);
    return { ok: true as const, message: "Reminder sent.", sent: 1 };
  });
}

const allInput = z.object({ weekStart: z.string().refine(isIsoDate), teamId: z.uuid().nullable() });

/** Remind all not submitted (one card). Skips anyone reminded in the last 12 h. */
export async function remindAllCore(actor: ApprovalActor, raw: unknown, now: Date = new Date()): Promise<ReminderResult> {
  if (!actor.member.active) return forbidden;
  const parsed = allInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: REMINDER_MESSAGES.notFound };
  const { weekStart, teamId } = parsed.data;
  if (weekStart > weekStartOf(todayIn(actor.timezone, now), actor.weekStartsOn)) return { ok: false, error: REMINDER_MESSAGES.futureWeek };
  return withFirm(actor.firmId, async (db) => {
    const access = await approvalAccess(db, actor);
    if (!access.canOpen) return forbidden;
    const overview = await loadWeekOverview(db, actor, access, weekStart, now);
    const card = overview.cards.find((c) => c.teamId === teamId);
    const targets = (card?.rows ?? []).filter((r) => r.remind?.allowed && !r.remind.sentAt);
    for (const r of targets) await remind(db, actor.firmId, actor.userId, r.membershipId, weekStart, rulesOf(actor), now, false);
    return { ok: true as const, message: `Reminded ${targets.length}.`, sent: targets.length };
  });
}

const nudgeInput = z.object({ membershipIds: z.array(z.uuid()).min(1).max(10) });

/** Nudge: each approver gets one notification with their waiting count. */
export async function nudgeCore(actor: ApprovalActor, raw: unknown, now: Date = new Date()): Promise<ReminderResult> {
  if (!actor.member.active) return forbidden;
  const parsed = nudgeInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: REMINDER_MESSAGES.notFound };
  return withFirm(actor.firmId, async (db) => {
    const access = await approvalAccess(db, actor);
    if (!canNudge(access)) return forbidden;
    const counts = await waitingCounts(db);
    const recent = await recentNudges(db, now);
    let sent = 0;
    for (const id of [...new Set(parsed.data.membershipIds)]) {
      const n = counts.get(id) ?? 0;
      if (!n || id === actor.membershipId || !canSendAgain(recent.get(id) ?? null, now)) continue;
      await notify(db, {
        firmId: actor.firmId,
        recipients: [id],
        kind: "approver_nudge",
        ...NOTICES.waitingCount(n),
        link: "/app/time/approvals",
        entity: { type: "membership", id },
      });
      await db.insert(activityLog).values({
        firmId: actor.firmId,
        actorUserId: actor.userId,
        entityType: "membership",
        entityId: id,
        action: "nudged",
        changes: { waiting: n },
      });
      sent += 1;
    }
    if (!sent) return { ok: false as const, error: REMINDER_MESSAGES.tooSoon };
    return { ok: true as const, message: sent === 1 ? "Nudge sent." : `Nudged ${sent}.`, sent };
  });
}

// ---------- Automatic reminders (rule 10) ----------

export type CronReport = { firms: number; reminders: number; summaries: number };

/**
 * For each firm: once its last week's due time has passed, remind every
 * missing person once (automatic) and tell each reviewer with waiting sheets
 * once. Safe to run again: everything sent is logged and checked first.
 */
export async function runTimesheetReminders(now: Date = new Date()): Promise<CronReport> {
  const report: CronReport = { firms: 0, reminders: 0, summaries: 0 };
  for (const id of await activeFirmIds()) {
    try {
      const r = await runRemindersForFirm(id, now);
      report.firms += 1;
      report.reminders += r.reminders;
      report.summaries += r.summaries;
    } catch (err) {
      console.error("timesheet reminders failed for firm", id, err);
    }
  }
  return report;
}

/** One firm's automatic reminders (the cron runs this for each firm; tests call it directly). */
export function runRemindersForFirm(firmId: string, now: Date = new Date()) {
  return withFirm(firmId, (db) => remindFirm(db, firmId, now));
}

/** Only weeks that came due in the last 7 days are acted on. */
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

async function remindFirm(db: TenantDb, firmId: string, now: Date) {
  const [f] = await db
    .select({
      timezone: firms.timezone,
      weekStartsOn: firmSettings.weekStartsOn,
      lockDay: firmSettings.timesheetLockDay,
      dueTime: firmSettings.timesheetDueTime,
    })
    .from(firms)
    .innerJoin(firmSettings, eq(firmSettings.firmId, firms.id))
    .where(eq(firms.id, firmId));
  if (!f) return { reminders: 0, summaries: 0 };
  const rules: DueRules = f;
  const week = lastDueWeek(now, rules);
  if (now.getTime() - dueAt(week, rules).getTime() > WINDOW_MS) return { reminders: 0, summaries: 0 };

  // Missing people, each reminded once for this week.
  const people = await peopleInWeek(db, week, rules.timezone);
  const done = await db
    .select({ id: activityLog.entityId, action: activityLog.action })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.entityType, "membership"),
        inArray(activityLog.action, ["reminder_sent", "review_summary_sent"]),
        sql`${activityLog.changes}->>'week_start' = ${week}`,
        sql`coalesce((${activityLog.changes}->>'automatic')::boolean, false) = true`,
      ),
    );
  const reminded = new Set(done.filter((d) => d.action === "reminder_sent").map((d) => d.id));
  const summarised = new Set(done.filter((d) => d.action === "review_summary_sent").map((d) => d.id));
  let reminders = 0;
  for (const p of people) {
    if (reminded.has(p.id) || !(await stillMissing(db, p.id, week))) continue;
    await remind(db, firmId, null, p.id, week, rules, now, true);
    reminders += 1;
  }

  // Reviewers with waiting sheets, once per week.
  let summaries = 0;
  for (const [id, n] of await waitingCounts(db)) {
    if (summarised.has(id)) continue;
    await notify(db, {
      firmId,
      recipients: [id],
      kind: "review_summary",
      ...NOTICES.waitingCount(n),
      link: "/app/time/approvals",
      entity: { type: "membership", id },
    });
    await db.insert(activityLog).values({
      firmId,
      actorUserId: null,
      entityType: "membership",
      entityId: id,
      action: "review_summary_sent",
      changes: { week_start: week, automatic: true, waiting: n },
    });
    summaries += 1;
  }
  return { reminders, summaries };
}
