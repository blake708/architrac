import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatMoney,
  formatMoneyShort,
  formatMoneySigned,
  formatMonthDay,
  formatMultiplier,
  todayIn,
} from "./format";

describe("formatMonthDay", () => {
  it('formats "Oct 20" in the firm\'s time zone', () => {
    // 02:00 UTC on Oct 21 is still Oct 20 in Charleston.
    const d = new Date("2026-10-21T02:00:00Z");
    expect(formatMonthDay(d, "America/New_York")).toBe("Oct 20");
    expect(formatMonthDay(d, "UTC")).toBe("Oct 21");
  });
});

describe("formatMoney", () => {
  it("shows whole dollars by default", () => {
    expect(formatMoney(61_200_000)).toBe("$612,000");
    expect(formatMoney(12_583)).toBe("$126");
  });
  it("shows cents when asked", () => {
    expect(formatMoney(7040, { cents: true })).toBe("$70.40");
    expect(formatMoney(60, { cents: true })).toBe("$0.60");
  });
});

describe("formatMultiplier", () => {
  it("shows hundredths with ×", () => {
    expect(formatMultiplier(195)).toBe("1.95×");
    expect(formatMultiplier(250)).toBe("2.50×");
  });
  it("shows a dash when there's no multiplier", () => {
    expect(formatMultiplier(null)).toBe("—");
  });
});

describe("formatDate", () => {
  it('formats a stored date as "Jan 1, 2026"', () => {
    expect(formatDate("2026-01-01")).toBe("Jan 1, 2026");
    expect(formatDate("2026-11-01")).toBe("Nov 1, 2026");
  });
});

describe("todayIn", () => {
  it("uses the firm's time zone", () => {
    const d = new Date("2026-11-01T02:00:00Z");
    expect(todayIn("America/New_York", d)).toBe("2026-10-31");
    expect(todayIn("UTC", d)).toBe("2026-11-01");
  });
});

describe("formatMoneyShort (projects-list, Constr. est.)", () => {
  it("millions with one decimal, thousands whole", () => {
    expect(formatMoneyShort(620_000_000)).toBe("$6.2M");
    expect(formatMoneyShort(64_000_000)).toBe("$640k");
    expect(formatMoneyShort(50_000)).toBe("$1k"); // $500 rounds half up
    expect(formatMoneyShort(99_960_000)).toBe("$1.0M"); // $999.6k doesn't read "$1000k"
    expect(formatMoneyShort(null)).toBe("—");
  });
  it("signed money uses a real minus", () => {
    expect(formatMoneySigned(-120_000)).toBe("−$1,200");
    expect(formatMoneySigned(120_000)).toBe("$1,200");
  });
});
