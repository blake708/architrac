import { describe, expect, it } from "vitest";
import {
  type ReviewContext,
  type RouteStep,
  type SavedReviewRow,
  ROUTE_MESSAGES,
  buildReview,
  canRecallReview,
  currentStep,
  freezeRates,
  routeLabel,
  waitingLabel,
} from "./review-route";

// Worked examples from timesheet-approval.md rule 1. Seed people: BM
// (principal, PIC of 2026-014), PD (a second principal, PIC of 2026-017),
// JR (Medical team leader), KL (designer on JR's team), MW (admin).
const on = (id: string, active = true) => ({ membershipId: id, active });

const PIC: RouteStep = { kind: "principal_in_charge", membershipId: null };
const LEADER: RouteStep = { kind: "team_leader", membershipId: null };
const ANY: RouteStep = { kind: "any_principal", membershipId: null };
const named = (id: string): RouteStep => ({ kind: "person", membershipId: id });

function ctx(over: Partial<ReviewContext> = {}): ReviewContext {
  return {
    submitterId: "KL",
    submitterIsPrincipal: false,
    teamLeader: on("JR"),
    pics: [on("BM")],
    people: new Map([["MW", on("MW")]]),
    activePrincipalIds: ["BM", "PD"],
    ...over,
  };
}

const waiting = (stepNo: number, kind: RouteStep["kind"], who: string | null) => ({
  stepNo,
  kind,
  approverMembershipId: who,
  status: "waiting",
  skipReason: null,
});
const skipped = (stepNo: number, kind: RouteStep["kind"], reason: string) => ({
  stepNo,
  kind,
  approverMembershipId: null,
  status: "skipped",
  skipReason: reason,
});

describe("buildReview (rule 1)", () => {
  it("route [PIC]: KL on 2026-014 waits on BM", () => {
    expect(buildReview([PIC], ctx())).toEqual({ kind: "review", rows: [waiting(1, "principal_in_charge", "BM")] });
  });

  it("route [PIC]: two projects with different PICs need both", () => {
    expect(buildReview([PIC], ctx({ pics: [on("BM"), on("PD")] }))).toEqual({
      kind: "review",
      rows: [waiting(1, "principal_in_charge", "BM"), waiting(1, "principal_in_charge", "PD")],
    });
  });

  it("route [PIC]: overhead only skips to any principal", () => {
    expect(buildReview([PIC], ctx({ submitterId: "MW", pics: [] }))).toEqual({
      kind: "review",
      rows: [skipped(1, "principal_in_charge", "no_projects"), waiting(2, "any_principal", null)],
    });
  });

  it("route [Team leader, PIC]: KL goes to JR, then BM", () => {
    expect(buildReview([LEADER, PIC], ctx())).toEqual({
      kind: "review",
      rows: [waiting(1, "team_leader", "JR"), waiting(2, "principal_in_charge", "BM")],
    });
  });

  it("route [Team leader, PIC]: the leader's own sheet skips step 1", () => {
    expect(buildReview([LEADER, PIC], ctx({ submitterId: "JR" }))).toEqual({
      kind: "review",
      rows: [skipped(1, "team_leader", "is_submitter"), waiting(2, "principal_in_charge", "BM")],
    });
  });

  it("route [Team leader, Any principal]: JR, then any principal", () => {
    expect(buildReview([LEADER, ANY], ctx())).toEqual({
      kind: "review",
      rows: [waiting(1, "team_leader", "JR"), waiting(2, "any_principal", null)],
    });
  });

  it("route [Named MW, PIC]: MW's own sheet skips to BM", () => {
    expect(buildReview([named("MW"), PIC], ctx({ submitterId: "MW" }))).toEqual({
      kind: "review",
      rows: [skipped(1, "person", "is_submitter"), waiting(2, "principal_in_charge", "BM")],
    });
  });

  it("a principal's own sheet is approved on submit (#22)", () => {
    expect(buildReview([LEADER, PIC], ctx({ submitterId: "BM", submitterIsPrincipal: true }))).toEqual({
      kind: "auto_approve",
    });
  });

  it("no team and an inactive leader both skip the team-leader step", () => {
    expect(buildReview([LEADER, PIC], ctx({ teamLeader: null })).kind).toBe("review");
    expect(buildReview([LEADER, PIC], ctx({ teamLeader: null }))).toMatchObject({
      rows: [skipped(1, "team_leader", "no_team"), waiting(2, "principal_in_charge", "BM")],
    });
    expect(buildReview([LEADER, PIC], ctx({ teamLeader: on("JR", false) }))).toMatchObject({
      rows: [skipped(1, "team_leader", "inactive"), waiting(2, "principal_in_charge", "BM")],
    });
  });

  it("an inactive PIC is left out; if none are left the step skips", () => {
    expect(buildReview([PIC], ctx({ pics: [on("BM", false), on("PD")] }))).toEqual({
      kind: "review",
      rows: [waiting(1, "principal_in_charge", "PD")],
    });
    expect(buildReview([PIC], ctx({ pics: [on("BM", false)] }))).toMatchObject({
      rows: [skipped(1, "principal_in_charge", "inactive"), waiting(2, "any_principal", null)],
    });
  });

  it("nobody is asked twice: a named person who is also the team leader", () => {
    expect(buildReview([LEADER, named("JR"), PIC], ctx({ people: new Map([["JR", on("JR")]]) }))).toEqual({
      kind: "review",
      rows: [
        waiting(1, "team_leader", "JR"),
        skipped(2, "person", "already_reviewing"),
        waiting(3, "principal_in_charge", "BM"),
      ],
    });
  });

  it("refuses when any principal is needed and there is none", () => {
    expect(buildReview([ANY], ctx({ submitterId: "MW", activePrincipalIds: [] }))).toEqual({
      kind: "refuse",
      message: ROUTE_MESSAGES.noPrincipal,
    });
  });

  it("an empty route falls back to the default (Principal in Charge)", () => {
    expect(buildReview([], ctx())).toEqual({ kind: "review", rows: [waiting(1, "principal_in_charge", "BM")] });
  });
});

describe("reading a saved review", () => {
  const rows: SavedReviewRow[] = [
    { stepNo: 1, kind: "team_leader", approverMembershipId: "JR", status: "waiting", actedAt: null },
    { stepNo: 2, kind: "principal_in_charge", approverMembershipId: "BM", status: "waiting", actedAt: null },
    { stepNo: 2, kind: "principal_in_charge", approverMembershipId: "PD", status: "waiting", actedAt: null },
  ];
  const ini = (id: string) => id;

  it("current step, waiting label and route label", () => {
    expect(currentStep(rows)).toBe(1);
    expect(waitingLabel(rows, ini)).toBe("JR");
    expect(routeLabel(rows, ini)).toBe("JR, then BM and PD");
  });

  it("after step 1 is approved, it waits on both PICs and can't be recalled", () => {
    const after = rows.map((r, i) => (i === 0 ? { ...r, status: "approved" as const, actedAt: "2026-10-19" } : r));
    expect(currentStep(after)).toBe(2);
    expect(waitingLabel(after, ini)).toBe("BM, PD");
    expect(canRecallReview("submitted", after)).toBe(false);
    expect(canRecallReview("submitted", rows)).toBe(true);
    expect(canRecallReview("draft", rows)).toBe(false);
  });

  it("any principal reads as 'a principal'", () => {
    const anyRows: SavedReviewRow[] = [
      { stepNo: 1, kind: "any_principal", approverMembershipId: null, status: "waiting", actedAt: null },
    ];
    expect(waitingLabel(anyRows, ini)).toBe("a principal");
    expect(routeLabel(anyRows, ini)).toBe("a principal");
    expect(currentStep([])).toBeNull();
  });
});

describe("freezeRates (rules 2 and 3c)", () => {
  // Rule 3 fixture: Designer role rate A to Oct 13, rate B from Oct 14.
  const roleRates = [
    { effectiveFrom: "2026-01-01", effectiveTo: "2026-10-13", billRateCents: 11000, costRateCents: 4200 },
    { effectiveFrom: "2026-10-14", effectiveTo: null, billRateCents: 11000, costRateCents: 4400 },
  ];
  const week = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"];

  it("each day gets the rate in force on its date", () => {
    const r = freezeRates(week, [], roleRates, "KL");
    expect(r.ok && r.rates.map((x) => x.costRateCents)).toEqual([4200, 4200, 4400, 4400, 4400]);
    expect(r.ok && r.rates.every((x) => x.billRateCents === 11000)).toBe(true);
    // KL's 2026-014 row: Mon 3, Tue 3, Wed 2, Thu 2, Fri 2 → $516 cost.
    const hours = [3, 3, 2, 2, 2];
    expect(r.ok && r.rates.reduce((s, x, i) => s + x.costRateCents * hours[i], 0)).toBe(51600);
  });

  it("a person override wins", () => {
    const person = [{ effectiveFrom: "2026-10-01", effectiveTo: null, billRateCents: 12000, costRateCents: 4600 }];
    const r = freezeRates(week, person, roleRates, "KL");
    expect(r.ok && r.rates.every((x) => x.billRateCents === 12000 && x.costRateCents === 4600)).toBe(true);
  });

  it("a missing rate blocks and lists the dates", () => {
    expect(freezeRates(["2026-10-14", "2026-10-15", "2026-10-14"], [], roleRates.slice(0, 1), "KL")).toEqual({
      ok: false,
      message: "No rate for KL on Oct 14, Oct 15. Add one in Settings → Roles & rates.",
    });
  });
});
