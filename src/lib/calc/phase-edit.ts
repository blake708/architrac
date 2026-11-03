// Editing a project's phases (project-detail spec, rules 5–6) and role mixes
// (Blake, 2026-11-03). Pure functions over cents, basis points and hours.

import { type FeeType, type PhaseStatus, distribute, hoursFromFee } from "./projects";

/** a ÷ b rounded half away from zero (b > 0). */
function roundDiv(a: number, b: number): number {
  const q = Math.floor(Math.abs(a) / b);
  const r = Math.abs(a) - q * b;
  const n = r * 2 >= b ? q + 1 : q;
  return a < 0 ? -n : n;
}

// ---------------------------------------------------------------------------
// Role mixes

export type MixRow = { roleId: string; shareBp: number; rateCents: number };

/** Σ shares in basis points. Must be exactly 10000 to save. */
export const mixTotalBp = (rows: readonly Pick<MixRow, "shareBp">[]) => rows.reduce((n, r) => n + r.shareBp, 0);

/**
 * Each role's dollars and hours: share × phase fee, then ÷ the role's bill
 * rate to the quarter hour. A role with no rate gets 0 hours.
 */
export function mixHours(phaseFeeCents: number, rows: readonly MixRow[]) {
  const roles = rows.map((r) => {
    const cents = roundDiv(phaseFeeCents * r.shareBp, 10_000);
    return { roleId: r.roleId, cents, hours: hoursFromFee(cents, r.rateCents) ?? 0, noRate: r.rateCents <= 0 };
  });
  const total = roles.reduce((n, r) => n + Math.round(r.hours * 4), 0) / 4;
  return { roles, total };
}

// ---------------------------------------------------------------------------
// Rule 6: redistribute fee

export type RedistributePhase = {
  id: string;
  code: string;
  feeCents: number;
  budgetHours: number;
  billedCents: number;
  status: PhaseStatus;
  /** The template's share for this code (fallback weights). */
  templateShareBp: number;
};

/** Locked by default: anything billed, complete or closed. */
export const defaultLocks = (phases: readonly RedistributePhase[]) =>
  new Set(phases.filter((p) => p.billedCents > 0 || p.status === "complete" || p.status === "closed").map((p) => p.id));

export type RedistributeResult =
  | { ok: true; fees: Record<string, number>; hours: Record<string, number> | null }
  | { ok: false; error: "below_locked"; lockedCents: number }
  | { ok: false; error: "below_billed"; code: string; billedCents: number };

/**
 * Spread a new total fee (and optionally new total hours) over the unlocked
 * phases. Weights are their current fees; if those are all 0, the template
 * shares; if those are 0 too, equal. Locked phases keep theirs.
 */
export function redistribute(
  phases: readonly RedistributePhase[],
  newTotalCents: number,
  locked: ReadonlySet<string>,
  newTotalHours: number | null,
): RedistributeResult {
  const lockedCents = phases.filter((p) => locked.has(p.id)).reduce((n, p) => n + p.feeCents, 0);
  if (newTotalCents < lockedCents) return { ok: false, error: "below_locked", lockedCents };
  const open = phases.filter((p) => !locked.has(p.id));
  const weightsOf = (pick: (p: RedistributePhase) => number) => {
    const w = open.map(pick);
    return w.some((x) => x > 0) ? w : null;
  };
  const feeW = weightsOf((p) => p.feeCents) ?? weightsOf((p) => p.templateShareBp) ?? open.map(() => 1);
  const fees: Record<string, number> = {};
  for (const p of phases) if (locked.has(p.id)) fees[p.id] = p.feeCents;
  const split = distribute(
    newTotalCents - lockedCents,
    open.map((p, i) => ({ id: p.id, weightBp: feeW[i], amount: 0 })),
    new Set(),
  );
  if (split.ok) Object.assign(fees, split.amounts);
  for (const p of open)
    if (fees[p.id] < p.billedCents) return { ok: false, error: "below_billed", code: p.code, billedCents: p.billedCents };

  let hours: Record<string, number> | null = null;
  if (newTotalHours !== null) {
    const toUnits = (h: number) => Math.round(h * 4);
    const lockedUnits = phases.filter((p) => locked.has(p.id)).reduce((n, p) => n + toUnits(p.budgetHours), 0);
    const hourW = weightsOf((p) => toUnits(p.budgetHours)) ?? feeW;
    const unitSplit = distribute(
      Math.max(0, toUnits(newTotalHours) - lockedUnits),
      open.map((p, i) => ({ id: p.id, weightBp: hourW[i], amount: 0 })),
      new Set(),
    );
    hours = {};
    for (const p of phases) if (locked.has(p.id)) hours[p.id] = p.budgetHours;
    if (unitSplit.ok) for (const [k, v] of Object.entries(unitSplit.amounts)) hours[k] = v / 4;
  }
  return { ok: true, fees, hours };
}

// ---------------------------------------------------------------------------
// Rule 5: phase edit checks

export type EditRow = {
  /** Null for a phase added in this edit. */
  id: string | null;
  code: string;
  name: string;
  feeType: FeeType;
  feeCents: number;
  budgetHours: number;
  percentCompleteBp: number;
  status: PhaseStatus;
  startDate: string | null;
  endDate: string | null;
};

/** What's already happened to a saved phase (invoices arrive in 1.8). */
export type PhaseFacts = {
  feeType: FeeType;
  billedCents: number;
  lastBilledPctBp: number;
  hasInvoiceLines: boolean;
};

export const EDIT_MESSAGES = {
  code: "Code: 1–12 characters",
  codeTaken: "Another phase already uses this code",
  name: "Name: 1–80 characters",
  fee: "Enter a fee of $0 or more",
  nteCap: "Not-to-exceed phases need a cap",
  belowBilled: (billed: string) => `Fee can't be less than the ${billed} already billed`,
  hours: "Use quarter hours",
  hoursMax: "Too many hours",
  pct: "Use 0–100%",
  pctBilled: (pct: number) => `Already billed through ${pct}%`,
  feeTypeLocked: "Fee type can't change after the phase has been billed",
  dates: "End can't be before the start",
} as const;

/**
 * Problems per row (index → field → message). `money` formats cents for the
 * "already billed" message. Empty when everything is fine.
 */
export function phaseEditProblems(
  rows: readonly EditRow[],
  facts: ReadonlyMap<string, PhaseFacts>,
  money: (cents: number) => string,
): Record<number, Record<string, string>> {
  const out: Record<number, Record<string, string>> = {};
  const add = (i: number, field: string, msg: string) => {
    out[i] ??= {};
    out[i][field] ??= msg;
  };
  const codes = new Map<string, number>();
  rows.forEach((r, i) => {
    const code = r.code.trim();
    if (code.length < 1 || code.length > 12) add(i, "code", EDIT_MESSAGES.code);
    const key = code.toLowerCase();
    if (codes.has(key)) add(i, "code", EDIT_MESSAGES.codeTaken);
    else codes.set(key, i);
    if (r.name.trim().length < 1 || r.name.trim().length > 80) add(i, "name", EDIT_MESSAGES.name);
    if (!Number.isInteger(r.feeCents) || r.feeCents < 0) add(i, "feeCents", EDIT_MESSAGES.fee);
    if (r.feeType === "nte" && r.feeCents <= 0) add(i, "feeCents", EDIT_MESSAGES.nteCap);
    if (!Number.isInteger(r.budgetHours * 4) || r.budgetHours < 0) add(i, "budgetHours", EDIT_MESSAGES.hours);
    else if (r.budgetHours > 999_999.75) add(i, "budgetHours", EDIT_MESSAGES.hoursMax);
    if (!Number.isInteger(r.percentCompleteBp) || r.percentCompleteBp < 0 || r.percentCompleteBp > 10_000)
      add(i, "percentCompleteBp", EDIT_MESSAGES.pct);
    if (r.startDate && r.endDate && r.endDate < r.startDate) add(i, "endDate", EDIT_MESSAGES.dates);

    const f = r.id ? facts.get(r.id) : undefined;
    if (!f) return;
    if (r.feeType !== "hourly" && r.feeCents < f.billedCents) add(i, "feeCents", EDIT_MESSAGES.belowBilled(money(f.billedCents)));
    if (r.feeType === "fixed" && r.percentCompleteBp < f.lastBilledPctBp)
      add(i, "percentCompleteBp", EDIT_MESSAGES.pctBilled(f.lastBilledPctBp / 100));
    if (r.feeType !== f.feeType && f.hasInvoiceLines) add(i, "feeType", EDIT_MESSAGES.feeTypeLocked);
  });
  return out;
}

/** "SD is complete at 60%. Set to 100%?" (non-blocking). */
export function completeWarnings(rows: readonly EditRow[]): { index: number; text: string }[] {
  return rows.flatMap((r, index) =>
    r.feeType === "fixed" && r.status === "complete" && r.percentCompleteBp < 10_000
      ? [{ index, text: `${r.code} is complete at ${r.percentCompleteBp / 100}%. Set to 100%?` }]
      : [],
  );
}
