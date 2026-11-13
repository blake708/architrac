import { describe, expect, it } from "vitest";
import { hourlyCostCents, resolveRate } from "./pay";
import { bpToPercent, percentToBp } from "@/lib/team/pay";

describe("hourlyCostCents", () => {
  it("salary ÷ (weekly hours × 52) × (1 + burden), rounded to the cent", () => {
    // $70,200 / 2,080 h = $33.75; × 1.25 = $42.1875 → $42.19
    expect(hourlyCostCents({ payType: "salary", amountCents: 7_020_000, burdenBp: 2500 }, 40)).toBe(4219);
    // No burden: $104,000 / 2,080 = $50.00
    expect(hourlyCostCents({ payType: "salary", amountCents: 10_400_000, burdenBp: 0 }, 40)).toBe(5000);
  });

  it("uses the person's weekly hours, so part-time salaries cost more per hour of capacity", () => {
    // $52,000 / (20 × 52 = 1,040 h) = $50.00
    expect(hourlyCostCents({ payType: "salary", amountCents: 5_200_000, burdenBp: 0 }, 20)).toBe(5000);
    // Quarter hours: $78,000 / (37.5 × 52 = 1,950 h) = $40.00
    expect(hourlyCostCents({ payType: "salary", amountCents: 7_800_000, burdenBp: 0 }, 37.5)).toBe(4000);
  });

  it("hourly: wage × (1 + burden)", () => {
    expect(hourlyCostCents({ payType: "hourly", amountCents: 1850, burdenBp: 1000 }, 40)).toBe(2035);
    // Weekly hours don't matter for hourly pay.
    expect(hourlyCostCents({ payType: "hourly", amountCents: 2000, burdenBp: 0 }, 0)).toBe(2000);
  });

  it("rounds half up", () => {
    // $10.01 × 1.05 = $10.5105 → 1051; $10.10 × 1.05 = 1060.5 → 1061
    expect(hourlyCostCents({ payType: "hourly", amountCents: 1001, burdenBp: 500 }, 40)).toBe(1051);
    expect(hourlyCostCents({ payType: "hourly", amountCents: 1010, burdenBp: 500 }, 40)).toBe(1061);
  });

  it("a salary with no weekly hours has no hourly cost", () => {
    expect(hourlyCostCents({ payType: "salary", amountCents: 5_000_000, burdenBp: 0 }, 0)).toBeNull();
  });
});

describe("resolveRate", () => {
  const forever = { effectiveFrom: "2026-01-01", effectiveTo: null };
  const pm = [{ ...forever, billRateCents: 15000, costRateCents: 6200 }];
  const designer = [{ ...forever, billRateCents: 11500, costRateCents: 4400 }];
  // $104,000 salary, 25% burden, 40 h → $62.50 cost
  const pmPay = [{ ...forever, payType: "salary" as const, amountCents: 10_400_000, burdenBp: 2500 }];
  const base = { personRates: [], roleRates: pm, pay: [], weeklyHours: 40 };

  it("with no pay and no project: their role's bill and cost (unchanged from before)", () => {
    expect(resolveRate(base, "2026-11-02")).toEqual({ billRateCents: 15000, costRateCents: 6200 });
  });

  it("pay replaces the role's cost rate", () => {
    expect(resolveRate({ ...base, pay: pmPay }, "2026-11-02")).toEqual({ billRateCents: 15000, costRateCents: 6250 });
  });

  it("a PM helping as Designer bills at the Designer rate but costs their own pay", () => {
    expect(resolveRate({ ...base, pay: pmPay, projectRoleRates: designer }, "2026-11-02")).toEqual({
      billRateCents: 11500,
      costRateCents: 6250,
    });
    // Without pay, cost is still their own role's, not the project role's.
    expect(resolveRate({ ...base, projectRoleRates: designer }, "2026-11-02")?.costRateCents).toBe(6200);
  });

  it("the project's bill override wins over any role", () => {
    expect(
      resolveRate({ ...base, projectRoleRates: designer, projectBillOverrideCents: 13000 }, "2026-11-02")?.billRateCents,
    ).toBe(13000);
  });

  it("pay is effective-dated: a raise applies from its start date", () => {
    const raise = [
      { effectiveFrom: "2026-01-01", effectiveTo: "2026-10-31", payType: "hourly" as const, amountCents: 3000, burdenBp: 0 },
      { effectiveFrom: "2026-11-01", effectiveTo: null, payType: "hourly" as const, amountCents: 3300, burdenBp: 0 },
    ];
    expect(resolveRate({ ...base, pay: raise }, "2026-10-31")?.costRateCents).toBe(3000);
    expect(resolveRate({ ...base, pay: raise }, "2026-11-01")?.costRateCents).toBe(3300);
    // Before any pay: the role's cost.
    expect(resolveRate({ ...base, pay: raise.slice(1) }, "2026-10-31")?.costRateCents).toBe(6200);
  });

  it("falls back to their own role when the project role has no rate that day", () => {
    const later = [{ effectiveFrom: "2026-12-01", effectiveTo: null, billRateCents: 11500, costRateCents: 4400 }];
    expect(resolveRate({ ...base, projectRoleRates: later }, "2026-11-02")?.billRateCents).toBe(15000);
  });

  it("null when there's no bill rate or no cost", () => {
    expect(resolveRate({ ...base, roleRates: [] }, "2026-11-02")).toBeNull();
    // Pay alone isn't enough: nothing says what to bill.
    expect(resolveRate({ ...base, roleRates: [], pay: pmPay }, "2026-11-02")).toBeNull();
    // A project role gives the bill rate; pay gives the cost.
    expect(resolveRate({ ...base, roleRates: [], pay: pmPay, projectRoleRates: designer }, "2026-11-02")).toEqual({
      billRateCents: 11500,
      costRateCents: 6250,
    });
  });
});

describe("percentToBp / bpToPercent", () => {
  it("reads percents with up to 2 decimals", () => {
    expect(percentToBp("25")).toBe(2500);
    expect(percentToBp("22.5%")).toBe(2250);
    expect(percentToBp("7.65")).toBe(765);
    expect(percentToBp("")).toBe(0);
    expect(percentToBp("1.234")).toBeNull();
    expect(percentToBp("abc")).toBeNull();
    expect(bpToPercent(2250)).toBe("22.5");
  });
});
