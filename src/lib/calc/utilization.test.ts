import { describe, expect, it } from "vitest";
import {
  utilizationPct,
  utilizationView,
  utilizationWindow,
} from "./utilization";

describe("utilizationWindow (rule 4)", () => {
  it("Sunday 2026-10-18, weeks start Monday → Sep 14 to Oct 11", () => {
    expect(utilizationWindow("2026-10-18", 1)).toEqual({
      from: "2026-09-14",
      to: "2026-10-11",
    });
  });

  it("on the first day of a week, that week isn't counted", () => {
    expect(utilizationWindow("2026-10-12", 1)).toEqual({
      from: "2026-09-14",
      to: "2026-10-11",
    });
  });

  it("weeks starting Sunday", () => {
    // Wed 2026-10-14; this week began Sun 2026-10-11.
    expect(utilizationWindow("2026-10-14", 0)).toEqual({
      from: "2026-09-13",
      to: "2026-10-10",
    });
  });
});

describe("utilizationPct", () => {
  it("KL: 141 h at 40 h/week → 88%", () => {
    expect(utilizationPct(141, 40)).toBe(88);
  });
  it("DS: 126.5 h → 79%", () => {
    expect(utilizationPct(126.5, 40)).toBe(79);
  });
  it("EW: 72 h at 24 h/week → 75%", () => {
    expect(utilizationPct(72, 24)).toBe(75);
  });
  it("rounds half up", () => {
    expect(utilizationPct(0.8, 40)).toBe(1); // 0.5%
  });
  it("no capacity → null", () => {
    expect(utilizationPct(10, 0)).toBeNull();
  });
});

describe("utilizationView (rule 5)", () => {
  it("at or over target: shown, not below", () => {
    expect(utilizationView(141, 40, 8500)).toEqual({
      kind: "shown",
      pct: 88,
      targetPct: 85,
      fill: 88,
      below: false,
    });
  });
  it("below target", () => {
    expect(utilizationView(126.5, 40, 8500)).toMatchObject({ pct: 79, below: true });
  });
  it("over 100% caps the bar", () => {
    expect(utilizationView(180, 40, 8000)).toMatchObject({ pct: 113, fill: 100 });
  });
  it("target 0 or none → dash", () => {
    expect(utilizationView(100, 40, 0)).toEqual({ kind: "none" });
    expect(utilizationView(100, 40, null)).toEqual({ kind: "none" });
  });
  it("no hours yet shows 0%", () => {
    expect(utilizationView(0, 40, 8000)).toMatchObject({ pct: 0, below: true });
  });
});
