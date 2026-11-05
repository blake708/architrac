import { z } from "zod";
import { addDays, dayOfWeek, dueDate } from "@/lib/calc/timesheet";
import { dayHeader, weekRange } from "@/lib/time/display";

// Settings → Time & approvals → "Timesheets" card: when timesheets are due
// (decision #21) and whether billable time needs notes (decision #17).
// Week start, increment and reminders in the mockup's card come later.

export type TimesheetRules = {
  /** 0 = Sunday … 6 = Saturday */
  lockDay: number;
  /** "09:00" */
  dueTime: string;
  billableNotesRequired: boolean;
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const timesheetRulesSchema = z.object({
  lockDay: z.number().int().min(0).max(6),
  dueTime: z.string().regex(/^([01]\d|2[0-3]):(00|30)$/),
  billableNotesRequired: z.boolean(),
});

/** "09:00:00" (as the database returns it) → "09:00". */
export const shortTime = (t: string) => t.slice(0, 5);

/** "17:30" → "5:30 PM" */
export function timeLabel(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** Every half hour of the day, for the due-time picker. */
export const DUE_TIMES = Array.from({ length: 48 }, (_, i) => {
  const value = `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`;
  return { value, label: timeLabel(value) };
});

/**
 * The due-day choices, from the week's fifth day on (the earliest a week can
 * be due): "Friday", "Saturday", "Sunday (following week)"… Uses the rule in
 * dueDate, so the label always matches what the timesheet shows.
 */
export function dueDayOptions(weekStartsOn: number): { value: number; label: string }[] {
  // Any week works: find one that starts on the firm's day.
  let ws = "2026-01-04"; // a Sunday
  while (dayOfWeek(ws) !== weekStartsOn) ws = addDays(ws, 1);
  return Array.from({ length: 7 }, (_, i) => {
    const day = (weekStartsOn + 4 + i) % 7;
    const following = dueDate(ws, day) > addDays(ws, 6);
    return { value: day, label: `${DAY_NAMES[day]}${following ? " (following week)" : ""}` };
  });
}

/** "The week of Oct 12 – Oct 18, 2026 is due Mon Oct 19 at 9:00 AM." */
export function dueExample(weekStart: string, rules: Pick<TimesheetRules, "lockDay" | "dueTime">): string {
  const d = dayHeader(dueDate(weekStart, rules.lockDay));
  return `The week of ${weekRange(weekStart)} is due ${d.dow} ${d.date} at ${timeLabel(rules.dueTime)}.`;
}
