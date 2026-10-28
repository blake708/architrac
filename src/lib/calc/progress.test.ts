import { describe, expect, it } from "vitest";
import { progressStatus } from "./progress";

describe("progressStatus", () => {
  it("is normal below 90%", () => {
    expect(progressStatus(45, 100)).toEqual({
      percent: 45,
      fillPercent: 45,
      tone: "normal",
    });
    expect(progressStatus(89.9, 100).tone).toBe("normal");
  });

  it("warns at exactly 90% and up to 100%", () => {
    expect(progressStatus(90, 100).tone).toBe("warning");
    expect(progressStatus(100, 100).tone).toBe("warning");
  });

  it("is over above 100% and caps the bar width", () => {
    const s = progressStatus(130, 100);
    expect(s.tone).toBe("over");
    expect(s.percent).toBe(130);
    expect(s.fillPercent).toBe(100);
  });

  it("treats a tiny overrun as over even when it rounds to 100%", () => {
    const s = progressStatus(100.2, 100);
    expect(s.percent).toBe(100);
    expect(s.tone).toBe("over");
  });

  it("handles a zero budget", () => {
    expect(progressStatus(0, 0).tone).toBe("normal");
    expect(progressStatus(3, 0).tone).toBe("over");
  });

  it("treats negative usage as zero", () => {
    expect(progressStatus(-5, 100).percent).toBe(0);
  });
});
