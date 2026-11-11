import { describe, expect, it } from "vitest";
import { NOTICES, relativeTime, unreadBadge, weekSpan } from "./notices";

describe("notification words", () => {
  it("week spans", () => {
    expect(weekSpan("2026-10-12")).toBe("Oct 12 – 18");
    expect(weekSpan("2026-10-26")).toBe("Oct 26 – Nov 1");
  });

  it("each notice", () => {
    expect(NOTICES.reviewWaiting("Kat Lee", "2026-10-12", 40)).toEqual({
      title: "Kat Lee's timesheet is waiting for you",
      body: "Week of Oct 12 – 18 · 40 h",
    });
    expect(NOTICES.approvedForYou("MW", "KL", "2026-10-12").title).toBe("MW approved KL's timesheet for you (week of Oct 12).");
    expect(NOTICES.returned("2026-10-12", "Split SD").title).toBe("Your timesheet for Oct 12 – 18 was returned");
    expect(NOTICES.reminder("2026-10-12", true, 24)).toEqual({
      title: "Your timesheet for Oct 12 – 18 is overdue",
      body: "You've logged 24 h so far.",
    });
    expect(NOTICES.reminder("2026-10-12", false, 0).title).toBe("Your timesheet for Oct 12 – 18 is due");
    expect(NOTICES.waitingCount(5).title).toBe("You have 5 timesheets waiting for approval");
    expect(NOTICES.waitingCount(1).title).toBe("You have 1 timesheet waiting for approval");
  });

  it("relative time and the bell badge", () => {
    const now = new Date("2026-10-19T14:00:00Z");
    expect(relativeTime("2026-10-19T13:59:40Z", now)).toBe("Just now");
    expect(relativeTime("2026-10-19T12:00:00Z", now)).toBe("2 h ago");
    expect(relativeTime("2026-10-17T14:00:00Z", now)).toBe("2 d ago");
    expect(unreadBadge(0)).toBeNull();
    expect(unreadBadge(3)).toBe("3");
    expect(unreadBadge(12)).toBe("9+");
  });
});
