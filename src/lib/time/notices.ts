// What each notification says (timesheet-approval spec, rules 3–5, 9–13).
// Pure, so the server and the tests agree on the words.

import { addDays } from "@/lib/calc/timesheet";
import { formatHours } from "@/lib/format";

const fmt = (opts: Intl.DateTimeFormatOptions, iso: string) =>
  new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

/** "Oct 12 – 18", or "Oct 26 – Nov 1" across months. */
export function weekSpan(weekStart: string): string {
  const end = addDays(weekStart, 6);
  const sameMonth = weekStart.slice(5, 7) === end.slice(5, 7);
  return `${fmt({ month: "short", day: "numeric" }, weekStart)} – ${fmt(sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" }, end)}`;
}

/** "Oct 12" */
const weekOf = (weekStart: string) => fmt({ month: "short", day: "numeric" }, weekStart);

export type Notice = { title: string; body?: string };

export const NOTICES = {
  /** A step became current: to each approver on it (rule 13). */
  reviewWaiting: (who: string, weekStart: string, hours: number): Notice => ({
    title: `${who}'s timesheet is waiting for you`,
    body: `Week of ${weekSpan(weekStart)} · ${formatHours(hours)} h`,
  }),
  /** The last step approved: to the person. */
  approved: (weekStart: string): Notice => ({ title: `Your timesheet for ${weekSpan(weekStart)} was approved` }),
  /** Owner/admin stood in (rule 3f): to each person stood in for. */
  approvedForYou: (by: string, who: string, weekStart: string): Notice => ({
    title: `${by} approved ${who}'s timesheet for you (week of ${weekOf(weekStart)}).`,
  }),
  /** Return / Reopen (rules 4, 5): to the person, with the note. */
  returned: (weekStart: string, note: string, reopened = false): Notice => ({
    title: `Your timesheet for ${weekSpan(weekStart)} was ${reopened ? "reopened and returned" : "returned"}`,
    body: note,
  }),
  /** Reminder (rule 9). */
  reminder: (weekStart: string, overdue: boolean, hours: number): Notice => ({
    title: `Your timesheet for ${weekSpan(weekStart)} is ${overdue ? "overdue" : "due"}`,
    body: hours > 0 ? `You've logged ${formatHours(hours)} h so far.` : "You haven't logged any hours yet.",
  }),
  /** Nudge and the cron's summary (rule 10). */
  waitingCount: (count: number): Notice => ({
    title: `You have ${count} timesheet${count === 1 ? "" : "s"} waiting for approval`,
  }),
} as const;

/** "2 h ago", "Just now", "3 d ago", "Oct 12". */
export function relativeTime(at: Date | string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(at).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} d ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(at));
}

/** Bell badge: hidden at 0, "9+" above 9. */
export function unreadBadge(count: number): string | null {
  return count <= 0 ? null : count > 9 ? "9+" : String(count);
}
