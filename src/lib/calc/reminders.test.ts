import { describe, expect, it } from "vitest";
import { canSendAgain, cardSummary, dueAt, lastDueWeek, statusBadge } from "./reminders";

const NY = { timezone: "America/New_York", weekStartsOn: 1, lockDay: 1, dueTime: "09:00:00" };

describe("due weeks", () => {
  it("week of Oct 12 is due Mon Oct 19, 9:00 AM New York", () => {
    expect(dueAt("2026-10-12", NY).toISOString()).toBe("2026-10-19T13:00:00.000Z");
  });

  it("last due week flips at the due time", () => {
    expect(lastDueWeek(new Date("2026-10-19T12:59:00Z"), NY)).toBe("2026-10-05");
    expect(lastDueWeek(new Date("2026-10-19T13:05:00Z"), NY)).toBe("2026-10-12");
    expect(lastDueWeek(new Date("2026-10-23T18:00:00Z"), NY)).toBe("2026-10-12");
  });

  it("due Friday 5 PM: the week is due inside itself", () => {
    const fri = { ...NY, lockDay: 5, dueTime: "17:00" };
    expect(lastDueWeek(new Date("2026-10-16T22:00:00Z"), fri)).toBe("2026-10-12");
    expect(lastDueWeek(new Date("2026-10-16T20:00:00Z"), fri)).toBe("2026-10-05");
  });
});

describe("reminders", () => {
  it("one per 12 hours", () => {
    const now = new Date("2026-10-19T20:00:00Z");
    expect(canSendAgain(null, now)).toBe(true);
    expect(canSendAgain(new Date("2026-10-19T19:00:00Z"), now)).toBe(false);
    expect(canSendAgain(new Date("2026-10-19T08:00:00Z"), now)).toBe(true);
  });

  it("status badges (rule 7) and the card summary", () => {
    expect(statusBadge("not_submitted", { pastDue: true })).toEqual({ label: "Not submitted", tone: "orange", look: "diamond" });
    expect(statusBadge("draft", { pastDue: false }).tone).toBe("neutral");
    expect(statusBadge("waiting_on_others", { pastDue: true, waitingOn: "Jo Reyes" }).label).toBe("Waiting on Jo Reyes");
    expect(statusBadge("approved", { pastDue: true }).label).toBe("Approved");
    expect(cardSummary(["waiting_on_you", "waiting_on_you", "waiting_on_others", "not_submitted", "returned"])).toBe(
      "2 waiting on you · 1 with others · 2 not submitted",
    );
  });
});
