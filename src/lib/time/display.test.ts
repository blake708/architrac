import { describe, expect, it } from "vitest";
import { dayHeader, returnedLine, statusView, weekMetaLine, weekRange } from "./display";

// Timesheet spec, Layout 1 and States → Status states (decision #3 b).

const base = {
  status: null,
  dueLabel: "Mon Oct 19, 9:00 AM",
  timezone: "America/New_York",
  submittedAt: null,
  reviewer: null,
  leaderApprovedAt: null,
  leaderApprovedBy: null,
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

  it("with the team leader", () => {
    expect(statusView({ ...base, status: "submitted", submittedAt: "2026-10-19T12:12:00Z", reviewer: "JR" })).toMatchObject({
      label: "With team leader",
      note: "Submitted Oct 19, 8:12 AM to JR for review, then a principal approves. You can recall it until JR acts.",
    });
  });

  it("straight to a principal, and after the leader reviewed it", () => {
    expect(statusView({ ...base, status: "leader_approved", submittedAt: "2026-10-19T12:12:00Z" })).toMatchObject({
      label: "With principal",
      note: "Submitted Oct 19, 8:12 AM to a principal for approval. You can recall it until they act.",
    });
    expect(
      statusView({ ...base, status: "leader_approved", leaderApprovedAt: "2026-10-19T18:00:00Z", leaderApprovedBy: "JR" }),
    ).toMatchObject({ note: "JR reviewed it Oct 19. Waiting on a principal." });
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
