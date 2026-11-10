import { describe, expect, it } from "vitest";
import { RATE_MISSING_ASK, barsLabel, billablePct, dayBar, timesheetFlags } from "./timesheet-flags";

const sum = (h: number[]) => h.reduce((a, b) => a + b, 0);
const flagOf = (hours: number[], capacity = 40, missing: string[] = [], showRateDates = true) =>
  timesheetFlags({ total: sum(hours), capacity, missingRateDates: missing, showRateDates })[0]?.label ?? "—";

describe("timesheetFlags (rule 6 seed check)", () => {
  it("DS 38 h → 2 h under target; SG 46 h → Over 44 h; KL 40 → clean; EW 24 of 24 → clean", () => {
    expect(flagOf([8, 8, 8, 8, 6])).toBe("2 h under target");
    expect(flagOf([10, 9, 9, 9, 9])).toBe("Over 44 h");
    expect(flagOf([8, 8, 8, 8, 8])).toBe("—");
    expect(flagOf([6, 6, 6, 6, 0], 24)).toBe("—");
  });

  it("exactly cap + 4 is not over", () => {
    expect(flagOf([9, 9, 9, 9, 8])).toBe("—");
  });

  it("a missing rate comes first; only owner/admin see the dates", () => {
    expect(flagOf([8, 8, 8, 8, 8], 40, ["2026-10-15", "2026-10-14", "2026-10-14"])).toBe("No rate for Oct 14, Oct 15");
    expect(flagOf([8, 8, 8, 8, 8], 40, ["2026-10-14"], false)).toBe(RATE_MISSING_ASK);
    const all = timesheetFlags({ total: 46, capacity: 40, missingRateDates: ["2026-10-14"], showRateDates: true });
    expect(all.map((f) => f.kind)).toEqual(["no_rate", "over"]);
  });
});

describe("day bars", () => {
  it("height max(2, round(h / 10 × 26)); 0 empty, over 9 orange", () => {
    expect(dayBar(0)).toEqual({ height: 2, tone: "empty" });
    expect(dayBar(8)).toEqual({ height: 21, tone: "normal" });
    expect(dayBar(9)).toEqual({ height: 23, tone: "normal" });
    expect(dayBar(10)).toEqual({ height: 26, tone: "over" });
  });

  it("labels and billable percent", () => {
    expect(barsLabel([8, 8, 8, 8, 7.5])).toBe("Mon to Fri: 8, 8, 8, 8, 7.5 hours");
    expect(billablePct(30, 40)).toBe(75);
    expect(billablePct(0, 0)).toBe(0);
  });
});
