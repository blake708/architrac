/**
 * Progress bar status (e.g. hours used vs budget), from DESIGN_SYSTEM.md:
 * "warning" at 90% or more, "over" once past 100%.
 *
 * When over budget the bar is rescaled so its full width is the amount used:
 * the budget part is a solid fill and the overrun is a hatched segment after it.
 */
export type ProgressTone = "normal" | "warning" | "over";

export type ProgressStatus = {
  /** Whole-number percent of the budget used. Can exceed 100. */
  percent: number;
  /** Width of the solid (within budget) segment, 0–100. */
  fillWidth: number;
  /** Width of the hatched (over budget) segment, 0–100. */
  overWidth: number;
  tone: ProgressTone;
};

export function progressStatus(used: number, budget: number): ProgressStatus {
  const safeUsed = Math.max(0, used);
  if (budget <= 0) {
    // No budget: anything used is all overrun.
    return safeUsed > 0
      ? { percent: 100, fillWidth: 0, overWidth: 100, tone: "over" }
      : { percent: 0, fillWidth: 0, overWidth: 0, tone: "normal" };
  }

  const exact = (safeUsed / budget) * 100;
  const percent = Math.round(exact);
  if (exact <= 100) {
    return {
      percent,
      fillWidth: exact,
      overWidth: 0,
      tone: exact >= 90 ? "warning" : "normal",
    };
  }

  // Over budget: the bar's full width is the amount used.
  const fillWidth = (budget / safeUsed) * 100;
  return { percent, fillWidth, overWidth: 100 - fillWidth, tone: "over" };
}
