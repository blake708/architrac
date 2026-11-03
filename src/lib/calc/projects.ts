// Project list math (projects-list spec, business rules 1–8). Pure functions
// over cents and quarter-hours. Money rounds half away from zero at the last
// step (ADR 0004).

import type { InvoiceStatus } from "./contacts";

export type ProjectStatus = "pursuit" | "active" | "on_hold" | "closed";
export type PhaseStatus = "upcoming" | "current" | "complete" | "closed";
export type FeeType = "fixed" | "hourly" | "nte";

export type PhaseFacts = {
  id: string;
  name: string;
  sortOrder: number;
  status: PhaseStatus;
  feeType: FeeType;
  feeCents: number;
  budgetHours: number;
};

// ---------------------------------------------------------------------------
// Rule 1: fee

/** The project fee is always the sum of its (non-archived) phases. */
export function projectFee(phases: readonly Pick<PhaseFacts, "feeCents">[]): number {
  return phases.reduce((n, p) => n + p.feeCents, 0);
}

// ---------------------------------------------------------------------------
// Rule 2: billed

export type BilledLine = {
  invoiceStatus: InvoiceStatus;
  projectPhaseId: string | null;
  lineType: "phase_fee" | "hourly" | "consultant" | "expense" | "adjustment";
  amountCents: number;
};

const COUNTS: ReadonlySet<InvoiceStatus> = new Set([
  "sent",
  "partially_paid",
  "paid",
  "written_off",
]);

/**
 * Architectural fee billed so far. Only invoices that went out count. Fixed
 * phases count their phase-fee lines; hourly and NTE phases count hourly and
 * adjustment lines. Consultant and expense lines never count.
 */
export function projectBilled(
  phases: readonly Pick<PhaseFacts, "id" | "feeType">[],
  lines: readonly BilledLine[],
): number {
  const typeById = new Map(phases.map((p) => [p.id, p.feeType]));
  let total = 0;
  for (const l of lines) {
    if (!COUNTS.has(l.invoiceStatus) || !l.projectPhaseId) continue;
    const t = typeById.get(l.projectPhaseId);
    if (!t) continue;
    const counts =
      t === "fixed" ? l.lineType === "phase_fee" : l.lineType === "hourly" || l.lineType === "adjustment";
    if (counts) total += l.amountCents;
  }
  return total;
}

/** Whole percent billed, or null when there's no fee. */
export function billedPct(billedCents: number, feeCents: number): number | null {
  if (feeCents <= 0) return null;
  return roundDiv(billedCents * 100, feeCents);
}

/** a ÷ b rounded half away from zero (b > 0). */
function roundDiv(a: number, b: number): number {
  const q = Math.floor(Math.abs(a) / b);
  const r = Math.abs(a) - q * b;
  const n = r * 2 >= b ? q + 1 : q;
  return a < 0 ? -n : n;
}

// ---------------------------------------------------------------------------
// Rule 3: health

export type Health = "on_track" | "at_risk" | "over_budget" | "on_hold" | "closed" | "pursuit";

/** Orange threshold from the design system: 90% of budget. */
const AT_RISK_BP = 9000;

/**
 * Project health (Blake, 2026-11-03, open decision 9): only open phases
 * (current and upcoming) affect it. A phase that finished over budget is
 * flagged on the phase, not the project.
 *
 * - over_budget: the whole project is past its total budget hours, or an
 *   open phase is past its own budget.
 * - at_risk: an open phase with a budget has used 90% or more of it.
 */
export function projectHealth(
  status: ProjectStatus,
  phases: readonly Pick<PhaseFacts, "id" | "status" | "budgetHours">[],
  usedHoursByPhase: ReadonlyMap<string, number>,
): Health {
  if (status !== "active") return status;
  const used = (id: string) => usedHoursByPhase.get(id) ?? 0;
  const open = phases.filter((p) => p.status === "current" || p.status === "upcoming");

  const totalBudget = phases.reduce((n, p) => n + p.budgetHours, 0);
  const totalUsed = phases.reduce((n, p) => n + used(p.id), 0);
  if (totalBudget > 0 && totalUsed > totalBudget) return "over_budget";
  if (open.some((p) => used(p.id) > p.budgetHours)) return "over_budget";
  if (open.some((p) => p.budgetHours > 0 && used(p.id) * 10000 >= p.budgetHours * AT_RISK_BP))
    return "at_risk";
  return "on_track";
}

export const HEALTH_LABELS: Record<Health, string> = {
  on_track: "On track",
  at_risk: "At risk",
  over_budget: "Over budget",
  on_hold: "On hold",
  closed: "Closed",
  pursuit: "Pursuit",
};

// ---------------------------------------------------------------------------
// Rule 4: phase text

export function phaseText(
  status: ProjectStatus,
  phases: readonly Pick<PhaseFacts, "name" | "sortOrder" | "status">[],
): string {
  if (status === "closed") return "Closed out";
  if (status === "pursuit") return "Pursuit · not started";
  const sorted = [...phases].sort((a, b) => a.sortOrder - b.sortOrder);
  const current = sorted.find((p) => p.status === "current");
  const done = (p: (typeof sorted)[number]) => p.status === "complete" || p.status === "closed";
  const text = current
    ? current.name
    : sorted.length > 0 && sorted.every(done)
      ? "All phases complete"
      : "Not started";
  return status === "on_hold" ? `On hold · ${text}` : text;
}

// ---------------------------------------------------------------------------
// Rule 5: suggested number

/** "{year}-{N+1}", 3-digit padded, where N is the highest "{year}-N" in use. */
export function nextProjectNumber(existing: readonly string[], year: number): string {
  const re = new RegExp(`^${year}-(\\d+)$`);
  let max = 0;
  for (const n of existing) {
    const m = re.exec(n.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${year}-${String(max + 1).padStart(3, "0")}`;
}

// ---------------------------------------------------------------------------
// Rules 6–7: splitting a total across phases

export type SplitRow = {
  id: string;
  /** Template share in basis points; 0 is allowed. */
  weightBp: number;
  /** The row's current amount (used for edited rows). */
  amount: number;
};

export type SplitResult =
  | { ok: true; amounts: Record<string, number> }
  | { ok: false; error: "edited_over_total"; editedSum: number };

/**
 * Split `total` (whole units: cents or quarter-hours) over the rows.
 * Edited rows keep their amount; the rest share what's left by weight
 * (equally if every weight is 0). Floors first, then the leftover goes to
 * the unedited row with the largest weight (first in order on a tie), so the
 * amounts always add up to the total when anything is left to share.
 */
export function distribute(
  total: number,
  rows: readonly SplitRow[],
  edited: ReadonlySet<string>,
): SplitResult {
  const amounts: Record<string, number> = {};
  let editedSum = 0;
  for (const r of rows)
    if (edited.has(r.id)) {
      amounts[r.id] = r.amount;
      editedSum += r.amount;
    }
  const remaining = total - editedSum;
  if (remaining < 0) return { ok: false, error: "edited_over_total", editedSum };

  const free = rows.filter((r) => !edited.has(r.id));
  if (free.length === 0) return { ok: true, amounts };
  const sumW = free.reduce((n, r) => n + r.weightBp, 0);
  const weight = (r: SplitRow) => BigInt(sumW === 0 ? 1 : r.weightBp);
  const S = sumW === 0 ? BigInt(free.length) : BigInt(sumW);
  const rem = BigInt(remaining);

  let given = 0;
  let biggest = free[0];
  for (const r of free) {
    const share = Number((rem * weight(r)) / S);
    amounts[r.id] = share;
    given += share;
    if (weight(r) > weight(biggest)) biggest = r;
  }
  amounts[biggest.id] += remaining - given;
  return { ok: true, amounts };
}

/** Rule 6: split a fee in cents. */
export const distributeFee = distribute;

/** Rule 7: split hours in quarter-hour units. Hours in and out. */
export function distributeHours(
  totalHours: number,
  rows: readonly SplitRow[],
  edited: ReadonlySet<string>,
): SplitResult {
  const toUnits = (h: number) => Math.round(h * 4);
  const r = distribute(
    toUnits(totalHours),
    rows.map((x) => ({ ...x, amount: toUnits(x.amount) })),
    edited,
  );
  if (!r.ok) return { ...r, editedSum: r.editedSum / 4 };
  const amounts: Record<string, number> = {};
  for (const [k, v] of Object.entries(r.amounts)) amounts[k] = v / 4;
  return { ok: true, amounts };
}

// ---------------------------------------------------------------------------
// New project: phase fees from shares (Blake, 2026-11-03)

export type PhaseEdit = { kind: "fee"; cents: number } | { kind: "pct"; bp: number } | null;

export type PlanRow = {
  id: string;
  include: boolean;
  feeType: FeeType;
  /** Template share, used to rebalance phases nobody has edited. */
  weightBp: number;
  edit: PhaseEdit;
};

export type FeePlan = {
  fees: Record<string, number>;
  /** Each row's share of the total, in basis points (0 when there's no total). */
  shares: Record<string, number>;
  /** Σ fees of rows in the split. */
  sumCents: number;
  /** Edited rows alone are more than the total. */
  over: boolean;
};

/** Hourly phases and unchecked phases are outside the split: 0%, $0. */
export const inSplit = (r: Pick<PlanRow, "include" | "feeType">) => r.include && r.feeType !== "hourly";

/**
 * Split the total fee over the checked fixed and not-to-exceed phases.
 * A %-edited phase gets that share of the total; a fee-edited phase keeps
 * its dollars; the rest share what's left by template share (rule 6), so
 * the phases add up to 100% unless every phase was edited.
 */
export function planPhaseFees(totalCents: number, rows: readonly PlanRow[]): FeePlan {
  const fees: Record<string, number> = {};
  const shares: Record<string, number> = {};
  for (const r of rows) {
    fees[r.id] = 0;
    shares[r.id] = 0;
  }
  const split = rows.filter(inSplit);
  const amountOf = (r: PlanRow) =>
    r.edit?.kind === "fee" ? r.edit.cents : r.edit?.kind === "pct" ? roundDiv(totalCents * r.edit.bp, 10_000) : 0;
  const result = distributeFee(
    totalCents,
    split.map((r) => ({ id: r.id, weightBp: r.weightBp, amount: amountOf(r) })),
    new Set(split.filter((r) => r.edit).map((r) => r.id)),
  );
  let over = false;
  if (result.ok) Object.assign(fees, result.amounts);
  else {
    over = true;
    for (const r of split) fees[r.id] = r.edit ? amountOf(r) : 0;
  }
  let sumCents = 0;
  for (const r of split) {
    sumCents += fees[r.id];
    shares[r.id] =
      r.edit?.kind === "pct" ? r.edit.bp : totalCents > 0 ? roundDiv(fees[r.id] * 10_000, totalCents) : 0;
  }
  return { fees, shares, sumCents, over };
}

/** Budget hours from a fee at a bill rate, to the nearest quarter hour. */
export function hoursFromFee(feeCents: number, rateCents: number | null): number | null {
  if (!rateCents || rateCents <= 0) return null;
  return roundDiv(feeCents * 4, rateCents) / 4;
}
