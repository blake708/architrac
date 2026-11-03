import { describe, expect, it } from "vitest";
import {
  activityText,
  consultantFeeToClient,
  costPerSfDollars,
  feeTypeSummary,
  hoursNote,
  pctOfConstruction,
  remainingText,
  stepperNote,
} from "./project-detail";

// Examples from docs/specs/release-1/project-detail.md, fixture F2 (MOB).

describe("rule 7: consultant fee to client", () => {
  const c = (feeCents: number) => consultantFeeToClient({ feeCents, markupBp: 1000, billedThrough: true });
  it("MOB at 10%", () => {
    expect(c(1_450_000)).toBe(1_595_000);
    expect(c(1_820_000)).toBe(2_002_000);
    expect(c(3_680_000)).toBe(4_048_000);
    expect(c(640_000)).toBe(704_000);
    expect(c(1_450_000)! + c(1_820_000)! + c(3_680_000)! + c(640_000)!).toBe(8_349_000);
  });
  it("not billed through → null; odd cents round half up", () => {
    expect(consultantFeeToClient({ feeCents: 100, markupBp: 1000, billedThrough: false })).toBeNull();
    expect(consultantFeeToClient({ feeCents: 5, markupBp: 1000, billedThrough: true })).toBe(6); // 5.5 → 6
  });
});

describe("rule 8: fee-type summary", () => {
  it("one type, mixed, short form", () => {
    expect(feeTypeSummary(["fixed", "fixed"])).toBe("Fixed fee · billed by % complete");
    expect(feeTypeSummary(["hourly"])).toBe("Hourly · billed by hours worked");
    expect(feeTypeSummary(["nte"], true)).toBe("Not-to-exceed");
    expect(feeTypeSummary(["fixed", "hourly"])).toBe("Mixed fee types");
    expect(feeTypeSummary([])).toBe("Mixed fee types");
  });
});

describe("rule 9: stepper note", () => {
  it("done, now, upcoming", () => {
    expect(stepperNote({ status: "closed", startDate: null, endDate: "2026-09-04" })).toBe("Done · Sep 4");
    expect(stepperNote({ status: "complete", startDate: null, endDate: null })).toBe("Done");
    expect(stepperNote({ status: "current", startDate: null, endDate: "2026-11-25" })).toBe("Now · to Nov 25");
    expect(stepperNote({ status: "current", startDate: null, endDate: null })).toBe("Now");
    expect(stepperNote({ status: "upcoming", startDate: "2026-12-01", endDate: "2027-03-15" })).toBe("Dec 1 – Mar 15");
    expect(stepperNote({ status: "upcoming", startDate: "2027-04-01", endDate: null })).toBe("From Apr 2027");
    expect(stepperNote({ status: "upcoming", startDate: null, endDate: null })).toBe("—");
  });
});

describe("hours", () => {
  const MOB = [
    { code: "PD", sortOrder: 1, budgetHours: 62, usedHours: 58 },
    { code: "SD", sortOrder: 2, budgetHours: 186, usedHours: 201 },
    { code: "DD", sortOrder: 3, budgetHours: 310, usedHours: 64 },
    { code: "CD", sortOrder: 4, budgetHours: 434, usedHours: 0 },
    { code: "PRM", sortOrder: 5, budgetHours: 62, usedHours: 0 },
    { code: "CA", sortOrder: 6, budgetHours: 186, usedHours: 0 },
    { code: "CO", sortOrder: 7, budgetHours: 0, usedHours: 0 },
  ];
  it("tile note names the worst overage", () => {
    expect(hoursNote(MOB)).toBe("of 1,240 budgeted · SD ran 15 h over");
    expect(hoursNote(MOB.map((p) => ({ ...p, usedHours: 0 })))).toBe("of 1,240 budgeted");
  });
  it("rule 4: remaining", () => {
    expect(remainingText(62, 58)).toEqual({ text: "4 h", over: false });
    expect(remainingText(186, 201)).toEqual({ text: "15 h over", over: true });
    expect(remainingText(1240, 323)).toEqual({ text: "917 h", over: false });
  });
});

describe("overview tiles", () => {
  it("% of construction and $/SF", () => {
    expect(pctOfConstruction(18_600_000, 620_000_000)).toBe("3.0%");
    expect(pctOfConstruction(18_600_000, null)).toBeNull();
    expect(costPerSfDollars(620_000_000, 20_000)).toBe(310);
    expect(costPerSfDollars(620_000_000, null)).toBeNull();
  });
});

describe("rule 10: activity text", () => {
  it("templates", () => {
    expect(activityText({ entityType: "project", action: "created", label: "", changes: null })).toBe("created the project");
    expect(
      activityText({ entityType: "project_phase", action: "updated", label: "CD", changes: { feeCents: {}, budgetHours: {}, name: {}, code: {} } }),
    ).toBe("updated CD (fee, budget hours, name)");
    expect(
      activityText({ entityType: "project", action: "status_changed", label: "", changes: { status: { before: "active", after: "on_hold" } } }),
    ).toBe("moved the project to on hold");
    expect(activityText({ entityType: "consultant", action: "archived", label: "MEP", changes: null })).toBe("removed MEP");
  });
});
