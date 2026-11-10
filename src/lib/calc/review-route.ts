// Timesheet review route (timesheet-approval spec, decisions #22, #23).
// Pure functions: the firm's route + facts about the sheet → the sheet's
// review rows, who it's waiting on, and the labels the Time page shows.

import { type RatePeriod, lookupRate } from "./rates";
import { shortDay } from "./timesheet";

export const REVIEW_STEP_KINDS = ["principal_in_charge", "team_leader", "any_principal", "person"] as const;
export type ReviewStepKind = (typeof REVIEW_STEP_KINDS)[number];

export const STEP_LABELS: Record<ReviewStepKind, string> = {
  principal_in_charge: "Principal in Charge",
  team_leader: "Team leader",
  any_principal: "Any principal",
  person: "A named person",
};

export type SkipReason =
  | "no_team"
  | "no_projects"
  | "is_submitter"
  | "inactive"
  | "already_reviewing"
  | "principal_already_approved";

export const SKIP_LABELS: Record<SkipReason, string> = {
  no_team: "no team",
  no_projects: "no project time",
  is_submitter: "their own sheet",
  inactive: "inactive",
  already_reviewing: "already reviewing",
  principal_already_approved: "a principal approved",
};

/** One step of the firm's route, in order. */
export type RouteStep = { kind: ReviewStepKind; membershipId: string | null };

/** Someone who might review: their membership and whether it's active. */
export type Reviewer = { membershipId: string; active: boolean };

export type ReviewContext = {
  submitterId: string;
  submitterIsPrincipal: boolean;
  /** The submitter's team leader, if they have a team with a leader. */
  teamLeader: Reviewer | null;
  /** Distinct Principals in Charge of projects with hours on the sheet. */
  pics: Reviewer[];
  /** Named people on the route, by membership id. */
  people: Map<string, Reviewer>;
  /** Active principals' membership ids. */
  activePrincipalIds: string[];
};

export type ReviewRow = {
  stepNo: number;
  kind: ReviewStepKind;
  approverMembershipId: string | null;
  status: "waiting" | "skipped";
  skipReason: SkipReason | null;
};

export type BuildResult =
  | { kind: "auto_approve" }
  | { kind: "review"; rows: ReviewRow[] }
  | { kind: "refuse"; message: string };

export const ROUTE_MESSAGES = {
  needsStep: "The route needs at least one step.",
  noPrincipal:
    "There's no principal to approve this timesheet. Ask an admin to mark someone as a principal on the Team page.",
};

/** The route a firm starts with (decision #23). */
export const DEFAULT_ROUTE: RouteStep[] = [{ kind: "principal_in_charge", membershipId: null }];

/** Why a person can't fill a step, or null if they can. */
function unavailable(p: Reviewer, submitterId: string): SkipReason | null {
  if (p.membershipId === submitterId) return "is_submitter";
  if (!p.active) return "inactive";
  return null;
}

/**
 * Rule 1: turn the firm's route into one sheet's review. A principal's own
 * sheet is approved at once (#22). Steps with nobody to fill them are
 * skipped; nobody is asked twice; if every step skips, any principal.
 */
export function buildReview(route: RouteStep[], ctx: ReviewContext): BuildResult {
  if (ctx.submitterIsPrincipal) return { kind: "auto_approve" };
  const steps = route.length ? route : DEFAULT_ROUTE;
  const rows: ReviewRow[] = [];
  const asked = new Set<string>();
  const skip = (stepNo: number, kind: ReviewStepKind, reason: SkipReason) =>
    rows.push({ stepNo, kind, approverMembershipId: null, status: "skipped", skipReason: reason });

  steps.forEach((step, i) => {
    const stepNo = i + 1;
    if (step.kind === "any_principal") {
      rows.push({ stepNo, kind: step.kind, approverMembershipId: null, status: "waiting", skipReason: null });
      return;
    }
    let candidates: Reviewer[];
    let emptyReason: SkipReason;
    if (step.kind === "principal_in_charge") {
      candidates = ctx.pics;
      emptyReason = "no_projects";
    } else if (step.kind === "team_leader") {
      candidates = ctx.teamLeader ? [ctx.teamLeader] : [];
      emptyReason = "no_team";
    } else {
      const p = step.membershipId ? ctx.people.get(step.membershipId) : undefined;
      candidates = p ? [p] : [];
      emptyReason = "inactive";
    }
    if (!candidates.length) return skip(stepNo, step.kind, emptyReason);

    const reasons = candidates.map((c) => unavailable(c, ctx.submitterId));
    const able = candidates.filter((_, j) => reasons[j] === null);
    if (!able.length) {
      return skip(stepNo, step.kind, reasons.includes("is_submitter") ? "is_submitter" : "inactive");
    }
    const fresh = able.filter((c) => !asked.has(c.membershipId));
    if (!fresh.length) return skip(stepNo, step.kind, "already_reviewing");
    for (const c of fresh) {
      asked.add(c.membershipId);
      rows.push({ stepNo, kind: step.kind, approverMembershipId: c.membershipId, status: "waiting", skipReason: null });
    }
  });

  if (!rows.some((r) => r.status === "waiting")) {
    rows.push({
      stepNo: steps.length + 1,
      kind: "any_principal",
      approverMembershipId: null,
      status: "waiting",
      skipReason: null,
    });
  }
  const needsPrincipal = rows.some((r) => r.kind === "any_principal" && r.status === "waiting");
  if (needsPrincipal && !ctx.activePrincipalIds.some((id) => id !== ctx.submitterId)) {
    return { kind: "refuse", message: ROUTE_MESSAGES.noPrincipal };
  }
  return { kind: "review", rows };
}

/** A saved review row, as read back from the database. */
export type SavedReviewRow = {
  stepNo: number;
  kind: ReviewStepKind;
  approverMembershipId: string | null;
  status: "waiting" | "approved" | "skipped";
  actedAt: Date | string | null;
};

/** The step the sheet is on: the lowest step with a waiting row (null = none left). */
export function currentStep(rows: readonly SavedReviewRow[]): number | null {
  const waiting = rows.filter((r) => r.status === "waiting").map((r) => r.stepNo);
  return waiting.length ? Math.min(...waiting) : null;
}

/** Rule 14: recall only while nobody has approved anything. */
export function canRecallReview(status: string | null, rows: readonly SavedReviewRow[]): boolean {
  return status === "submitted" && !rows.some((r) => r.status === "approved");
}

/**
 * Who a step waits on, as a label: "JR", "BM, PD", or "a principal".
 * `initials` maps membership id → initials.
 */
export function waitingLabel(rows: readonly SavedReviewRow[], initials: (id: string) => string): string | null {
  const step = currentStep(rows);
  if (step === null) return null;
  const here = rows.filter((r) => r.stepNo === step && r.status === "waiting");
  if (here.some((r) => r.approverMembershipId === null)) return "a principal";
  return here.map((r) => initials(r.approverMembershipId!)).join(", ");
}

/**
 * The route still ahead of a sheet, for the status note: "JR, then BM and PD"
 * or "a principal". Skipped and approved steps are left out.
 */
export function routeLabel(rows: readonly SavedReviewRow[], initials: (id: string) => string): string {
  const steps = [...new Set(rows.filter((r) => r.status === "waiting").map((r) => r.stepNo))].sort((a, b) => a - b);
  const names = steps.map((n) => {
    const here = rows.filter((r) => r.stepNo === n && r.status === "waiting");
    if (here.some((r) => r.approverMembershipId === null)) return "a principal";
    const list = here.map((r) => initials(r.approverMembershipId!));
    return list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : list[0];
  });
  return names.join(", then ");
}

// ---------- Freezing rates (rules 2 and 3c) ----------

export type RateRow = RatePeriod & { billRateCents: number; costRateCents: number };

export type FreezeResult =
  | { ok: true; rates: { billRateCents: number; costRateCents: number }[] }
  | { ok: false; message: string };

/**
 * The rate for each entry's work date (person override, then role). If any
 * date has no rate, nothing is frozen and the message lists every such date.
 */
export function freezeRates(
  workDates: readonly string[],
  personRates: readonly RateRow[],
  roleRates: readonly RateRow[],
  personInitials: string,
): FreezeResult {
  const missing = new Set<string>();
  const out = workDates.map((d) => {
    const r = lookupRate(personRates, roleRates, d);
    if (!r) missing.add(d);
    return r ? { billRateCents: r.billRateCents, costRateCents: r.costRateCents } : null;
  });
  if (missing.size) {
    const days = [...missing].sort().map(shortDay).join(", ");
    return { ok: false, message: `No rate for ${personInitials} on ${days}. Add one in Settings → Roles & rates.` };
  }
  return { ok: true, rates: out as { billRateCents: number; costRateCents: number }[] };
}

// ---------- Approving (rule 3, 1.7 B) ----------

/** A review row with enough to decide who may act and what comes next. */
export type ActRow = SavedReviewRow & { id: string };

/** Who is trying to act on a sheet. */
export type Approver = { membershipId: string; isActivePrincipal: boolean };

/**
 * The waiting rows on the current step this person may approve: their own
 * named rows, or an `any_principal` row if they're an active principal.
 * Nobody acts on their own sheet.
 */
export function rowsFor<R extends SavedReviewRow>(rows: readonly R[], me: Approver, submitterId: string): R[] {
  if (me.membershipId === submitterId) return [];
  const step = currentStep(rows);
  if (step === null) return [];
  return rows.filter(
    (r) =>
      r.stepNo === step &&
      r.status === "waiting" &&
      (r.approverMembershipId === me.membershipId || (r.approverMembershipId === null && me.isActivePrincipal)),
  );
}

/** The waiting rows on the current step (what an owner/admin stands in for, rule 3f). */
export function currentRows<R extends SavedReviewRow>(rows: readonly R[]): R[] {
  const step = currentStep(rows);
  return step === null ? [] : rows.filter((r) => r.stepNo === step && r.status === "waiting");
}

/**
 * Rule 3c: after approvals, move on. While the current step is an
 * `any_principal` step and a principal already approved an earlier step
 * (an `any_principal` row, or a named row whose approver is a principal —
 * on-behalf approvals count too), that step is skipped. Returns the row ids
 * to mark skipped and whether the review is finished.
 */
export function advanceReview<R extends SavedReviewRow & { id: string }>(
  rows: readonly R[],
  isPrincipal: (membershipId: string) => boolean,
): { skip: string[]; done: boolean } {
  const state = rows.map((r) => ({ ...r }));
  const skip: string[] = [];
  for (;;) {
    const step = currentStep(state);
    if (step === null) return { skip, done: true };
    const here = state.filter((r) => r.stepNo === step && r.status === "waiting");
    if (!here.every((r) => r.kind === "any_principal")) return { skip, done: false };
    const principalApproved = state.some(
      (r) =>
        r.stepNo < step &&
        r.status === "approved" &&
        (r.kind === "any_principal" || (r.approverMembershipId !== null && isPrincipal(r.approverMembershipId))),
    );
    if (!principalApproved) return { skip, done: false };
    for (const r of here) {
      r.status = "skipped";
      skip.push(r.id);
    }
  }
}

/** "Step 2 of 2 · Principal in Charge" and who else is still needed, for the queue. */
export function stepSummary(
  rows: readonly SavedReviewRow[],
  myMembershipId: string | null,
  initials: (id: string) => string,
): { label: string; note: string } | null {
  const step = currentStep(rows);
  if (step === null) return null;
  const total = Math.max(...rows.map((r) => r.stepNo));
  const here = rows.filter((r) => r.stepNo === step && r.status === "waiting");
  const label = `Step ${step} of ${total} · ${STEP_LABELS[here[0].kind]}`;
  const others = here
    .filter((r) => r.approverMembershipId !== null && r.approverMembershipId !== myMembershipId)
    .map((r) => initials(r.approverMembershipId!));
  if (others.length) return { label, note: `Also waiting on ${others.join(", ")}` };
  const next = rows.find((r) => r.stepNo > step && r.status === "waiting");
  return { label, note: next ? `Then ${STEP_LABELS[next.kind]}` : "Last step" };
}

/** "BM" / "BM and PD", for the Approve-for button and dialog. */
export function andList(names: readonly string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? "");
}
