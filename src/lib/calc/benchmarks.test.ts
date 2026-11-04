import { describe, expect, it } from "vitest";
import {
  type Benchmark,
  benchmarkKey,
  bpText,
  estimate,
  pastRanges,
  percentile,
  pickBenchmark,
  settingsRange,
  shareFromHours,
  sourceText,
} from "./benchmarks";

const proj = (sf: number, costDollars: number, feeDollars: number) => ({
  squareFeet: sf,
  constructionCents: costDollars * 100,
  feeCents: feeDollars * 100,
});

describe("percentile", () => {
  it("interpolates between neighbours", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([10, 20, 30, 40, 50], 0.25)).toBe(20);
    expect(percentile([7], 0.75)).toBe(7);
    expect(percentile([], 0.5)).toBe(0);
  });
});

describe("past projects", () => {
  it("needs 3 usable projects", () => {
    expect(
      pastRanges([proj(1000, 300_000, 9000), proj(2000, 600_000, 18_000)]),
    ).toBeNull();
    expect(
      pastRanges([
        proj(1000, 300_000, 9000),
        proj(2000, 600_000, 18_000),
        proj(0, 1, 1),
      ]),
    ).toBeNull();
  });

  it("middle half of cost per SF and fee %", () => {
    // $/SF 280, 300, 310, 330, 360; fee % 2.5, 2.8, 3.0, 3.2, 3.5
    const r = pastRanges([
      proj(10_000, 2_800_000, 70_000),
      proj(10_000, 3_000_000, 84_000),
      proj(20_000, 6_200_000, 186_000),
      proj(10_000, 3_300_000, 105_600),
      proj(10_000, 3_600_000, 126_000),
    ])!;
    expect(r.count).toBe(5);
    expect(r.costPerSfCents).toEqual({
      low: 30_000,
      typical: 31_000,
      high: 33_000,
    });
    expect(r.feeBp).toEqual({ low: 280, typical: 300, high: 320 });
  });
});

const bench = (kind: "past" | "settings", scoped = false): Benchmark => ({
  costPerSfCents: settingsRange(29_000, 33_000),
  feeBp: settingsRange(280, 340),
  source: kind === "past" ? { kind, count: 4, scoped } : { kind, scoped },
});

describe("picking a benchmark", () => {
  const past = {
    [benchmarkKey("Medical office", "ground_up")]: bench("past", true),
  };
  const settings = {
    [benchmarkKey("medical office", null)]: bench("settings"),
    [benchmarkKey("Retail", "shell")]: bench("settings", true),
  };

  it("past projects with the same scope first, then Settings", () => {
    expect(
      pickBenchmark("Medical Office", "ground_up", past, settings)?.source,
    ).toEqual({ kind: "past", count: 4, scoped: true });
    expect(
      pickBenchmark("Medical office", "tenant_upfit", past, settings)?.source
        .kind,
    ).toBe("settings");
    expect(pickBenchmark("Retail", "shell", past, settings)?.source).toEqual({
      kind: "settings",
      scoped: true,
    });
    expect(pickBenchmark("Retail", null, past, settings)).toBeNull();
    expect(pickBenchmark("", null, past, settings)).toBeNull();
  });
});

describe("estimate", () => {
  it("construction from square feet; fee from the typical estimate", () => {
    const e = estimate(bench("settings"), 20_000, null);
    expect(e.construction).toEqual({
      low: 580_000_000,
      typical: 620_000_000,
      high: 660_000_000,
    });
    expect(e.feeBase).toEqual({ cents: 620_000_000, entered: false });
    expect(e.feeBp).toEqual({ low: 280, typical: 310, high: 340 });
    expect(e.feeCents).toEqual({
      low: 17_360_000,
      typical: 19_220_000,
      high: 21_080_000,
    });
  });

  it("an entered construction estimate is the fee base", () => {
    const e = estimate(bench("settings"), 20_000, 600_000_000);
    expect(e.feeBase).toEqual({ cents: 600_000_000, entered: true });
    expect(e.feeCents?.typical).toBe(18_600_000);
  });

  it("no square feet and no estimate: fee % only", () => {
    const e = estimate(bench("settings"), null, null);
    expect(e.construction).toBeNull();
    expect(e.feeCents).toBeNull();
  });

  it("text", () => {
    expect(bpText(300)).toBe("3%");
    expect(bpText(285)).toBe("2.85%");
    expect(sourceText(bench("past", true), "Medical office", "Ground-up")).toBe(
      "From 4 past ground-up medical office projects (middle half)",
    );
    expect(sourceText(bench("settings"), "Medical office", "Ground-up")).toBe(
      "From Settings → Phases: medical office, any scope",
    );
  });
});

describe("share from hours", () => {
  it("hours × rate ÷ fee", () => {
    // 30.25 h × $185 = $5,596.25 of $27,900 → 20.06%
    expect(shareFromHours(30.25, 18_500, 2_790_000)).toBe(2006);
    expect(shareFromHours(10, 18_500, 0)).toBeNull();
    expect(shareFromHours(10, 0, 100_000)).toBeNull();
  });
});
