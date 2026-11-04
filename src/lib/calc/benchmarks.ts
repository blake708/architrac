// New project estimate (projects-list spec, "Estimate"; Blake, 2026-11-04):
// construction cost from square feet × cost per SF, and the architectural fee
// as a % of construction, each as a low–typical–high range.
//
// Ranges come from the firm's own past projects of the same type (and scope)
// when there are at least 3, otherwise from Settings → Phases → Project type
// ranges. Only ranges across 3+ projects ever leave the server, never one
// project's numbers.

export const MIN_PAST_PROJECTS = 3;

/** low ≤ typical ≤ high. Cost per SF in cents; fee in basis points of construction. */
export type Range = { low: number; typical: number; high: number };

export type Benchmark = {
  costPerSfCents: Range;
  feeBp: Range;
  /** "past": from {count} past projects; "settings": typed in Settings. */
  source:
    | { kind: "past"; count: number; scoped: boolean }
    | { kind: "settings"; scoped: boolean };
};

/** A past project's facts (server only). */
export type PastProject = {
  constructionCents: number;
  squareFeet: number;
  feeCents: number;
};

/** Linear-interpolated percentile of sorted numbers (p in 0–1). */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const x = (sorted.length - 1) * p;
  const lo = Math.floor(x);
  const hi = Math.ceil(x);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (x - lo);
}

const middleHalf = (values: number[]): Range => {
  const s = [...values].sort((a, b) => a - b);
  return {
    low: Math.round(percentile(s, 0.25)),
    typical: Math.round(percentile(s, 0.5)),
    high: Math.round(percentile(s, 0.75)),
  };
};

/**
 * Ranges from past projects: the middle half (25th–75th percentile), typical
 * = median. Projects without square feet, construction cost or fee are
 * skipped. Null when fewer than 3 remain.
 */
export function pastRanges(
  projects: readonly PastProject[],
): { count: number; costPerSfCents: Range; feeBp: Range } | null {
  const usable = projects.filter(
    (p) => p.squareFeet > 0 && p.constructionCents > 0 && p.feeCents > 0,
  );
  if (usable.length < MIN_PAST_PROJECTS) return null;
  return {
    count: usable.length,
    costPerSfCents: middleHalf(
      usable.map((p) => p.constructionCents / p.squareFeet),
    ),
    feeBp: middleHalf(
      usable.map((p) => (p.feeCents * 10_000) / p.constructionCents),
    ),
  };
}

/** A Settings range: typical is the midpoint. */
export function settingsRange(low: number, high: number): Range {
  return { low, typical: Math.round((low + high) / 2), high };
}

/** Lower-case key for a type, optionally with a scope: "medical office|ground_up". */
export const benchmarkKey = (projectType: string, scope: string | null) =>
  `${projectType.trim().toLowerCase()}|${scope ?? ""}`;

/**
 * The best benchmark for a type and scope: past projects with that scope,
 * past projects of the type, Settings with that scope, Settings for any scope.
 */
export function pickBenchmark(
  projectType: string,
  scope: string | null,
  past: Readonly<Record<string, Benchmark>>,
  settings: Readonly<Record<string, Benchmark>>,
): Benchmark | null {
  if (!projectType.trim()) return null;
  const keys = scope
    ? [benchmarkKey(projectType, scope), benchmarkKey(projectType, null)]
    : [benchmarkKey(projectType, null)];
  for (const k of keys) if (past[k]) return past[k];
  for (const k of keys) if (settings[k]) return settings[k];
  return null;
}

export type Estimate = {
  /** Null without square feet. */
  construction: Range | null;
  /** What the fee % applies to: the entered construction estimate, else the typical estimate. */
  feeBase: { cents: number; entered: boolean } | null;
  feeBp: Range;
  /** Fee in dollars over the base, rounded to $100. */
  feeCents: Range | null;
};

const to100 = (cents: number) => Math.round(cents / 10_000) * 10_000;

/** The estimate shown at the top of Phases & fees. */
export function estimate(
  b: Benchmark,
  squareFeet: number | null,
  enteredConstructionCents: number | null,
): Estimate {
  const construction =
    squareFeet && squareFeet > 0
      ? {
          low: to100(b.costPerSfCents.low * squareFeet),
          typical: to100(b.costPerSfCents.typical * squareFeet),
          high: to100(b.costPerSfCents.high * squareFeet),
        }
      : null;
  const feeBase =
    enteredConstructionCents && enteredConstructionCents > 0
      ? { cents: enteredConstructionCents, entered: true }
      : construction
        ? { cents: construction.typical, entered: false }
        : null;
  const feeCents = feeBase
    ? {
        low: to100((feeBase.cents * b.feeBp.low) / 10_000),
        typical: to100((feeBase.cents * b.feeBp.typical) / 10_000),
        high: to100((feeBase.cents * b.feeBp.high) / 10_000),
      }
    : null;
  return { construction, feeBase, feeBp: b.feeBp, feeCents };
}

/** 300 → "3%", 285 → "2.85%". */
export const bpText = (bp: number) =>
  `${(bp / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

/** Where the numbers came from, for the label under the estimate. */
export function sourceText(
  b: Benchmark,
  projectType: string,
  scopeLabel: string | null,
): string {
  const what = [scopeLabel?.toLowerCase(), projectType.toLowerCase()]
    .filter(Boolean)
    .join(" ");
  if (b.source.kind === "past")
    return `From ${b.source.count} past ${b.source.scoped ? what : projectType.toLowerCase()} projects (middle half)`;
  return `From Settings → Phases: ${b.source.scoped ? what : `${projectType.toLowerCase()}, any scope`}`;
}

/**
 * A role's share of the phase fee from typed hours (Blake, 2026-11-04: type a
 * % or hours): hours × bill rate ÷ fee, in basis points. Null without a fee
 * or a rate.
 */
export function shareFromHours(
  hours: number,
  rateCents: number,
  feeCents: number,
): number | null {
  if (feeCents <= 0 || rateCents <= 0) return null;
  return Math.round((hours * rateCents * 10_000) / feeCents);
}
