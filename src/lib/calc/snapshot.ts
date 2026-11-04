import type { PhaseStatus } from "./projects";
import { fmtHours } from "./project-detail";

// Project snapshot math (release-2/project-snapshot.md, built early in 1.5 C
// at Blake's request, 2026-11-04). Owner/admin only: these numbers use cost
// rates, which never leave the server for anyone else.
//
// Hours are handled in hundredths (integers) and money in cents with BigInt,
// rounded half away from zero once per step (ADR 0004).

/** Hours worked by one person on one phase at one cost rate. */
export type SnapshotEntry = {
  membershipId: string;
  hours: number;
  /** Cost rate per hour; null = no rate found (counts hours, adds no cost). */
  rateCents: number | null;
};

export type SnapshotPhaseInput = {
  id: string;
  status: PhaseStatus;
  feeCents: number;
  budgetHours: number;
  billedCents: number;
  /** Planned cost per hour for the remaining hours (Rule 9). */
  plannedRateCents: number;
  /** True when the planned rate is the firm average (no roles on the phase). */
  plannedEstimated: boolean;
  entries: SnapshotEntry[];
};

export type SnapshotPerson = {
  membershipId: string;
  hours: number;
  costCents: number;
  /** "$99.20 / h", "$95 / h" or "$81.50 / h (blended)"; "No rate" when none. */
  rateText: string;
};

export type SnapshotPhase = {
  id: string;
  usedHours: number;
  costCents: number;
  /** Hours on this phase with no cost rate (Rule 15). */
  missingRateHours: number;
  /** Null = "Not started" (no time and nothing billed). */
  profitCents: number | null;
  profitNote: string;
  remainingHours: number;
  remainingCostCents: number;
  /** Null = no fee. */
  projectedCents: number | null;
  projectedNote: string;
  people: SnapshotPerson[];
  detailNote: string;
};

export type SnapshotVariant = {
  phases: SnapshotPhase[];
  total: {
    usedHours: number;
    budgetHours: number;
    feeCents: number;
    billedCents: number;
    costCents: number;
    profitCents: number;
    projectedCents: number;
    projectedNote: string;
  };
  missingRateHours: number;
};

const b = BigInt;

/** n ÷ d rounded half away from zero (d > 0). */
export function rndDiv(n: bigint, d: bigint): bigint {
  const neg = n < 0n;
  const a = neg ? -n : n;
  const q = (a * 2n + d) / (2n * d);
  return neg ? -q : q;
}

/** Round half away from zero (JS Math.round gives −2 for −2.5; this gives −3). */
export function rnd(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x));
}

const hh = (hours: number) => b(Math.round(hours * 100));
const fromHh = (x: bigint) => Number(x) / 100;
/** Overhead factor in basis points: 10000 off, 10000 + OH on. */
const factor = (overheadBp: number, on: boolean) => b(on ? 10_000 + overheadBp : 10_000);

/** Cents as "$X" or "$X.YZ" (cents only when there are some). */
export function moneyText(cents: number): string {
  const abs = Math.abs(cents);
  const s = (abs / 100).toLocaleString("en-US", {
    minimumFractionDigits: abs % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${cents < 0 ? "−" : ""}$${s}`;
}
/** "About" amounts in notes: whole dollars (Rule 12). */
const aboutText = (cents: bigint) => moneyText(Number(rndDiv(cents, 100n)) * 100);

const done = (s: PhaseStatus) => s === "complete" || s === "closed";

/**
 * Planned cost per hour from a phase's role mix (Blake, 2026-11-04):
 * Σ(role hours × role cost rate) ÷ Σ role hours. Null when the phase has no
 * roles with hours; the caller then uses the firm average.
 */
export function plannedRateFromRoles(roles: readonly { hours: number; costCents: number }[]): number | null {
  const hours = roles.reduce((n, r) => n + hh(r.hours), 0n);
  if (hours <= 0n) return null;
  const cost = roles.reduce((n, r) => n + hh(r.hours) * b(r.costCents), 0n);
  return Number(rndDiv(cost, hours));
}

/**
 * Firm average cost rate: each role's current cost rate weighted by the
 * active people in it. Roles nobody holds count once if nobody holds any.
 */
export function firmAverageCostRate(roles: readonly { costCents: number; people: number }[]): number {
  const priced = roles.filter((r) => r.costCents > 0);
  const staffed = priced.filter((r) => r.people > 0);
  const use = staffed.length ? staffed : priced.map((r) => ({ ...r, people: 1 }));
  const n = use.reduce((s, r) => s + r.people, 0);
  if (n === 0) return 0;
  return Number(rndDiv(use.reduce((s, r) => s + b(r.costCents) * b(r.people), 0n), b(n)));
}

function personRows(entries: readonly SnapshotEntry[], f: bigint): { people: SnapshotPerson[]; cost: bigint; missing: bigint } {
  const by = new Map<string, SnapshotEntry[]>();
  for (const e of entries) by.set(e.membershipId, [...(by.get(e.membershipId) ?? []), e]);
  let cost = 0n;
  let missing = 0n;
  const people = [...by].map(([membershipId, list]) => {
    const hours = list.reduce((n, e) => n + hh(e.hours), 0n);
    const priced = list.filter((e) => e.rateCents !== null);
    missing += list.filter((e) => e.rateCents === null).reduce((n, e) => n + hh(e.hours), 0n);
    // Rule 3: one rounding for the person's whole cost on the phase.
    const raw = priced.reduce((n, e) => n + hh(e.hours) * b(e.rateCents!), 0n);
    const c = rndDiv(raw * f, 1_000_000n);
    cost += c;
    const rates = new Set(priced.map((e) => e.rateCents));
    const pricedHh = priced.reduce((n, e) => n + hh(e.hours), 0n);
    let rateText = "No rate";
    if (rates.size === 1 && priced.length === list.length) rateText = `${moneyText(Number(rndDiv(b([...rates][0]!) * f, 10_000n)))} / h`;
    else if (pricedHh > 0n) rateText = `${moneyText(Number(rndDiv(c * 100n, pricedHh)))} / h (blended)`;
    return { membershipId, hours: fromHh(hours), costCents: Number(c), rateText };
  });
  return { people, cost, missing };
}

/** One phase in one variant (overhead on or off). */
export function snapshotPhase(p: SnapshotPhaseInput, overheadBp: number, includeOverhead: boolean): SnapshotPhase {
  const f = factor(overheadBp, includeOverhead);
  const { people, cost, missing } = personRows(p.entries, f);
  const used = p.entries.reduce((n, e) => n + hh(e.hours), 0n);
  const budget = hh(p.budgetHours);
  const billed = b(p.billedCents);
  const fee = b(p.feeCents);

  // Rule 5: profit to date.
  const notStarted = used === 0n && billed === 0n;
  const profit = billed - cost;
  const profitNote = notStarted
    ? "Not started"
    : billed > 0n
      ? `${rndDiv(profit * 100n, billed)}% margin`
      : "Work not billed yet";

  // Rules 6–8: remaining and projected.
  const remaining = done(p.status) ? 0n : budget > used ? budget - used : 0n;
  const planned = b(p.plannedRateCents);
  const remainingCost = rndDiv(remaining * planned * f, 1_000_000n);
  const projected = fee - (cost + remainingCost);
  const projectedNote =
    fee === 0n ? "No fee" : `${rndDiv(projected * 100n, fee)}% margin${done(p.status) ? " · final" : ""}`;

  // Rule 12: one-line note under the people.
  const est = p.plannedEstimated ? " (estimated)" : "";
  const over = used > budget ? used - budget : 0n;
  let detailNote: string;
  if (done(p.status)) {
    detailNote = over
      ? `Finished ${fmtHours(fromHh(over))} h over budget. Those hours cost about ${aboutText(rndDiv(over * planned * f, 1_000_000n))} in profit.`
      : "Finished within budget.";
  } else if (p.status === "current" || used > 0n) {
    detailNote =
      used <= budget
        ? `${fmtHours(fromHh(budget - used))} budget hours left. At the planned rate${est} that's about ${aboutText(remainingCost)} more ${includeOverhead ? "cost" : "labor"} before this phase is billed in full.`
        : `${fmtHours(fromHh(over))} h over budget and still in progress.`;
  } else {
    detailNote = `No time logged yet. Budget: ${fmtHours(p.budgetHours)} h at a planned ${aboutText(rndDiv(planned * f, 10_000n))} / h${est}${includeOverhead ? " with overhead." : "."}`;
  }

  return {
    id: p.id,
    usedHours: fromHh(used),
    costCents: Number(cost),
    missingRateHours: fromHh(missing),
    profitCents: notStarted ? null : Number(profit),
    profitNote,
    remainingHours: fromHh(remaining),
    remainingCostCents: Number(remainingCost),
    projectedCents: fee === 0n ? null : Number(projected),
    projectedNote,
    people,
    detailNote,
  };
}

/** Every phase plus the total row (Rule 11), in one variant. */
export function snapshotVariant(phases: readonly SnapshotPhaseInput[], overheadBp: number, includeOverhead: boolean): SnapshotVariant {
  const rows = phases.map((p) => snapshotPhase(p, overheadBp, includeOverhead));
  const sum = (f: (i: number) => number) => phases.reduce((n, _, i) => n + f(i), 0);
  const fee = sum((i) => phases[i].feeCents);
  const billed = sum((i) => phases[i].billedCents);
  const cost = sum((i) => rows[i].costCents);
  const projected = sum((i) => rows[i].projectedCents ?? 0);
  return {
    phases: rows,
    total: {
      usedHours: sum((i) => rows[i].usedHours * 100) / 100,
      budgetHours: sum((i) => Math.round(phases[i].budgetHours * 100)) / 100,
      feeCents: fee,
      billedCents: billed,
      costCents: cost,
      profitCents: billed - cost,
      projectedCents: projected,
      projectedNote: fee === 0 ? "No fee" : `${rndDiv(b(projected) * 100n, b(fee))}% margin`,
    },
    missingRateHours: sum((i) => rows[i].missingRateHours * 100) / 100,
  };
}

/** Rule 13: the footer sentence. */
export function snapshotFooter(overheadBp: number, includeOverhead: boolean): string {
  if (!includeOverhead)
    return "Labor cost = hours × each person's cost rate (Settings → Roles & rates). Overhead isn't included, so true profit is lower. Turn on “Include overhead” to see it.";
  return `Cost = hours × cost rate × ${((10_000 + overheadBp) / 10_000).toFixed(2)} (labor plus ${overheadPct(overheadBp)} overhead from Settings). Profit shown is true profit. Projected profit = fee − cost so far − remaining budget hours at the planned rate, with overhead.`;
}

/** 6000 → "60%", 1250 → "12.5%". */
export function overheadPct(bp: number): string {
  return `${(bp / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}
