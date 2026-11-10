// Timesheet flags and the queue's day bars (timesheet-approval spec, rule 6
// and Layout 3). Pure functions.

import { formatHours } from "@/lib/format";
import { shortDay } from "./timesheet";

export type FlagKind = "no_rate" | "over" | "under";
export type Flag = { kind: FlagKind; label: string; tone: "red" | "orange" };

/** How far over capacity a week can go before it's flagged (spec open question 8). */
export const OVER_MARGIN_HOURS = 4;

export const RATE_MISSING_ASK = "Rate missing — ask an admin";

/**
 * Every flag on a sheet, most serious first; the queue shows the first one,
 * the detail page all of them. No flags = clean ("—").
 * `missingRateDates` are work dates with no rate; only owner/admin see them.
 */
export function timesheetFlags(input: {
  total: number;
  capacity: number;
  missingRateDates: readonly string[];
  showRateDates: boolean;
}): Flag[] {
  const flags: Flag[] = [];
  if (input.missingRateDates.length) {
    const days = [...new Set(input.missingRateDates)].sort().map(shortDay).join(", ");
    flags.push({ kind: "no_rate", tone: "red", label: input.showRateDates ? `No rate for ${days}` : RATE_MISSING_ASK });
  }
  const over = input.capacity + OVER_MARGIN_HOURS;
  if (input.total > over) flags.push({ kind: "over", tone: "orange", label: `Over ${formatHours(over)} h` });
  else if (input.total < input.capacity)
    flags.push({ kind: "under", tone: "orange", label: `${formatHours(input.capacity - input.total)} h under target` });
  return flags;
}

/** One day bar: height in px and colour band (Layout 3). */
export function dayBar(hours: number): { height: number; tone: "empty" | "over" | "normal" } {
  return {
    height: Math.max(2, Math.round((hours / 10) * 26)),
    tone: hours <= 0 ? "empty" : hours > 9 ? "over" : "normal",
  };
}

/** "Mon to Fri: 8, 8, 8, 8, 8 hours" */
export function barsLabel(hours: readonly number[]): string {
  return `Mon to Fri: ${hours.map(formatHours).join(", ")} hours`;
}

/** Billable share as a whole percent (Data shown). */
export function billablePct(billable: number, total: number): number {
  return total > 0 ? Math.round((billable / total) * 100) : 0;
}
