import { describe, expect, it } from "vitest";
import { progressStatus } from "./progress";

describe("progressStatus", () => {
  it("is normal below 90%", () => {
    expect(progressStatus(45, 100)).toEqual({
      percent: 45,
      fillWidth: 45,
      overWidth: 0,
      tone: "normal",
    });
    expect(progressStatus(89.9, 100).tone).toBe("normal");
  });

  it("warns at exactly 90% and up to 100%", () => {
    expect(progressStatus(90, 100).tone).toBe("warning");
    expect(progressStatus(100, 100)).toEqual({
      percent: 100,
      fillWidth: 100,
      overWidth: 0,
      tone: "warning",
    });
  });

  it("splits the bar into budget and overrun when over", () => {
    // 125 used of 100: budget is 80% of the bar, overrun the other 20%.
    expect(progressStatus(125, 100)).toEqual({
      percent: 125,
      fillWidth: 80,
      overWidth: 20,
      tone: "over",
    });
  });

  it("treats a tiny overrun as over even when it rounds to 100%", () => {
    const s = progressStatus(100.2, 100);
    expect(s.percent).toBe(100);
    expect(s.tone).toBe("over");
    expect(s.overWidth).toBeGreaterThan(0);
  });

  it("handles a zero budget", () => {
    expect(progressStatus(0, 0).tone).toBe("normal");
    expect(progressStatus(3, 0)).toEqual({
      percent: 100,
      fillWidth: 0,
      overWidth: 100,
      tone: "over",
    });
  });

  it("treats negative usage as zero", () => {
    expect(progressStatus(-5, 100).percent).toBe(0);
  });
});
