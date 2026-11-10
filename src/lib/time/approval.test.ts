import { describe, expect, it } from "vitest";
import {
  APPROVAL_MESSAGES,
  type ChipRow,
  approveCleanLabel,
  bulkMessage,
  dayTimeLabel,
  historyLine,
  onBehalfNoteProblem,
  returnNoteProblem,
  reviewChips,
  shortWeekRange,
} from "./approval";

describe("return note", () => {
  it("required, trimmed, at most 1000 characters", () => {
    expect(returnNoteProblem("   ", "KL")).toBe("Add a note so KL knows what to change.");
    expect(returnNoteProblem("x".repeat(1001), "KL")).toBe("Notes can be up to 1000 characters.");
    expect(returnNoteProblem(` ${"x".repeat(1000)} `, "KL")).toBeNull();
  });

  it("approve-for note is optional", () => {
    expect(onBehalfNoteProblem(undefined)).toBeNull();
    expect(onBehalfNoteProblem("x".repeat(1001))).toBe(APPROVAL_MESSAGES.noteTooLong);
  });
});

describe("bulk approve messages", () => {
  it("Approved 2. 1 not approved: KL has no rate on Oct 14.", () => {
    expect(bulkMessage(4, [])).toBe("Approved 4.");
    expect(
      bulkMessage(2, [{ initials: "KL", error: "No rate for KL on Oct 14. Add one in Settings → Roles & rates." }]),
    ).toBe("Approved 2. 1 not approved: KL has no rate on Oct 14.");
    expect(bulkMessage(0, [{ initials: "DS", error: APPROVAL_MESSAGES.notWaiting }])).toBe(
      "Approved 0. 1 not approved: DS: This timesheet is no longer waiting for you.",
    );
  });

  it("approve-clean label", () => {
    expect(approveCleanLabel(4)).toBe("Approve 4 with no flags");
    expect(approveCleanLabel(0)).toBe("All clean timesheets approved");
  });
});

const TZ = "America/New_York";
const chip = (over: Partial<ChipRow>): ChipRow => ({
  stepNo: 1,
  kind: "principal_in_charge",
  status: "waiting",
  skipReason: null,
  approver: null,
  actedBy: null,
  actedAt: null,
  onBehalf: false,
  ...over,
});

describe("labels", () => {
  it("week ranges and submitted time", () => {
    expect(shortWeekRange("2026-10-12")).toBe("Week of Oct 12 – 18");
    expect(shortWeekRange("2026-10-26")).toBe("Week of Oct 26 – Nov 1");
    expect(dayTimeLabel("2026-10-19T12:12:00Z", TZ)).toBe("Mon Oct 19, 8:12 AM");
  });

  it("review strip: approved, current, on behalf, skipped", () => {
    const chips = reviewChips(
      [
        chip({ kind: "team_leader", status: "approved", approver: "JR", actedBy: "JR", actedAt: "2026-10-19T18:40:00Z" }),
        chip({ stepNo: 2, approver: "BM" }),
        chip({ stepNo: 2, approver: "PD" }),
      ],
      TZ,
    );
    expect(chips).toEqual([
      { label: "Team leader · JR ✓ Oct 19", tone: "green" },
      { label: "Principal in Charge · BM", tone: "blue" },
      { label: "PD", tone: "blue" },
    ]);
    expect(
      reviewChips([chip({ status: "approved", approver: "BM", actedBy: "MW", onBehalf: true, actedAt: "2026-10-20T15:00:00Z" })], TZ)[0]
        .label,
    ).toBe("Principal in Charge · BM ✓ by MW for BM Oct 20");
    expect(reviewChips([chip({ kind: "team_leader", status: "skipped", skipReason: "no_team" })], TZ)[0]).toEqual({
      label: "Team leader · skipped, no team",
      tone: "skipped",
    });
  });

  it("history lines", () => {
    const at = new Date("2026-10-19T18:40:00Z");
    expect(historyLine({ action: "status_changed", changes: { status: { after: "submitted" } }, actor: "KL", at }, TZ)).toBe(
      "Submitted Oct 19, 2:40 PM",
    );
    expect(historyLine({ action: "approved", changes: { step_no: 1, kind: "team_leader" }, actor: "JR", at }, TZ)).toBe(
      "JR approved (step 1) Oct 19, 2:40 PM",
    );
    expect(
      historyLine({ action: "approved", changes: { step_no: 1, on_behalf_of: ["BM", "PD"], note: "Both out" }, actor: "MW", at }, TZ),
    ).toBe('MW approved for BM, PD (step 1): "Both out" Oct 19, 2:40 PM');
    expect(
      historyLine({ action: "status_changed", changes: { status: { after: "rejected" }, note: "Split the DD hours" }, actor: "BM", at }, TZ),
    ).toBe('Returned by BM: "Split the DD hours" Oct 19, 2:40 PM');
    expect(historyLine({ action: "created", changes: null, actor: "KL", at }, TZ)).toBeNull();
  });
});
