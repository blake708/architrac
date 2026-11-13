// A person's hourly cost from their pay, and which bill and cost rate apply
// to their time (ADR 0008). Pure functions: money in integer cents,
// percentages in basis points.

import { type RatePeriod, lookupRate, rateOn } from "./rates";

export type PayType = "salary" | "hourly";

export type Pay = {
  payType: PayType;
  /** Annual salary (salary) or hourly wage (hourly). */
  amountCents: number;
  /** Taxes and benefits on top of pay, 2500 = 25%. */
  burdenBp: number;
};

export type PayPeriod = Pay & RatePeriod;

/** Weeks in a working year: salary ÷ (weekly hours × 52). */
export const WEEKS_PER_YEAR = 52;

/**
 * What an hour of this person costs, rounded half up to the cent.
 * Salary: salary ÷ (weekly hours × 52) × (1 + burden).
 * Hourly: wage × (1 + burden).
 * $70,200 at 40 h and 25% → 3375 × 1.25 = 4219 (from 4218.75).
 * Null for a salary with no weekly hours (nothing to divide by).
 */
export function hourlyCostCents(pay: Pay, weeklyHours: number): number | null {
  const burden = 10000 + pay.burdenBp;
  if (pay.payType === "hourly") return roundDiv(pay.amountCents * burden, 10000);
  // Weekly hours come in quarter steps, so count quarter hours to stay whole.
  const quarters = Math.round(weeklyHours * 4);
  if (quarters <= 0) return null;
  return roundDiv(pay.amountCents * burden * 4, quarters * WEEKS_PER_YEAR * 10000);
}

/** a ÷ b, rounded half up, for a ≥ 0 and b > 0. */
function roundDiv(a: number, b: number): number {
  return Math.floor((2 * a + b) / (2 * b));
}

export type RateRow = RatePeriod & { billRateCents: number; costRateCents: number };

/** Everything that decides one person's rates, on one project or none. */
export type RateSources = {
  /** Their own override rows (rates.membership_id). */
  personRates: readonly RateRow[];
  /** Their own role's rows. */
  roleRates: readonly RateRow[];
  /** Their pay history. */
  pay: readonly PayPeriod[];
  weeklyHours: number;
  /** Rows of their role on this project, when it's set there. */
  projectRoleRates?: readonly RateRow[] | null;
  /** Their bill rate on this project, over any role rate. */
  projectBillOverrideCents?: number | null;
};

/**
 * The bill and cost rate for an hour worked on `date`, or null if either is
 * missing (approval is blocked).
 * Bill: the project's rate for them → their role on the project → their own
 *   override → their own role.
 * Cost: their pay → their own override → their own role. Never the project
 *   role: a PM helping as a Designer still costs what the PM is paid.
 */
export function resolveRate(
  s: RateSources,
  date: string,
): { billRateCents: number; costRateCents: number } | null {
  const own = lookupRate(s.personRates, s.roleRates, date);
  const bill =
    s.projectBillOverrideCents ??
    (s.projectRoleRates ? rateOn(s.projectRoleRates, date)?.billRateCents : undefined) ??
    own?.billRateCents;
  const pay = rateOn(s.pay, date);
  const cost = (pay ? hourlyCostCents(pay, s.weeklyHours) : null) ?? own?.costRateCents;
  if (bill === undefined || cost === undefined) return null;
  return { billRateCents: bill, costRateCents: cost };
}
