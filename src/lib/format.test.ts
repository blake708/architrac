import { describe, expect, it } from "vitest";
import { formatMonthDay } from "./format";

describe("formatMonthDay", () => {
  it('formats "Oct 20" in the firm\'s time zone', () => {
    // 02:00 UTC on Oct 21 is still Oct 20 in Charleston.
    const d = new Date("2026-10-21T02:00:00Z");
    expect(formatMonthDay(d, "America/New_York")).toBe("Oct 20");
    expect(formatMonthDay(d, "UTC")).toBe("Oct 21");
  });
});
