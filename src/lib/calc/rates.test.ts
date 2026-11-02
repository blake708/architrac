import { describe, expect, it } from "vitest";
import {
  type RoleRateFacts,
  avgMultiplierHundredths,
  blendedBillRateCents,
  breakevenHundredths,
  dayBefore,
  lookupRate,
  multiplierHundredths,
  multiplierStatus,
  overheadPctFromActuals,
  phaseTotalNote,
  planRateChange,
  rateOn,
  rolesFlagged,
  trueHourCost,
} from "./rates";

// TMG seed (settings-rates-phases spec, Seed values).
const SEED: (RoleRateFacts & { name: string })[] = [
  { name: "Principal", billCents: 18500, costCents: 9500, people: 1 },
  { name: "Project manager", billCents: 15000, costCents: 6200, people: 1 },
  { name: "Project architect", billCents: 14500, costCents: 5800, people: 2 },
  { name: "Designer", billCents: 11500, costCents: 4400, people: 6 },
  { name: "Interior designer", billCents: 12000, costCents: 5200, people: 1 },
  { name: "Intern", billCents: 7500, costCents: 2400, people: 1 },
  { name: "Office manager", billCents: 0, costCents: 3800, people: 1 },
  { name: "Bookkeeper", billCents: 0, costCents: 4000, people: 1 },
];
const role = (name: string) => SEED.find((r) => r.name === name)!;

describe("multiplier (rule 2)", () => {
  it.each([
    ["Principal", 195, "flagged"],
    ["Project manager", 242, "flagged"],
    ["Project architect", 250, "ok"],
    ["Designer", 261, "ok"],
    ["Interior designer", 231, "flagged"],
    ["Intern", 313, "ok"], // 3.125 rounds half up
  ] as const)("%s → %i hundredths, %s", (name, m, status) => {
    const r = role(name);
    expect(multiplierHundredths(r.billCents, r.costCents)).toBe(m);
    expect(multiplierStatus(r.billCents, r.costCents)).toBe(status);
  });

  it("is none for roles that aren't billable", () => {
    expect(multiplierHundredths(0, 3800)).toBeNull();
    expect(multiplierStatus(0, 3800)).toBe("none");
    expect(multiplierStatus(11500, 0)).toBe("none");
  });

  it("Designer at $40 cost shows 2.88× (acceptance test)", () => {
    expect(multiplierHundredths(11500, 4000)).toBe(288);
  });

  it("Senior designer $130 / $50 shows 2.60×", () => {
    expect(multiplierHundredths(13000, 5000)).toBe(260);
  });
});

describe("KPIs (rules 3–6)", () => {
  it('blended bill rate is 12,583 cents ("$126 / h")', () => {
    expect(blendedBillRateCents(SEED)).toBe(12_583);
  });

  it('average multiplier is 2.54×', () => {
    expect(avgMultiplierHundredths(SEED)).toBe(254);
  });

  it("3 roles are flagged", () => {
    expect(rolesFlagged(SEED)).toBe(3);
  });

  it("breakeven is 1.60× at 60% overhead and 1.75× at 75%", () => {
    expect(breakevenHundredths(6000)).toBe(160);
    expect(breakevenHundredths(7500)).toBe(175);
  });

  it("returns null when no one is in a billable role", () => {
    const empty = SEED.map((r) => ({ ...r, people: 0 }));
    expect(blendedBillRateCents(empty)).toBeNull();
    expect(avgMultiplierHundredths(empty)).toBeNull();
    expect(blendedBillRateCents([])).toBeNull();
  });
});

describe("true cost of an hour (rule 7)", () => {
  it("Designer: $44 labor + $26.40 overhead = $70.40", () => {
    expect(trueHourCost(4400, 6000)).toEqual({
      trueCostCents: 7040,
      overheadCents: 2640,
    });
  });

  it("Designer at $40 cost: $64.00", () => {
    expect(trueHourCost(4000, 6000).trueCostCents).toBe(6400);
  });
});

describe("overhead from last year (rule 9)", () => {
  it("$612,000 ÷ $1,020,000 = 60%", () => {
    expect(overheadPctFromActuals(61_200_000, 102_000_000)).toBe(60);
  });

  it("needs both numbers above 0", () => {
    expect(overheadPctFromActuals(61_200_000, 0)).toBeNull();
    expect(overheadPctFromActuals(0, 102_000_000)).toBeNull();
    expect(overheadPctFromActuals(Number.NaN, 1)).toBeNull();
  });
});

describe("phase total note (rule 10)", () => {
  it.each([
    [100, "Adds up to the full fee"],
    [95, "5% of the fee is unassigned"],
    [110, "10% over the full fee"],
  ])("%i%% → %s", (total, note) => {
    expect(phaseTotalNote(total)).toBe(note);
  });
});

describe("effective-dated rates (rule 8)", () => {
  const current = { effectiveFrom: "2026-01-01", effectiveTo: null };

  it("a later date ends the current rate the day before", () => {
    expect(planRateChange(current, "2026-11-01")).toEqual({
      kind: "split",
      closeCurrentOn: "2026-10-31",
    });
  });

  it("the same date updates the current rate in place", () => {
    expect(planRateChange(current, "2026-01-01")).toEqual({ kind: "update" });
  });

  it("an earlier date is rejected", () => {
    expect(planRateChange(current, "2025-12-15")).toEqual({
      kind: "reject",
      earliest: "2026-01-01",
    });
  });

  it("dayBefore crosses months and leap days", () => {
    expect(dayBefore("2026-03-01")).toBe("2026-02-28");
    expect(dayBefore("2028-03-01")).toBe("2028-02-29");
    expect(dayBefore("2026-01-01")).toBe("2025-12-31");
  });

  const designer = [
    { id: "old", effectiveFrom: "2026-01-01", effectiveTo: "2026-10-31" },
    { id: "new", effectiveFrom: "2026-11-01", effectiveTo: null },
  ];

  it("finds the rate in force on a date", () => {
    expect(rateOn(designer, "2026-10-31")?.id).toBe("old");
    expect(rateOn(designer, "2026-11-01")?.id).toBe("new");
    expect(rateOn(designer, "2025-12-31")).toBeNull();
  });

  it("a person's override wins over their role's rate", () => {
    const person = [
      { id: "kl", effectiveFrom: "2026-06-01", effectiveTo: null },
    ];
    expect(lookupRate(person, designer, "2026-07-01")?.id).toBe("kl");
    expect(lookupRate(person, designer, "2026-05-01")?.id).toBe("old");
    expect(lookupRate([], [], "2026-05-01")).toBeNull();
  });
});
