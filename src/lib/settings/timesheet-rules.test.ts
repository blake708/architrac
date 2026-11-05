import { describe, expect, it } from "vitest";
import { DUE_TIMES, dueDayOptions, dueExample, timeLabel, timesheetRulesSchema } from "./timesheet-rules";

describe("timesheet rules (decisions #17, #21)", () => {
  it("lists due days from Friday for a Monday week, marking next week's", () => {
    expect(dueDayOptions(1).map((o) => o.label)).toEqual([
      "Friday",
      "Saturday",
      "Sunday",
      "Monday (following week)",
      "Tuesday (following week)",
      "Wednesday (following week)",
      "Thursday (following week)",
    ]);
    expect(dueDayOptions(1)[3].value).toBe(1);
    expect(dueDayOptions(0)[0]).toEqual({ value: 4, label: "Thursday" });
  });

  it("offers every half hour with readable labels", () => {
    expect(DUE_TIMES).toHaveLength(48);
    expect(DUE_TIMES[18]).toEqual({ value: "09:00", label: "9:00 AM" });
    expect(timeLabel("00:30")).toBe("12:30 AM");
    expect(timeLabel("17:00")).toBe("5:00 PM");
  });

  it("accepts only half-hour times and days 0–6", () => {
    const ok = { lockDay: 1, dueTime: "09:00", billableNotesRequired: false };
    expect(timesheetRulesSchema.safeParse(ok).success).toBe(true);
    expect(timesheetRulesSchema.safeParse({ ...ok, dueTime: "09:15" }).success).toBe(false);
    expect(timesheetRulesSchema.safeParse({ ...ok, dueTime: "24:00" }).success).toBe(false);
    expect(timesheetRulesSchema.safeParse({ ...ok, lockDay: 7 }).success).toBe(false);
  });

  it("shows an example due date", () => {
    expect(dueExample("2026-10-12", { lockDay: 1, dueTime: "09:00" })).toBe("The week of Oct 12 – Oct 18, 2026 is due Mon Oct 19 at 9:00 AM.");
    expect(dueExample("2026-10-12", { lockDay: 5, dueTime: "17:00" })).toBe("The week of Oct 12 – Oct 18, 2026 is due Fri Oct 16 at 5:00 PM.");
  });
});
