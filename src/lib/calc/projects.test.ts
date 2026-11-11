import { describe, expect, it } from "vitest";
import {
  type PhaseFacts,
  billedPct,
  distributeFee,
  distributeHours,
  hoursFromFee,
  planPhaseFees,
  nextProjectNumber,
  phaseText,
  projectBilled,
  projectFee,
  projectHealth,
} from "./projects";

// Examples from docs/specs/release-1/projects-list.md (MOB = Medical Office Building).

const SHARES = [500, 1500, 2500, 3500, 500, 1500, 0];
const CODES = ["PD", "SD", "DD", "CD", "PERM", "CA", "CO"];
const rows = (amounts: number[] = []) =>
  CODES.map((id, i) => ({ id, weightBp: SHARES[i], amount: amounts[i] ?? 0 }));
const values = (r: ReturnType<typeof distributeFee>) => {
  if (!r.ok) throw new Error("expected ok");
  return CODES.filter((c) => c in r.amounts).map((c) => r.amounts[c]);
};

const phase = (p: Partial<PhaseFacts> & { id: string }): PhaseFacts => ({
  name: p.id,
  sortOrder: 1,
  status: "upcoming",
  feeType: "fixed",
  feeCents: 0,
  budgetHours: 0,
  ...p,
});

const MOB: PhaseFacts[] = [
  phase({ id: "PD", name: "Pre-Design", sortOrder: 1, status: "complete", feeCents: 930_000, budgetHours: 62 }),
  phase({ id: "SD", name: "Schematic Design", sortOrder: 2, status: "complete", feeCents: 2_790_000, budgetHours: 186 }),
  phase({ id: "DD", name: "Design Development", sortOrder: 3, status: "current", feeCents: 4_650_000, budgetHours: 310 }),
  phase({ id: "CD", name: "Construction Documents", sortOrder: 4, feeCents: 6_510_000, budgetHours: 434 }),
  phase({ id: "PERM", name: "Permitting", sortOrder: 5, feeCents: 930_000, budgetHours: 62 }),
  phase({ id: "CA", name: "Construction Administration", sortOrder: 6, feeCents: 2_790_000, budgetHours: 186 }),
  phase({ id: "CO", name: "Close Out", sortOrder: 7, feeCents: 0, budgetHours: 0 }),
];

describe("rule 1: project fee", () => {
  it("MOB is $186,000", () => expect(projectFee(MOB)).toBe(18_600_000));
});

describe("rule 2: billed", () => {
  const sent = (id: string, amount: number, lineType: "phase_fee" | "hourly" = "phase_fee") => ({
    invoiceStatus: "paid" as const,
    projectPhaseId: id,
    lineType,
    amountCents: amount,
  });
  it("MOB: three sent invoices, the draft is left out", () => {
    const lines = [
      sent("PD", 930_000),
      sent("SD", 1_674_000),
      sent("SD", 1_116_000),
      { ...sent("DD", 1_395_000), invoiceStatus: "draft" as const },
      { ...sent("DD", 50_000), lineType: "consultant" as const },
    ];
    const billed = projectBilled(MOB, lines);
    expect(billed).toBe(3_720_000);
    expect(billedPct(billed, projectFee(MOB))).toBe(20);
  });
  it("hourly phases count hourly lines, not phase-fee lines", () => {
    const p = [phase({ id: "H", feeType: "hourly" })];
    expect(projectBilled(p, [sent("H", 100, "hourly"), sent("H", 7)])).toBe(100);
  });
  it("no fee → no percent; rounds half up", () => {
    expect(billedPct(0, 0)).toBeNull();
    expect(billedPct(1, 8)).toBe(13); // 12.5 → 13
    expect(billedPct(3_720_000, 22_700_000)).toBe(16);
  });
});

describe("rule 3: health (open phases only)", () => {
  const used = (o: Record<string, number>) => new Map(Object.entries(o));
  it("MOB: SD finished over budget, but only open phases count → on track", () => {
    expect(projectHealth("active", MOB, used({ PD: 58, SD: 201, DD: 64 }))).toBe("on_track");
  });
  it("a current phase at 90% → at risk; past 100% → over budget", () => {
    expect(projectHealth("active", MOB, used({ DD: 279 }))).toBe("at_risk");
    expect(projectHealth("active", MOB, used({ DD: 278.75 }))).toBe("on_track");
    expect(projectHealth("active", MOB, used({ DD: 311 }))).toBe("over_budget");
  });
  it("the whole project past its total budget → over budget", () => {
    expect(projectHealth("active", MOB, used({ PD: 600, SD: 700 }))).toBe("over_budget");
  });
  it("time on a phase with no budget → over budget", () => {
    expect(projectHealth("active", [phase({ id: "X", status: "current" })], used({ X: 1 }))).toBe("over_budget");
  });
  it("not active → its status", () => {
    expect(projectHealth("on_hold", MOB, used({}))).toBe("on_hold");
    expect(projectHealth("closed", MOB, used({}))).toBe("closed");
    expect(projectHealth("pursuit", MOB, used({}))).toBe("pursuit");
  });
});

describe("rule 4: phase text", () => {
  it("current phase name", () => expect(phaseText("active", MOB)).toBe("Design Development"));
  it("closed and pursuit", () => {
    expect(phaseText("closed", MOB)).toBe("Closed out");
    expect(phaseText("pursuit", MOB)).toBe("Pursuit · not started");
  });
  it("none current", () => {
    const upcoming = MOB.map((p) => ({ ...p, status: "upcoming" as const }));
    const done = MOB.map((p) => ({ ...p, status: "complete" as const }));
    expect(phaseText("active", upcoming)).toBe("Not started");
    expect(phaseText("active", done)).toBe("All phases complete");
    expect(phaseText("on_hold", MOB)).toBe("On hold · Design Development");
  });
});

describe("rule 5: next number in the firm's format (decision #28)", () => {
  it("{YYYY}-{###} (the default): one past the highest this year", () => {
    const f = "{YYYY}-{###}";
    expect(nextProjectNumber(["2026-014", "2026-022", "2025-104", "2026-9x"], f, 2026)).toBe("2026-023");
    expect(nextProjectNumber(["2025-104"], f, 2026)).toBe("2026-001");
    expect(nextProjectNumber(["2026-1000"], f, 2026)).toBe("2026-1001");
  });

  it("{YY}{###} (TMG): 26030 → 26031, and 27001 in a new year", () => {
    const f = "{YY}{###}";
    expect(nextProjectNumber(["26029", "26030", "25104"], f, 2026)).toBe("26031");
    expect(nextProjectNumber(["26029", "26030"], f, 2027)).toBe("27001");
  });

  it("no year code: the counter keeps counting", () => {
    expect(nextProjectNumber(["P0411", "p0007", "2026-001"], "P{####}", 2026)).toBe("P0412");
    expect(nextProjectNumber(["P0411"], "P{####}", 2030)).toBe("P0412");
  });

  it("numbers in another format are ignored", () => {
    expect(nextProjectNumber(["2026-014", "2026-022"], "{YY}{###}", 2026)).toBe("26001");
  });
});

describe("rule 6: fee split", () => {
  it("A: MOB, no edits, exact", () => {
    expect(values(distributeFee(18_600_000, rows(), new Set()))).toEqual([
      930_000, 2_790_000, 4_650_000, 6_510_000, 930_000, 2_790_000, 0,
    ]);
  });
  it("B: the leftover cent goes to CD", () => {
    const v = values(distributeFee(100_001, rows(), new Set()));
    expect(v).toEqual([5_000, 15_000, 25_000, 35_001, 5_000, 15_000, 0]);
    expect(v.reduce((a, b) => a + b)).toBe(100_001);
  });
  it("C: CA edited to $20,000", () => {
    const amounts = [0, 0, 0, 0, 0, 2_000_000, 0];
    const v = values(distributeFee(18_600_000, rows(amounts), new Set(["CA"])));
    expect(v).toEqual([976_470, 2_929_411, 4_882_352, 6_835_297, 976_470, 2_000_000, 0]);
    expect(v.reduce((a, b) => a + b)).toBe(18_600_000);
  });
  it("edits over the total are refused", () => {
    const r = distributeFee(100, rows([0, 0, 0, 0, 0, 101, 0]), new Set(["CA"]));
    expect(r).toEqual({ ok: false, error: "edited_over_total", editedSum: 101 });
  });
  it("every row edited: nothing is redistributed", () => {
    const all = new Set(CODES);
    const r = distributeFee(100, rows([10, 10, 10, 10, 10, 10, 10]), all);
    expect(values(r).reduce((a, b) => a + b)).toBe(70);
  });
  it("all weights 0 → equal split, leftover to the first", () => {
    const r = distributeFee(10, [
      { id: "a", weightBp: 0, amount: 0 },
      { id: "b", weightBp: 0, amount: 0 },
      { id: "c", weightBp: 0, amount: 0 },
    ], new Set());
    expect(r).toEqual({ ok: true, amounts: { a: 4, b: 3, c: 3 } });
  });
  it("big fees don't lose precision", () => {
    const r = distributeFee(99_999_999_999_99, rows(), new Set());
    expect(values(r).reduce((a, b) => a + b)).toBe(99_999_999_999_99);
  });
});

describe("rule 7: hours split in quarter hours", () => {
  it("MOB 1,240 h", () => {
    expect(values(distributeHours(1240, rows(), new Set()))).toEqual([62, 186, 310, 434, 62, 186, 0]);
  });
  it("remainders stay on quarter hours", () => {
    const v = values(distributeHours(10, rows(), new Set()));
    for (const h of v) expect(h * 4).toBe(Math.round(h * 4));
    expect(v.reduce((a, b) => a + b)).toBe(10);
  });
});

describe("phase fees from shares (Blake, 2026-11-03)", () => {
  const plan = (edits: Record<string, import("./projects").PhaseEdit> = {}, over: Partial<Record<string, Partial<import("./projects").PlanRow>>> = {}) =>
    CODES.map((id, i) => ({ id, include: true, feeType: "fixed" as const, weightBp: SHARES[i], edit: edits[id] ?? null, ...over[id] }));

  it("no edits: the template split, shares add to 100%", () => {
    const p = planPhaseFees(18_600_000, plan());
    expect(CODES.map((c) => p.fees[c])).toEqual([930_000, 2_790_000, 4_650_000, 6_510_000, 930_000, 2_790_000, 0]);
    expect(CODES.map((c) => p.shares[c])).toEqual(SHARES);
    expect(p.sumCents).toBe(18_600_000);
  });

  it("a % edit sets that phase; the others rebalance to 100%", () => {
    const p = planPhaseFees(18_600_000, plan({ CA: { kind: "pct", bp: 2000 } }));
    expect(p.fees.CA).toBe(3_720_000);
    expect(p.shares.CA).toBe(2000);
    expect(p.sumCents).toBe(18_600_000);
  });

  it("a fee edit shows its new %", () => {
    const p = planPhaseFees(18_600_000, plan({ CA: { kind: "fee", cents: 2_000_000 } }));
    expect(p.fees.CA).toBe(2_000_000);
    expect(p.shares.CA).toBe(1075); // 10.75%
    expect(p.fees.CD).toBe(6_835_297); // example C
  });

  it("a % edit follows the total; a fee edit keeps its dollars", () => {
    const p = planPhaseFees(10_000_000, plan({ PD: { kind: "pct", bp: 1000 }, SD: { kind: "fee", cents: 500_000 } }));
    expect(p.fees.PD).toBe(1_000_000);
    expect(p.fees.SD).toBe(500_000);
    expect(p.sumCents).toBe(10_000_000);
  });

  it("unchecked and hourly phases are 0% and $0; the rest still make 100%", () => {
    const p = planPhaseFees(18_600_000, plan({}, { PD: { include: false }, SD: { feeType: "hourly" } }));
    expect([p.fees.PD, p.shares.PD, p.fees.SD, p.shares.SD]).toEqual([0, 0, 0, 0]);
    expect(p.sumCents).toBe(18_600_000);
  });

  it("edits past the total are flagged", () => {
    const p = planPhaseFees(100, plan({ CA: { kind: "pct", bp: 15000 } }));
    expect(p.over).toBe(true);
    expect(p.fees.CA).toBe(150);
  });

  it("no total: everything is $0 and 0%", () => {
    const p = planPhaseFees(0, plan());
    expect(p.sumCents).toBe(0);
    expect(p.shares.CD).toBe(0);
  });
});

describe("hours from fee", () => {
  it("fee ÷ blended bill rate, to the quarter hour", () => {
    expect(hoursFromFee(2_790_000, 15_000)).toBe(186);
    expect(hoursFromFee(2_790_000, 12_583)).toBe(221.75); // 221.72 → 221.75
    expect(hoursFromFee(100, null)).toBeNull();
  });
});
