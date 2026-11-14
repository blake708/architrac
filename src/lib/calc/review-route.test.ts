import { describe, expect, it } from "vitest";
import { resolveRate } from "./pay";
import {
  type ReviewContext,
  type RouteStep,
  type SavedReviewRow,
  ROUTE_MESSAGES,
  advanceReview,
  andList,
  buildReview,
  currentRows,
  partlyApproved,
  rowsFor,
  stepSummary,
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
  const none = { personRates: [], roleRates: [], pay: [], weeklyHours: 40 };

  it("each day gets the rate in force on its date", () => {
    const r = freezeRates(week, (d) => resolveRate({ ...none, roleRates }, d), "KL");
    expect(r.ok && r.rates.map((x) => x.costRateCents)).toEqual([4200, 4200, 4400, 4400, 4400]);
    expect(r.ok && r.rates.every((x) => x.billRateCents === 11000)).toBe(true);
    // KL's 2026-014 row: Mon 3, Tue 3, Wed 2, Thu 2, Fri 2 → $516 cost.
    const hours = [3, 3, 2, 2, 2];
    expect(r.ok && r.rates.reduce((s, x, i) => s + x.costRateCents * hours[i], 0)).toBe(51600);
  });

  it("a person override wins", () => {
    const personRates = [{ effectiveFrom: "2026-10-01", effectiveTo: null, billRateCents: 12000, costRateCents: 4600 }];
    const r = freezeRates(week, (d) => resolveRate({ ...none, personRates, roleRates }, d), "KL");
    expect(r.ok && r.rates.every((x) => x.billRateCents === 12000 && x.costRateCents === 4600)).toBe(true);
  });

  it("a missing rate blocks and lists the dates", () => {
    const first = roleRates.slice(0, 1);
    expect(freezeRates(["2026-10-14", "2026-10-15", "2026-10-14"], (d) => resolveRate({ ...none, roleRates: first }, d), "KL")).toEqual({
      ok: false,
      message: "No rate for KL on Oct 14, Oct 15. Add one in Settings → Roles & rates.",
    });
  });
});

// ---------- Approving (rule 3, 1.7 B) ----------

type Row = SavedReviewRow & { id: string };
let n = 0;
const row = (stepNo: number, kind: RouteStep["kind"], who: string | null, status: Row["status"] = "waiting"): Row => ({
  id: `r${++n}`,
  stepNo,
  kind,
  approverMembershipId: who,
  status,
  actedAt: status === "approved" ? "2026-10-19T14:00:00Z" : null,
});
const principals = new Set(["BM", "PD"]);
const isPrincipal = (id: string) => principals.has(id);
const ids = (rs: Row[]) => rs.map((r) => r.id);

describe("rowsFor: who may act on the current step", () => {
  const rows = [row(1, "team_leader", "JR"), row(2, "principal_in_charge", "BM")];

  it("only the current step's approver", () => {
    expect(ids(rowsFor(rows, { membershipId: "JR", isActivePrincipal: false }, "KL"))).toEqual([rows[0].id]);
    expect(rowsFor(rows, { membershipId: "BM", isActivePrincipal: true }, "KL")).toEqual([]);
  });

  it("any principal acts on an any_principal step; nobody on their own sheet", () => {
    const any = [row(1, "any_principal", null)];
    expect(rowsFor(any, { membershipId: "PD", isActivePrincipal: true }, "KL")).toHaveLength(1);
    expect(rowsFor(any, { membershipId: "JR", isActivePrincipal: false }, "KL")).toHaveLength(0);
    expect(rowsFor(any, { membershipId: "KL", isActivePrincipal: true }, "KL")).toHaveLength(0);
  });

  it("currentRows lists everyone the step still waits on", () => {
    const two = [row(1, "principal_in_charge", "BM"), row(1, "principal_in_charge", "PD"), row(2, "any_principal", null)];
    expect(currentRows(two).map((r) => r.approverMembershipId)).toEqual(["BM", "PD"]);
  });
});

describe("advanceReview (rule 3c)", () => {
  it("route [PIC, Any principal]: once BM approves, step 2 is skipped and the sheet is done", () => {
    const rows = [row(1, "principal_in_charge", "BM", "approved"), row(2, "any_principal", null)];
    expect(advanceReview(rows, isPrincipal)).toEqual({ skip: [rows[1].id], done: true });
  });

  it("route [Team leader, Any principal]: JR isn't a principal, so step 2 waits", () => {
    const rows = [row(1, "team_leader", "JR", "approved"), row(2, "any_principal", null)];
    expect(advanceReview(rows, isPrincipal)).toEqual({ skip: [], done: false });
  });

  it("two PICs: still waiting on PD after BM approves", () => {
    const rows = [row(1, "principal_in_charge", "BM", "approved"), row(1, "principal_in_charge", "PD")];
    expect(advanceReview(rows, isPrincipal)).toEqual({ skip: [], done: false });
  });

  it("an earlier any_principal approval counts (even on behalf, approver null)", () => {
    const rows = [row(1, "any_principal", null, "approved"), row(2, "team_leader", "JR", "approved"), row(3, "any_principal", null)];
    expect(advanceReview(rows, isPrincipal)).toEqual({ skip: [rows[2].id], done: true });
  });

  it("all approved → done", () => {
    expect(advanceReview([row(1, "principal_in_charge", "BM", "approved")], isPrincipal)).toEqual({ skip: [], done: true });
  });
});

describe("stepSummary", () => {
  const init = (id: string) => id;

  it("Step 1 of 1 · Principal in Charge, last step", () => {
    expect(stepSummary([row(1, "principal_in_charge", "BM")], "BM", init)).toEqual({
      label: "Step 1 of 1 · Principal in Charge",
      note: "Last step",
    });
  });

  it("names who else is still needed, or what comes next", () => {
    const rows = [row(1, "principal_in_charge", "BM"), row(1, "principal_in_charge", "PD")];
    expect(stepSummary(rows, "BM", init)?.note).toBe("Also waiting on PD");
    const two = [row(1, "team_leader", "JR"), row(2, "principal_in_charge", "BM")];
    expect(stepSummary(two, "JR", init)).toEqual({ label: "Step 1 of 2 · Team leader", note: "Then Principal in Charge" });
  });

  it("partlyApproved: someone approved part of it; skipped rows don't count", () => {
    expect(partlyApproved([row(1, "principal_in_charge", "BM"), row(1, "principal_in_charge", "PD")])).toBe(false);
    expect(partlyApproved([row(1, "principal_in_charge", "BM", "approved"), row(1, "principal_in_charge", "PD")])).toBe(true);
    expect(partlyApproved([row(1, "team_leader", null, "skipped"), row(2, "principal_in_charge", "BM")])).toBe(false);
    expect(partlyApproved([row(1, "team_leader", "JR", "approved"), row(2, "principal_in_charge", "BM")])).toBe(true);
  });

  it("andList", () => {
    expect(andList(["BM"])).toBe("BM");
    expect(andList(["BM", "PD"])).toBe("BM and PD");
  });
});
