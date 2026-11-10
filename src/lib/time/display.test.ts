import { describe, expect, it } from "vitest";
import { dayHeader, returnedLine, statusView, weekMetaLine, weekRange } from "./display";

// Timesheet spec, Layout 1 and States → Status states (decisions #22, #23).

const base = {
  status: null,
  dueLabel: "Mon Oct 19, 9:00 AM",
  timezone: "America/New_York",
  submittedAt: null,
  waitingOn: null,
  routeAhead: null,
  lastApprovedBy: null,
  lastApprovedAt: null,
  autoApproved: false,
  approvedAt: null,
  approvedBy: null,
} as const;

describe("week labels", () => {
  it("meta line (shown in caps)", () => {
    expect(weekMetaLine("2026-10-12", "Mon Oct 19, 9:00 AM")).toBe("Week of Oct 12 – Oct 18, 2026 · Due Mon Oct 19, 9:00 AM");
    expect(weekMetaLine("2026-12-28", "Mon Jan 4, 9:00 AM")).toBe("Week of Dec 28, 2026 – Jan 3, 2027 · Due Mon Jan 4, 9:00 AM");
  });

  it("history range and day headers", () => {
    expect(weekRange("2026-10-12")).toBe("Oct 12 – Oct 18, 2026");
    expect(dayHeader("2026-10-12")).toEqual({ dow: "Mon", date: "Oct 12" });
  });
});

describe("status", () => {
  it("draft or no timesheet", () => {
    expect(statusView(base)).toMatchObject({ label: "Draft", note: "Not submitted yet. Due Mon Oct 19 at 9:00 AM." });
  });

  it("in review, nobody has approved yet", () => {
    expect(
      statusView({ ...base, status: "submitted", submittedAt: "2026-10-19T12:12:00Z", waitingOn: "JR", routeAhead: "JR, then BM" }),
    ).toMatchObject({
      label: "With JR",
      note: "Submitted Oct 19, 8:12 AM. Route: JR, then BM. You can recall it until someone approves.",
    });
    expect(statusView({ ...base, status: "submitted", waitingOn: "a principal" }).label).toBe("With a principal");
  });

  it("after a step is approved", () => {
    expect(
      statusView({
        ...base,
        status: "submitted",
        waitingOn: "BM, PD",
        lastApprovedBy: "JR",
        lastApprovedAt: "2026-10-19T18:00:00Z",
      }),
    ).toMatchObject({ label: "With BM, PD", note: "JR approved Oct 19. Waiting on BM, PD." });
  });

  it("a principal's own sheet, approved on submit", () => {
    expect(statusView({ ...base, status: "approved", approvedAt: "2026-10-19T15:00:00Z", autoApproved: true }).note).toBe(
      "Approved when you submitted, Oct 19. Locked.",
    );
  });

  it("approved and returned", () => {
    expect(statusView({ ...base, status: "approved", approvedAt: "2026-10-20T15:00:00Z", approvedBy: "BM" }).note).toBe(
      "Approved Oct 20 by BM. Locked.",
    );
    expect(statusView({ ...base, status: "rejected" })).toMatchObject({ label: "Returned", note: "Returned. Fix and resubmit." });
    expect(returnedLine("JR", "2026-10-20T15:00:00Z", "Move Tue to Permitting", "America/New_York")).toBe(
      'Returned by JR on Oct 20: "Move Tue to Permitting"',
    );
  });
});
