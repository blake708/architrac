import { describe, expect, it } from "vitest";
import {
  type SnapshotPhaseInput,
  firmAverageCostRate,
  moneyText,
  overheadPct,
  plannedRateFromRoles,
  rnd,
  rndDiv,
  snapshotFooter,
  snapshotPhase,
  snapshotVariant,
} from "./snapshot";

// Fixture F2 (project-detail spec) with the planned rates from the
// project-snapshot spec's worked example.
const RATE = { BM: 9500, JR: 6200, KL: 4400, AP: 5200 } as const;
const work = (w: Partial<Record<keyof typeof RATE, number>>) =>
  Object.entries(w).map(([k, h]) => ({ membershipId: k, hours: h!, rateCents: RATE[k as keyof typeof RATE] }));
const phase = (
  id: string,
  status: SnapshotPhaseInput["status"],
  feeCents: number,
  budgetHours: number,
  billedCents: number,
  plannedRateCents: number,
  entries: SnapshotPhaseInput["entries"] = [],
): SnapshotPhaseInput => ({ id, status, feeCents, budgetHours, billedCents, plannedRateCents, plannedEstimated: false, entries });

const F2 = (): SnapshotPhaseInput[] => [
  phase("PD", "complete", 930_000, 62, 930_000, 7000, work({ BM: 24, JR: 22, KL: 12 })),
  phase("SD", "complete", 2_790_000, 186, 2_790_000, 5800, work({ BM: 14, JR: 92, KL: 66, AP: 29 })),
  phase("DD", "current", 4_650_000, 310, 0, 5200, work({ BM: 4, JR: 50, KL: 10 })),
  phase("CD", "upcoming", 6_510_000, 434, 0, 5000),
  phase("PRM", "upcoming", 930_000, 62, 0, 6000),
  phase("CA", "upcoming", 2_790_000, 186, 0, 6600),
  phase("CO", "upcoming", 0, 0, 0, 0),
];
const OH = 6000;

describe("rounding", () => {
  it("rounds half away from zero", () => {
    expect(rnd(-2.5)).toBe(-3);
    expect(rnd(2.5)).toBe(3);
    expect(rndDiv(-5n, 2n)).toBe(-3n);
    expect(rndDiv(5n, 2n)).toBe(3n);
    expect(rndDiv(4n, 3n)).toBe(1n);
  });

  it("0.25 h at 4401¢ costs 1,100 off and 1,760 on", () => {
    const p = phase("X", "current", 0, 10, 0, 0, [{ membershipId: "KL", hours: 0.25, rateCents: 4401 }]);
    expect(snapshotPhase(p, OH, false).costCents).toBe(1100);
    expect(snapshotPhase(p, OH, true).costCents).toBe(1760);
  });
});

describe("F2, overhead off", () => {
  const v = snapshotVariant(F2(), OH, false);
  const by = (id: string) => v.phases.find((p) => p.id === id)!;

  it("phase and total labor cost", () => {
    expect(v.phases.map((p) => p.costCents)).toEqual([417_200, 1_144_600, 392_000, 0, 0, 0, 0]);
    expect(v.total.costCents).toBe(1_953_800);
  });

  it("profit to date", () => {
    expect([by("PD").profitCents, by("PD").profitNote]).toEqual([512_800, "55% margin"]);
    expect([by("SD").profitCents, by("SD").profitNote]).toEqual([1_645_400, "59% margin"]);
    expect([by("DD").profitCents, by("DD").profitNote]).toEqual([-392_000, "Work not billed yet"]);
    expect([by("CD").profitCents, by("CD").profitNote]).toEqual([null, "Not started"]);
    expect(v.total.profitCents).toBe(1_766_200);
  });

  it("projected profit", () => {
    expect([by("PD").projectedCents, by("PD").projectedNote]).toEqual([512_800, "55% margin · final"]);
    expect([by("SD").projectedCents, by("SD").projectedNote]).toEqual([1_645_400, "59% margin · final"]);
    expect([by("DD").projectedCents, by("DD").projectedNote]).toEqual([2_978_800, "64% margin"]);
    expect([by("CD").projectedCents, by("CD").projectedNote]).toEqual([4_340_000, "67% margin"]);
    expect([by("PRM").projectedCents, by("PRM").projectedNote]).toEqual([558_000, "60% margin"]);
    expect([by("CA").projectedCents, by("CA").projectedNote]).toEqual([1_562_400, "56% margin"]);
    expect([by("CO").projectedCents, by("CO").projectedNote]).toEqual([null, "No fee"]);
    expect([v.total.projectedCents, v.total.projectedNote]).toEqual([11_597_400, "62% margin"]);
  });

  it("totals", () => {
    expect(v.total).toMatchObject({ usedHours: 323, budgetHours: 1240, feeCents: 18_600_000, billedCents: 3_720_000 });
  });

  it("notes", () => {
    expect(by("SD").detailNote).toBe("Finished 15 h over budget. Those hours cost about $870 in profit.");
    expect(by("PD").detailNote).toBe("Finished within budget.");
    expect(by("DD").detailNote).toBe(
      "246 budget hours left. At the planned rate that's about $12,792 more labor before this phase is billed in full.",
    );
    expect(by("CD").detailNote).toBe("No time logged yet. Budget: 434 h at a planned $50 / h.");
  });
});

describe("F2, overhead on (60%)", () => {
  const v = snapshotVariant(F2(), OH, true);
  const by = (id: string) => v.phases.find((p) => p.id === id)!;

  it("cost with overhead", () => {
    expect(v.phases.slice(0, 3).map((p) => p.costCents)).toEqual([667_520, 1_831_360, 627_200]);
    expect(v.total.costCents).toBe(3_126_080);
  });

  it("profit to date", () => {
    expect([by("PD").profitCents, by("PD").profitNote]).toEqual([262_480, "28% margin"]);
    expect([by("SD").profitCents, by("SD").profitNote]).toEqual([958_640, "34% margin"]);
    expect(by("DD").profitCents).toBe(-627_200);
    expect(v.total.profitCents).toBe(593_920);
  });

  it("projected profit", () => {
    expect([by("DD").projectedCents, by("DD").projectedNote]).toEqual([1_976_080, "42% margin"]);
    expect([by("CD").projectedCents, by("CD").projectedNote]).toEqual([3_038_000, "47% margin"]);
    expect([by("PRM").projectedCents, by("PRM").projectedNote]).toEqual([334_800, "36% margin"]);
    expect([by("CA").projectedCents, by("CA").projectedNote]).toEqual([825_840, "30% margin"]);
    expect([v.total.projectedCents, v.total.projectedNote]).toEqual([7_395_840, "40% margin"]);
  });

  it("SD people: rates with overhead, costs add up to the phase", () => {
    const sd = by("SD");
    expect(sd.people.map((p) => [p.membershipId, p.hours, p.rateText, p.costCents])).toEqual([
      ["BM", 14, "$152 / h", 212_800],
      ["JR", 92, "$99.20 / h", 912_640],
      ["KL", 66, "$70.40 / h", 464_640],
      ["AP", 29, "$83.20 / h", 241_280],
    ]);
    expect(sd.people.reduce((n, p) => n + p.costCents, 0)).toBe(sd.costCents);
  });

  it("notes", () => {
    expect(by("SD").detailNote).toBe("Finished 15 h over budget. Those hours cost about $1,392 in profit.");
    expect(by("DD").detailNote).toContain("about $20,467 more cost");
    expect(by("CD").detailNote).toBe("No time logged yet. Budget: 434 h at a planned $80 / h with overhead.");
  });
});

describe("edge cases", () => {
  it("SD remaining is 0 though over budget, because it's complete", () => {
    expect(snapshotPhase(F2()[1], OH, false).remainingHours).toBe(0);
  });

  it("DD at 320 h, still current: remaining 0 and an over-budget note", () => {
    const dd = phase("DD", "current", 4_650_000, 310, 0, 5200, [...work({ BM: 4, JR: 50, KL: 10 }), { membershipId: "KL", hours: 256, rateCents: 4400 }]);
    const r = snapshotPhase(dd, OH, false);
    expect(r.remainingHours).toBe(0);
    expect(r.detailNote).toBe("10 h over budget and still in progress.");
  });

  it("an entry with no rate counts hours but no cost", () => {
    const dd = phase("DD", "current", 4_650_000, 310, 0, 5200, [...work({ BM: 4, JR: 50, KL: 10 }), { membershipId: "XX", hours: 2, rateCents: null }]);
    const r = snapshotPhase(dd, OH, false);
    expect(r.usedHours).toBe(66);
    expect(r.costCents).toBe(392_000);
    expect(r.missingRateHours).toBe(2);
    expect(r.people.find((p) => p.membershipId === "XX")!.rateText).toBe("No rate");
    expect(snapshotVariant([dd], OH, false).missingRateHours).toBe(2);
  });

  it("two rates for one person show a blended rate", () => {
    const p = phase("X", "current", 0, 10, 0, 0, [
      { membershipId: "JR", hours: 2, rateCents: 6000 },
      { membershipId: "JR", hours: 2, rateCents: 6300 },
    ]);
    expect(snapshotPhase(p, OH, false).people[0].rateText).toBe("$61.50 / h (blended)");
  });

  it("an estimated planned rate says so", () => {
    const cd = { ...F2()[3], plannedEstimated: true };
    expect(snapshotPhase(cd, OH, false).detailNote).toBe("No time logged yet. Budget: 434 h at a planned $50 / h (estimated).");
  });
});

describe("planned rate", () => {
  it("from a phase's roles: hours-weighted cost rate", () => {
    // 30.25 h Principal at $95 + 194 h Designer at $44 → (287,375 + 853,600) / 224.25 = 5,088¢
    expect(plannedRateFromRoles([{ hours: 30.25, costCents: 9500 }, { hours: 194, costCents: 4400 }])).toBe(5088);
    expect(plannedRateFromRoles([])).toBeNull();
    expect(plannedRateFromRoles([{ hours: 0, costCents: 9500 }])).toBeNull();
  });

  it("firm average: weighted by people, ignoring roles with no cost", () => {
    expect(firmAverageCostRate([{ costCents: 9500, people: 1 }, { costCents: 4400, people: 3 }, { costCents: 0, people: 2 }])).toBe(5675);
    expect(firmAverageCostRate([{ costCents: 9500, people: 0 }, { costCents: 4400, people: 0 }])).toBe(6950);
    expect(firmAverageCostRate([])).toBe(0);
  });
});

describe("text", () => {
  it("money, overhead and footer", () => {
    expect(moneyText(667_520)).toBe("$6,675.20");
    expect(moneyText(417_200)).toBe("$4,172");
    expect(moneyText(-392_000)).toBe("−$3,920");
    expect(overheadPct(6000)).toBe("60%");
    expect(overheadPct(1250)).toBe("12.5%");
    expect(snapshotFooter(6000, true)).toContain("× 1.60 (labor plus 60% overhead");
    expect(snapshotFooter(6000, false)).toMatch(/^Labor cost = hours/);
  });
});
