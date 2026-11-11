// Week overview and reminders (timesheet-approval spec, rules 7–10). Pure.

import { addDays, dueDate, weekStartOf, zonedInstant } from "./timesheet";
import { todayIn } from "@/lib/format";

export type DueRules = { timezone: string; weekStartsOn: number; lockDay: number; dueTime: string };

/** When a week's timesheet is due, as an instant. */
export function dueAt(weekStart: string, r: DueRules): Date {
  return zonedInstant(dueDate(weekStart, r.lockDay), r.dueTime, r.timezone);
}

/** The most recent week whose due time has passed (week overview default, cron). */
export function lastDueWeek(now: Date, r: DueRules): string {
  let w = weekStartOf(todayIn(r.timezone, now), r.weekStartsOn);
  while (dueAt(w, r) > now) w = addDays(w, -7);
  return w;
}

/** Manual reminders and nudges: at most one per person per 12 hours. */
export const REMIND_GAP_MS = 12 * 60 * 60 * 1000;
export function canSendAgain(lastAt: Date | null, now: Date): boolean {
  return !lastAt || now.getTime() - lastAt.getTime() >= REMIND_GAP_MS;
}

export type OverviewStatus = "not_submitted" | "draft" | "returned" | "waiting_on_you" | "waiting_on_others" | "approved";

/** Not submitted, Draft or Returned: the person still owes this week (rule 8). */
export const isMissing = (s: OverviewStatus) => s === "not_submitted" || s === "draft" || s === "returned";

export type StatusBadge = { label: string; tone: "neutral" | "orange" | "blue" | "green"; look: "hollow" | "diamond" | "dot" };

/** Rule 7. `waitingOn` is the names the sheet waits on ("Jo Reyes", "a principal"). */
export function statusBadge(status: OverviewStatus, opts: { pastDue: boolean; waitingOn?: string | null }): StatusBadge {
  switch (status) {
    case "not_submitted":
      return opts.pastDue
        ? { label: "Not submitted", tone: "orange", look: "diamond" }
        : { label: "Not submitted", tone: "neutral", look: "hollow" };
    case "draft":
      return opts.pastDue ? { label: "Draft", tone: "orange", look: "diamond" } : { label: "Draft", tone: "neutral", look: "hollow" };
    case "returned":
      return { label: "Returned", tone: "orange", look: "dot" };
    case "waiting_on_you":
      return { label: "Waiting on you", tone: "orange", look: "diamond" };
    case "waiting_on_others":
      return { label: `Waiting on ${opts.waitingOn ?? "a principal"}`, tone: "blue", look: "dot" };
    case "approved":
      return { label: "Approved", tone: "green", look: "dot" };
  }
}

/** Card summary: "2 waiting on you · 1 with others · 1 not submitted" (zero parts left out). */
export function cardSummary(statuses: readonly OverviewStatus[]): string {
  const n = (f: (s: OverviewStatus) => boolean) => statuses.filter(f).length;
  const parts = [
    [n((s) => s === "waiting_on_you"), "waiting on you"],
    [n((s) => s === "waiting_on_others"), "with others"],
    [n(isMissing), "not submitted"],
    [n((s) => s === "approved"), "approved"],
  ] as const;
  return parts.filter(([c]) => c > 0).map(([c, l]) => `${c} ${l}`).join(" · ") || "Nobody yet";
}
