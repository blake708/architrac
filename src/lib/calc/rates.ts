// Rates, multipliers and overhead (settings-rates-phases spec, business rules
// 2–10). Pure functions: money in integer cents, percentages in basis points.
// Multipliers are returned in hundredths (195 = 1.95×) so rounding is exact.

/** Multipliers under this are flagged (rule 2). A constant for now. */
export const MULTIPLIER_FLAG = 2.5;

/** The facts about one role that the KPIs need. */
export type RoleRateFacts = {
  billCents: number;
  costCents: number;
  /** Active people with this role. */
  people: number;
};

/** a / b in hundredths, rounded half up, using whole numbers only. */
function ratioHundredths(a: number, b: number): number {
  return Math.floor((a * 200 + b) / (2 * b));
}

/** Bill ÷ cost in hundredths (11500 / 4400 → 261). Null if either is 0. */
export function multiplierHundredths(
  billCents: number,
  costCents: number,
): number | null {
  if (billCents <= 0 || costCents <= 0) return null;
  return ratioHundredths(billCents, costCents);
}

export type MultiplierStatus = "flagged" | "ok" | "none";

/** Flagged when 0 < bill ÷ cost < 2.5, compared exactly (not rounded). */
export function multiplierStatus(
  billCents: number,
  costCents: number,
): MultiplierStatus {
  if (billCents <= 0 || costCents <= 0) return "none";
  // bill / cost < 2.5  ⇔  bill × 10 < cost × 25
  return billCents * 10 < costCents * (MULTIPLIER_FLAG * 10)
    ? "flagged"
    : "ok";
}

/** Roles that count toward the blended rate and average multiplier (rule 3). */
function staffedBillable(roles: readonly RoleRateFacts[]) {
  return roles.filter((r) => r.billCents > 0 && r.costCents > 0 && r.people > 0);
}

/** Σ(bill × people) / Σ people, in cents (rule 3). Null if nobody counts. */
export function blendedBillRateCents(
  roles: readonly RoleRateFacts[],
): number | null {
  const rs = staffedBillable(roles);
  const people = rs.reduce((n, r) => n + r.people, 0);
  if (people === 0) return null;
  const total = rs.reduce((n, r) => n + r.billCents * r.people, 0);
  return Math.round(total / people);
}

/** Σ(multiplier × people) / Σ people, in hundredths (rule 4). */
export function avgMultiplierHundredths(
  roles: readonly RoleRateFacts[],
): number | null {
  const rs = staffedBillable(roles);
  const people = rs.reduce((n, r) => n + r.people, 0);
  if (people === 0) return null;
  const sum = rs.reduce((n, r) => n + (r.billCents / r.costCents) * r.people, 0);
  return Math.round((sum / people) * 100);
}

/** How many roles (not people) are flagged (rule 5). */
export function rolesFlagged(
  roles: readonly Pick<RoleRateFacts, "billCents" | "costCents">[],
): number {
  return roles.filter(
    (r) => multiplierStatus(r.billCents, r.costCents) === "flagged",
  ).length;
}

/** 1 + overhead, in hundredths: 6000 bp → 160 (= 1.60×) (rule 6). */
export function breakevenHundredths(overheadBp: number): number {
  return Math.round((10000 + overheadBp) / 100);
}

/**
 * The true cost of an hour (rule 7): labor plus its share of overhead.
 * 4400 at 6000 bp → { trueCostCents: 7040, overheadCents: 2640 }.
 */
export function trueHourCost(costCents: number, overheadBp: number) {
  const trueCostCents = Math.round((costCents * (10000 + overheadBp)) / 10000);
  return { trueCostCents, overheadCents: trueCostCents - costCents };
}

/**
 * Overhead rate from last year's numbers (rule 9), as a whole percent.
 * $612,000 ÷ $1,020,000 → 60. Null unless both are above 0.
 */
export function overheadPctFromActuals(
  expensesCents: number,
  laborCents: number,
): number | null {
  if (!(expensesCents > 0) || !(laborCents > 0)) return null;
  return Math.round((expensesCents * 100) / laborCents);
}

/** The note under the phase total (rule 10). */
export function phaseTotalNote(totalPct: number): string {
  if (totalPct === 100) return "Adds up to the full fee";
  if (totalPct < 100) return `${100 - totalPct}% of the fee is unassigned`;
  return `${totalPct - 100}% over the full fee`;
}

// ── Effective-dated rates (rule 8, DATA_MODEL rate lookup rule) ─────────────

/** A rate period. Dates are "YYYY-MM-DD"; effectiveTo null = still current. */
export type RatePeriod = {
  effectiveFrom: string;
  effectiveTo: string | null;
};

/** The day before a "YYYY-MM-DD" date. */
export function dayBefore(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** The period that covers `date`, if any. ISO dates compare as strings. */
export function rateOn<T extends RatePeriod>(
  periods: readonly T[],
  date: string,
): T | null {
  return (
    periods.find(
      (p) =>
        p.effectiveFrom <= date &&
        (p.effectiveTo === null || p.effectiveTo >= date),
    ) ?? null
  );
}

/**
 * The rate for a person's time on `date`: their own override if one covers
 * the date, else their role's rate, else null (approval is blocked).
 */
export function lookupRate<T extends RatePeriod>(
  personRates: readonly T[],
  roleRates: readonly T[],
  date: string,
): T | null {
  return rateOn(personRates, date) ?? rateOn(roleRates, date);
}

/**
 * What to do when a role's rate changes from `newFrom` (rule 8), given its
 * current period:
 * - same start date → update that row in place
 * - later start → end the current row the day before, insert a new row
 * - earlier start → not allowed
 */
export type RateChangePlan =
  | { kind: "update" }
  | { kind: "split"; closeCurrentOn: string }
  | { kind: "reject"; earliest: string };

export function planRateChange(
  current: RatePeriod,
  newFrom: string,
): RateChangePlan {
  if (newFrom === current.effectiveFrom) return { kind: "update" };
  if (newFrom > current.effectiveFrom) {
    return { kind: "split", closeCurrentOn: dayBefore(newFrom) };
  }
  return { kind: "reject", earliest: current.effectiveFrom };
}
