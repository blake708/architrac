// Utilization over the last 4 completed weeks (team spec, business rules
// 4–5). Pure functions; dates are "YYYY-MM-DD" strings.

export const UTILIZATION_WEEKS = 4;

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The 4 most recent completed weeks before the week containing `today`.
 * `weekStartsOn`: 0 = Sunday, 1 = Monday (firm_settings.week_starts_on).
 * Sunday 2026-10-18, weeks start Monday → 2026-09-14 to 2026-10-11.
 */
export function utilizationWindow(
  today: string,
  weekStartsOn: number,
): { from: string; to: string } {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const sinceStart = (dow - weekStartsOn + 7) % 7;
  const thisWeekStart = addDays(today, -sinceStart);
  return {
    from: addDays(thisWeekStart, -7 * UTILIZATION_WEEKS),
    to: addDays(thisWeekStart, -1),
  };
}

/**
 * Billable hours ÷ (weekly capacity × 4), as a whole percent rounded half up.
 * 141 h at 40 h/week → 88. Null when capacity is 0 (nothing to compare to).
 */
export function utilizationPct(
  billableHours: number,
  weeklyCapacityHours: number,
): number | null {
  if (!(weeklyCapacityHours > 0)) return null;
  // Work in hundredths of an hour so .5 rounds up exactly.
  const hours = Math.round(billableHours * 100);
  const capacity = Math.round(weeklyCapacityHours * UTILIZATION_WEEKS * 100);
  return Math.floor((hours * 200 + capacity) / (2 * capacity));
}

export type UtilizationView =
  | { kind: "none" } // no target or no capacity: "—", no bar
  | {
      kind: "shown";
      pct: number;
      targetPct: number;
      /** Bar fill, 0–100. */
      fill: number;
      below: boolean;
    };

/** What the Utilization · 4 wks cell shows (rule 5). */
export function utilizationView(
  billableHours: number,
  weeklyCapacityHours: number,
  targetBp: number | null,
): UtilizationView {
  const pct = utilizationPct(billableHours, weeklyCapacityHours);
  if (pct === null || !targetBp) return { kind: "none" };
  const targetPct = targetBp / 100;
  return {
    kind: "shown",
    pct,
    targetPct,
    fill: Math.min(pct, 100),
    below: pct < targetPct,
  };
}
