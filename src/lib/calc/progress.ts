/**
 * Progress bar status (e.g. hours used vs budget), from DESIGN_SYSTEM.md:
 * blue while normal, orange at 90% or more, red once over 100%.
 */
export type ProgressTone = "normal" | "warning" | "over";

export type ProgressStatus = {
  /** Whole-number percent of the budget used. Can exceed 100. */
  percent: number;
  /** Bar width, 0–100. */
  fillPercent: number;
  tone: ProgressTone;
};

export function progressStatus(used: number, budget: number): ProgressStatus {
  const safeUsed = Math.max(0, used);
  if (budget <= 0) {
    // No budget: anything used is over it.
    return safeUsed > 0
      ? { percent: 100, fillPercent: 100, tone: "over" }
      : { percent: 0, fillPercent: 0, tone: "normal" };
  }
  const exact = (safeUsed / budget) * 100;
  const tone: ProgressTone =
    exact > 100 ? "over" : exact >= 90 ? "warning" : "normal";
  return {
    percent: Math.round(exact),
    fillPercent: Math.min(100, exact),
    tone,
  };
}
