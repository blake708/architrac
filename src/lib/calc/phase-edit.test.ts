import { describe, expect, it } from "vitest";
import {
  type EditRow,
  type PhaseFacts,
  type RedistributePhase,
  EDIT_MESSAGES,
  completeWarnings,
  defaultLocks,
  mixHours,
  mixTotalBp,
  phaseEditProblems,
  redistribute,
} from "./phase-edit";

// Examples from docs/specs/release-1/project-detail.md, fixture F2 (MOB).

const ph = (id: string, feeCents: number, budgetHours: number, billedCents = 0, status: RedistributePhase["status"] = "upcoming", templateShareBp = 0): RedistributePhase => ({
  id,
  code: id,
  feeCents,
  budgetHours,
  billedCents,
  status,
  templateShareBp,
});
const MOB = [
  ph("PD", 930_000, 62, 930_000, "closed", 500),
  ph("SD", 2_790_000, 186, 2_790_000, "closed", 1500),
  ph("DD", 4_650_000, 310, 0, "current", 2500),
  ph("CD", 6_510_000, 434, 0, "upcoming", 3500),
  ph("PRM", 930_000, 62, 0, "upcoming", 500),
  ph("CA", 2_790_000, 186, 0, "upcoming", 1500),
  ph("CO", 0, 0, 0, "upcoming", 0),
];

describe("rule 6: redistribute", () => {
  it("default locks: billed, complete or closed", () => {
    expect([...defaultLocks(MOB)]).toEqual(["PD", "SD"]);
  });
  it("MOB → $200,000: exact, PD/SD unchanged", () => {
    const r = redistribute(MOB, 20_000_000, defaultLocks(MOB), null);
    if (!r.ok) throw new Error(r.error);
    expect(r.fees).toEqual({
      PD: 930_000,
      SD: 2_790_000,
      DD: 5_087_500,
      CD: 7_122_500,
      PRM: 1_017_500,
      CA: 3_052_500,
      CO: 0,
    });
    expect(Object.values(r.fees).reduce((a, b) => a + b)).toBe(20_000_000);
  });
  it("below the locked phases → refused", () => {
    expect(redistribute(MOB, 3_000_000, defaultLocks(MOB), null)).toEqual({ ok: false, error: "below_locked", lockedCents: 3_720_000 });
  });
  it("an unlocked phase can't drop below what it's billed", () => {
    const r = redistribute(MOB, 4_000_000, new Set(["PD"]), null);
    expect(r).toEqual({ ok: false, error: "below_billed", code: "SD", billedCents: 2_790_000 });
  });
  it("new total hours spread by current hours, in quarter hours", () => {
    const r = redistribute(MOB, 20_000_000, defaultLocks(MOB), 1340);
    if (!r.ok) throw new Error(r.error);
    expect(r.hours!.PD).toBe(62);
    expect(Object.values(r.hours!).reduce((a, b) => a + b)).toBe(1340);
    for (const h of Object.values(r.hours!)) expect(Number.isInteger(h * 4)).toBe(true);
  });
  it("all unlocked fees 0 → template shares; those 0 too → equal", () => {
    const zero = [ph("A", 0, 0, 0, "upcoming", 3000), ph("B", 0, 0, 0, "upcoming", 1000)];
    const r = redistribute(zero, 100_000, new Set(), null);
    expect(r.ok && r.fees).toEqual({ A: 75_000, B: 25_000 });
    const eq = redistribute([ph("A", 0, 0), ph("B", 0, 0)], 101, new Set(), null);
    expect(eq.ok && eq.fees).toEqual({ A: 51, B: 50 });
  });
});

describe("role mixes", () => {
  it("SD $27,900: 20% Principal $185, 30% PA $150, 50% Designer $115", () => {
    const rows = [
      { roleId: "P", shareBp: 2000, rateCents: 18_500 },
      { roleId: "PA", shareBp: 3000, rateCents: 15_000 },
      { roleId: "D", shareBp: 5000, rateCents: 11_500 },
    ];
    expect(mixTotalBp(rows)).toBe(10_000);
    const m = mixHours(2_790_000, rows);
    expect(m.roles.map((r) => [r.cents, r.hours])).toEqual([
      [558_000, 30.25], // 30.16 → 30.25
      [837_000, 55.75], // 55.8 → 55.75
      [1_395_000, 121.25], // 121.30 → 121.25
    ]);
    expect(m.total).toBe(207.25);
  });
  it("a role with no rate gets 0 hours and is flagged", () => {
    const m = mixHours(100_000, [{ roleId: "X", shareBp: 10_000, rateCents: 0 }]);
    expect(m.roles[0]).toMatchObject({ hours: 0, noRate: true });
  });
});

describe("rule 5: phase edit checks", () => {
  const row = (o: Partial<EditRow> = {}): EditRow => ({
    id: "SD",
    code: "SD",
    name: "Schematic Design",
    feeType: "fixed",
    feeCents: 2_790_000,
    budgetHours: 186,
    percentCompleteBp: 10_000,
    status: "closed",
    startDate: null,
    endDate: null,
    ...o,
  });
  const billed: Map<string, PhaseFacts> = new Map([
    ["SD", { feeType: "fixed", billedCents: 2_790_000, lastBilledPctBp: 10_000, hasInvoiceLines: true }],
    ["DD", { feeType: "fixed", billedCents: 0, lastBilledPctBp: 0, hasInvoiceLines: true }],
  ]);
  const money = (c: number) => `$${(c / 100).toLocaleString("en-US")}`;
  const check = (r: EditRow, more: EditRow[] = []) => phaseEditProblems([r, ...more], billed, money)[0] ?? {};

  it("SD fee $20,000 → below billed", () => {
    expect(check(row({ feeCents: 2_000_000 })).feeCents).toBe("Fee can't be less than the $27,900 already billed");
  });
  it("SD to 90% → already billed through 100%", () => {
    expect(check(row({ percentCompleteBp: 9000 })).percentCompleteBp).toBe("Already billed through 100%");
  });
  it("SD to hourly → fee type locked", () => {
    expect(check(row({ feeType: "hourly" })).feeType).toBe(EDIT_MESSAGES.feeTypeLocked);
  });
  it("DD to 20%: its only line is a draft, so allowed", () => {
    expect(check(row({ id: "DD", code: "DD", percentCompleteBp: 2000, feeCents: 4_650_000, status: "current" }))).toEqual({});
  });
  it("quarter hours, codes, names, NTE cap, dates", () => {
    expect(check(row({ id: null, budgetHours: 310.3 })).budgetHours).toBe("Use quarter hours");
    expect(phaseEditProblems([row({ id: null }), row({ id: null, code: "sd" })], billed, money)[1].code).toBe(EDIT_MESSAGES.codeTaken);
    expect(check(row({ id: null, name: " " })).name).toBe(EDIT_MESSAGES.name);
    expect(check(row({ id: null, feeType: "nte", feeCents: 0 })).feeCents).toBe(EDIT_MESSAGES.nteCap);
    expect(check(row({ id: null, startDate: "2026-12-01", endDate: "2026-11-01" })).endDate).toBe(EDIT_MESSAGES.dates);
  });
  it("complete at less than 100% warns", () => {
    expect(completeWarnings([row({ status: "complete", percentCompleteBp: 6000 })])).toEqual([
      { index: 0, text: "SD is complete at 60%. Set to 100%?" },
    ]);
  });
});
