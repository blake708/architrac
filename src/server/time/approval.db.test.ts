import type { Pool } from "@neondatabase/serverless";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { withFirm } from "@/db/tenant";
import {
  type TestFirm,
  type TestMember,
  addTestMember,
  asFirm,
  createOwnerPool,
  createTestFirm,
  removeTestFirm,
  removeTestUsers,
  requireDbEnv,
} from "@/db/test-helpers";
import { addDays } from "@/lib/calc/timesheet";
import { FORBIDDEN_MESSAGE } from "@/server/settings/common";
import {
  type ApprovalActor,
  approvalAccess,
  approveManyCore,
  approveStepCore,
  reopenTimesheetCore,
  returnTimesheetCore,
} from "./approval";
import { loadApprovalDetail, loadQueue } from "./approval-read";
import { submitTimesheetCore } from "./write";

// Approvals against the real database (timesheet-approval spec, 1.7 B
// acceptance tests). The pure rules are in src/lib/calc/review-route.test.ts.
//
// Cast: BM (owner, principal, PIC of 2026-001), PD (principal, PIC of
// 2026-017), JR (team leader of Medical), KL (designer on Medical), MW
// (admin), DS (staff, nobody's reviewer), NB (no role, so no rate), EW
// (designer with a person override).

let pool: Pool;
let A: TestFirm;
let B: TestFirm;
const users: string[] = [];
let pd: TestMember, jr: TestMember, kl: TestMember, mw: TestMember, ds: TestMember, nb: TestMember, ew: TestMember;
let p2: { projectId: string; phaseId: string };
let medical: string;

const actorFor = (
  firm: TestFirm,
  m: { userId: string; membershipId: string },
  appRole: ApprovalActor["member"]["appRole"] = "staff",
): ApprovalActor => ({
  firmId: firm.firmId,
  userId: m.userId,
  membershipId: m.membershipId,
  timezone: "America/New_York",
  weekStartsOn: 1,
  lockDay: 1,
  dueTime: "09:00:00",
  notesRule: "optional",
  member: { appRole, active: true },
});
let BM: ApprovalActor, PD: ApprovalActor, JR: ApprovalActor, KL: ApprovalActor, MW: ApprovalActor, DS: ApprovalActor;

const q = <T extends Record<string, unknown>>(text: string, params: unknown[] = []) =>
  asFirm(pool, A.firmId, async (c) => (await c.query<T>(text, params)).rows);

async function setRoute(...kinds: string[]) {
  await q("update review_steps set archived_at = now() where firm_id = $1 and archived_at is null", [A.firmId]);
  for (const [i, kind] of kinds.entries())
    await q("insert into review_steps (firm_id, sort_order, kind) values ($1, $2, $3)", [A.firmId, i, kind]);
}

type Line = { project?: "p1" | "p2"; hours: number[] };

/** A complete draft for the week (Mon onward), then submitted by its owner. Returns the sheet id. */
async function submitted(who: ApprovalActor, week: string, lines: Line[] = [{ hours: [8, 8, 8, 8, 8] }]): Promise<string> {
  await asFirm(pool, A.firmId, async (c) => {
    const s = await c.query<{ id: string }>(
      "insert into timesheets (firm_id, membership_id, week_start) values ($1, $2, $3) returning id",
      [A.firmId, who.membershipId, week],
    );
    for (const [i, l] of lines.entries()) {
      const projectId = l.project === "p2" ? p2.projectId : A.projectId;
      const phaseId = l.project === "p2" ? p2.phaseId : A.projectPhaseId;
      const row = await c.query<{ id: string }>(
        "insert into timesheet_rows (firm_id, timesheet_id, row_type, project_id, project_phase_id, activity_id, billable, sort_order) values ($1, $2, 'project', $3, $4, $5, true, $6) returning id",
        [A.firmId, s.rows[0].id, projectId, phaseId, A.activityId, i],
      );
      for (const [d, h] of l.hours.entries())
        if (h > 0)
          await c.query(
            "insert into time_entries (firm_id, timesheet_id, timesheet_row_id, work_date, project_id, project_phase_id, activity_id, hours, billable) values ($1, $2, $3, $4, $5, $6, $7, $8, true)",
            [A.firmId, s.rows[0].id, row.rows[0].id, addDays(week, d), projectId, phaseId, A.activityId, h],
          );
    }
  });
  const r = await submitTimesheetCore(who, { weekStart: week });
  expect(r.ok, r.ok ? "" : r.error).toBe(true);
  return r.data!.timesheetId!;
}

const statusOf = async (id: string) => (await q<{ status: string }>("select status from timesheets where id = $1", [id]))[0].status;
const reviewOf = (id: string) =>
  q<{ step_no: number; approver_membership_id: string | null; status: string; acted_by: string | null; on_behalf: boolean }>(
    "select step_no, approver_membership_id, status, acted_by, on_behalf from timesheet_review_steps where timesheet_id = $1 and archived_at is null order by step_no, approver_membership_id",
    [id],
  );
const ratesOf = (id: string) =>
  q<{ work_date: string; bill: string | null; cost: string | null }>(
    "select work_date::text, bill_rate_cents as bill, cost_rate_cents as cost from time_entries where timesheet_id = $1 and archived_at is null order by work_date",
    [id],
  );
const queueIds = async (who: ApprovalActor) =>
  withFirm(A.firmId, async (db) => (await loadQueue(db, who, await approvalAccess(db, who))).weeks.flatMap((w) => w.items.map((i) => i.timesheetId)));
const approve = (who: ApprovalActor, timesheetId: string, extra: { onBehalf?: boolean; note?: string } = {}) =>
  approveStepCore(who, { timesheetId, ...extra });

beforeAll(async () => {
  requireDbEnv();
  pool = createOwnerPool();
  A = await createTestFirm(pool, "Appr");
  B = await createTestFirm(pool, "Appr B");
  pd = await addTestMember(pool, A, { firstName: "Pat", lastName: "Dunn", role: "project_manager" });
  jr = await addTestMember(pool, A, { firstName: "Jo", lastName: "Reyes", role: "staff", title: "Team leader" });
  kl = await addTestMember(pool, A, { firstName: "Kat", lastName: "Lee", role: "staff", title: "Designer" });
  mw = await addTestMember(pool, A, { firstName: "Mia", lastName: "Wong", role: "admin" });
  ds = await addTestMember(pool, A, { firstName: "Dan", lastName: "Sole", role: "staff" });
  nb = await addTestMember(pool, A, { firstName: "Nia", lastName: "Bell", role: "staff" });
  ew = await addTestMember(pool, A, { firstName: "Eli", lastName: "West", role: "staff" });
  users.push(pd.userId, jr.userId, kl.userId, mw.userId, ds.userId, nb.userId, ew.userId);
  BM = actorFor(A, A, "owner");
  PD = actorFor(A, pd, "project_manager");
  JR = actorFor(A, jr);
  KL = actorFor(A, kl);
  MW = actorFor(A, mw, "admin");
  DS = actorFor(A, ds);

  await asFirm(pool, A.firmId, async (c) => {
    await c.query("update users set first_name = 'Blake', last_name = 'Mason', initials = 'BM' where id = $1", [A.userId]);
    await c.query("update memberships set is_principal = true where id = any($1::uuid[])", [[A.membershipId, pd.membershipId]]);
    const team = await c.query<{ id: string }>(
      "insert into teams (firm_id, name, leader_membership_id) values ($1, 'Medical', $2) returning id",
      [A.firmId, jr.membershipId],
    );
    medical = team.rows[0].id;
    await c.query("update memberships set team_id = $1 where id = any($2::uuid[])", [medical, [jr.membershipId, kl.membershipId]]);
    await c.query("update memberships set firm_role_id = $1 where id = any($2::uuid[])", [
      A.firmRoleId,
      [kl.membershipId, jr.membershipId, mw.membershipId, ds.membershipId, ew.membershipId],
    ]);
    // Rule 3 rate fixture: Designer A to Oct 13 (110 / 42), B from Oct 14 (110 / 44).
    await c.query("update rates set bill_rate_cents = 11000, cost_rate_cents = 4200, effective_to = '2026-10-13' where id = $1", [A.rateId]);
    await c.query(
      "insert into rates (firm_id, firm_role_id, bill_rate_cents, cost_rate_cents, effective_from) values ($1, $2, 11000, 4400, '2026-10-14')",
      [A.firmId, A.firmRoleId],
    );
    await c.query(
      "insert into rates (firm_id, membership_id, bill_rate_cents, cost_rate_cents, effective_from) values ($1, $2, 12000, 4600, '2026-10-01')",
      [A.firmId, ew.membershipId],
    );
    await c.query(
      "insert into rates (firm_id, membership_id, bill_rate_cents, cost_rate_cents, effective_from) values ($1, $2, 18500, 9500, '2026-01-01')",
      [A.firmId, A.membershipId],
    );
    const proj = await c.query<{ id: string }>(
      "insert into projects (firm_id, number, name, client_company_id, project_type, principal_membership_id, pm_membership_id) values ($1, '2026-017', 'Clinic', $2, 'Medical', $3, $3) returning id",
      [A.firmId, A.companyId, pd.membershipId],
    );
    const phase = await c.query<{ id: string }>(
      "insert into project_phases (firm_id, project_id, code, name, sort_order, fee_type, fee_cents, status) values ($1, $2, 'SD', 'Schematic Design', 1, 'fixed', 1000000, 'current') returning id",
      [A.firmId, proj.rows[0].id],
    );
    p2 = { projectId: proj.rows[0].id, phaseId: phase.rows[0].id };
  });
});

afterAll(async () => {
  if (pool) {
    if (A) await removeTestFirm(pool, A);
    if (B) await removeTestFirm(pool, B);
    await removeTestUsers(pool, users);
    await pool.end();
  }
  await closeDb();
});

describe("approving (1.7 B)", () => {
  it("route [PIC]: KL's sheet waits on BM and shows 'Step 1 of 1 · Principal in Charge'", async () => {
    await setRoute("principal_in_charge");
    const id = await submitted(KL, "2026-08-03");
    const queue = await withFirm(A.firmId, async (db) => loadQueue(db, BM, await approvalAccess(db, BM)));
    const item = queue.weeks.flatMap((w) => w.items).find((i) => i.timesheetId === id)!;
    expect(item.step).toEqual({ label: "Step 1 of 1 · Principal in Charge", note: "Last step" });
    expect(item.days).toEqual([8, 8, 8, 8, 8]);
    expect(item.flag).toBeNull();
    expect(queue.route).toEqual(["Principal in Charge"]);
    // Not in PD's or JR's queue.
    expect(await queueIds(PD)).not.toContain(id);
  });

  it("two PICs: BM approves, it stays in review and moves to PD only; PD approves, it's approved", async () => {
    await setRoute("principal_in_charge");
    const id = await submitted(KL, "2026-08-10", [{ hours: [4, 4, 0, 0, 0] }, { project: "p2", hours: [4, 4, 8, 8, 8] }]);
    expect(await queueIds(BM)).toContain(id);
    expect(await queueIds(PD)).toContain(id);
    expect(await approve(BM, id)).toMatchObject({ ok: true, approved: false });
    expect(await statusOf(id)).toBe("submitted");
    expect(await queueIds(BM)).not.toContain(id);
    expect(await queueIds(PD)).toContain(id);
    expect(await approve(PD, id)).toMatchObject({ ok: true, approved: true });
    expect(await statusOf(id)).toBe("approved");
  });

  it("final approval freezes each day's rate (rule 3 fixture); later rate edits don't change them", async () => {
    await setRoute("principal_in_charge");
    const id = await submitted(KL, "2026-10-12", [{ hours: [3, 3, 2, 2, 2] }]);
    expect((await approve(BM, id)).ok).toBe(true);
    const frozen = await ratesOf(id);
    expect(frozen.map((r) => r.cost)).toEqual(["4200", "4200", "4400", "4400", "4400"]);
    expect(frozen.every((r) => r.bill === "11000")).toBe(true);
    // Labor cost 6 × 42 + 6 × 44 = $516.
    const [{ cost }] = await q<{ cost: string }>(
      "select sum(hours * cost_rate_cents)::bigint as cost from time_entries where timesheet_id = $1 and archived_at is null",
      [id],
    );
    expect(Number(cost)).toBe(51600);
    await q("update rates set cost_rate_cents = 9999 where firm_role_id = $1", [A.firmRoleId]);
    try {
      expect((await ratesOf(id)).map((r) => r.cost)).toEqual(["4200", "4200", "4400", "4400", "4400"]);
    } finally {
      await q("update rates set cost_rate_cents = case when effective_to is null then 4400 else 4200 end where firm_role_id = $1", [A.firmRoleId]);
    }
  });

  it("a person override wins: EW's entries all get 12000 / 4600", async () => {
    await setRoute("principal_in_charge");
    const id = await submitted(actorFor(A, ew), "2026-10-12", [{ hours: [3, 3, 2, 2, 2] }]);
    expect((await approve(BM, id)).ok).toBe(true);
    const rows = await ratesOf(id);
    expect(rows.every((r) => r.bill === "12000" && r.cost === "4600")).toBe(true);
  });

  it("no rate on the last step: nothing is written and the error names the dates", async () => {
    await setRoute("principal_in_charge");
    const id = await submitted(actorFor(A, nb), "2026-10-12", [{ hours: [0, 0, 8, 0, 0] }]);
    expect(await approve(BM, id)).toEqual({ ok: false, error: "No rate for NB on Oct 14. Add one in Settings → Roles & rates." });
    expect(await statusOf(id)).toBe("submitted");
    expect((await reviewOf(id)).map((r) => r.status)).toEqual(["waiting"]);
    expect((await ratesOf(id)).every((r) => r.bill === null)).toBe(true);
    // The queue flags it (owner sees the date).
    const queue = await withFirm(A.firmId, async (db) => loadQueue(db, BM, await approvalAccess(db, BM)));
    expect(queue.weeks.flatMap((w) => w.items).find((i) => i.timesheetId === id)?.flag?.label).toBe("No rate for Oct 14");
  });

  it("route [Team leader, Any principal]: after JR, every principal sees it; the first to approve completes it", async () => {
    await setRoute("team_leader", "any_principal");
    const id = await submitted(KL, "2026-08-17");
    expect(await queueIds(BM)).not.toContain(id);
    expect((await approve(JR, id)).ok).toBe(true);
    expect(await queueIds(BM)).toContain(id);
    expect(await queueIds(PD)).toContain(id);
    expect(await approve(PD, id)).toMatchObject({ ok: true, approved: true });
    expect(await queueIds(BM)).not.toContain(id);
    expect(await approve(BM, id)).toEqual({ ok: false, error: "This timesheet is no longer waiting for you." });
    const rows = await reviewOf(id);
    expect(rows[1]).toMatchObject({ approver_membership_id: pd.membershipId, status: "approved" });
  });

  it("two people approve the same step at once: one wins, rates are written once", async () => {
    await setRoute("any_principal");
    const id = await submitted(KL, "2026-08-24");
    const results = await Promise.all([approve(BM, id), approve(PD, id)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, error: "This timesheet is no longer waiting for you." });
    expect(await statusOf(id)).toBe("approved");
    const logs = await q("select id from activity_log where entity_id = $1 and action = 'approved'", [id]);
    expect(logs).toHaveLength(1);
  });

  it("MW (admin) approves for BM and PD with a note", async () => {
    await setRoute("principal_in_charge");
    const id = await submitted(KL, "2026-08-31", [{ hours: [8, 8, 0, 0, 0] }, { project: "p2", hours: [0, 0, 8, 8, 8] }]);
    expect(await approve(MW, id)).toEqual({ ok: false, error: "This timesheet is no longer waiting for you." });
    const detail = await withFirm(A.firmId, async (db) => loadApprovalDetail(db, MW, await approvalAccess(db, MW), id));
    expect(detail?.approveFor).toBe("BM and PD");
    expect(await approve(MW, id, { onBehalf: true, note: "Both out this week" })).toMatchObject({ ok: true, approved: true });
    const rows = await reviewOf(id);
    expect(rows.every((r) => r.status === "approved" && r.acted_by === mw.userId && r.on_behalf)).toBe(true);
    expect((await ratesOf(id)).every((r) => r.bill !== null)).toBe(true);
    const [log] = await q<{ changes: { on_behalf_of: string[]; note: string } }>(
      "select changes from activity_log where entity_id = $1 and action = 'approved'",
      [id],
    );
    expect(log.changes.on_behalf_of.sort()).toEqual(["BM", "PD"]);
    expect(log.changes.note).toBe("Both out this week");
  });

  it("standing in for JR doesn't skip 'Any principal'; standing in for BM (a principal) does", async () => {
    await setRoute("team_leader", "any_principal");
    const a = await submitted(KL, "2026-09-07");
    expect(await approve(MW, a, { onBehalf: true })).toMatchObject({ ok: true, approved: false });
    expect((await reviewOf(a)).map((r) => r.status)).toEqual(["approved", "waiting"]);

    await setRoute("principal_in_charge", "any_principal");
    const b = await submitted(KL, "2026-09-14");
    expect(await approve(MW, b, { onBehalf: true })).toMatchObject({ ok: true, approved: true });
    expect((await reviewOf(b)).map((r) => r.status)).toEqual(["approved", "skipped"]);
  });

  it("only owner/admin step in, and never on their own sheet", async () => {
    await setRoute("principal_in_charge");
    const kls = await submitted(KL, "2026-09-21");
    expect(await approve(JR, kls, { onBehalf: true })).toEqual({ ok: false, error: FORBIDDEN_MESSAGE });
    const mws = await submitted(MW, "2026-09-21");
    expect(await approve(MW, mws, { onBehalf: true })).toEqual({ ok: false, error: FORBIDDEN_MESSAGE });
  });

  it("BM's own sheet is approved on submit, never in his queue, and approveStep on it is forbidden", async () => {
    await setRoute("principal_in_charge");
    const own = await submitted(BM, "2026-09-21");
    expect(await statusOf(own)).toBe("approved");
    expect(await queueIds(BM)).not.toContain(own);
    expect(await approve(BM, own)).toEqual({ ok: false, error: FORBIDDEN_MESSAGE });
  });

  it("DS (nobody's reviewer) has no Approvals and approveStep is forbidden", async () => {
    await setRoute("principal_in_charge");
    const id = await submitted(KL, "2026-09-28");
    expect(await withFirm(A.firmId, (db) => approvalAccess(db, DS))).toMatchObject({ canOpen: false });
    expect(await approve(DS, id)).toEqual({ ok: false, error: FORBIDDEN_MESSAGE });
    expect(await withFirm(A.firmId, async (db) => loadApprovalDetail(db, DS, await approvalAccess(db, DS), id))).toBeNull();
  });

  it("a firm B user can't find a firm A sheet", async () => {
    const id = (await q<{ id: string }>("select id from timesheets where firm_id = $1 and status = 'submitted' limit 1", [A.firmId]))[0].id;
    const outsider = actorFor(B, B, "owner");
    expect(await approve(outsider, id)).toEqual({ ok: false, error: "That timesheet wasn't found." });
  });
});

describe("rates privacy (rule 12)", () => {
  it("JR's detail and queue have no rates; BM's detail has them", async () => {
    await setRoute("team_leader", "principal_in_charge");
    const id = await submitted(KL, "2026-07-06");
    const jrView = await withFirm(A.firmId, async (db) => loadApprovalDetail(db, JR, await approvalAccess(db, JR), id));
    expect(jrView).not.toBeNull();
    expect(jrView).not.toHaveProperty("rates");
    expect(JSON.stringify(jrView)).not.toMatch(/rate_cents|RateCents|\$110/);
    const bmView = await withFirm(A.firmId, async (db) => loadApprovalDetail(db, BM, await approvalAccess(db, BM), id));
    expect(Object.values(bmView!.rates!)[0]).toEqual({ bill: "$110", cost: "$42", missing: false });
  });
});

describe("return and reopen (rules 4, 5)", () => {
  it("the note is required and at most 1000 characters", async () => {
    await setRoute("principal_in_charge");
    const id = await submitted(KL, "2026-07-13");
    expect(await returnTimesheetCore(BM, { timesheetId: id, note: "   " })).toEqual({
      ok: false,
      error: "Add a note so KL knows what to change.",
    });
    expect(await returnTimesheetCore(BM, { timesheetId: id, note: "x".repeat(1001) })).toEqual({
      ok: false,
      error: "Notes can be up to 1000 characters.",
    });
  });

  it("after JR approved step 1, BM returns it: rejected, review archived, note saved", async () => {
    await setRoute("team_leader", "principal_in_charge");
    const id = await submitted(KL, "2026-07-20");
    expect((await approve(JR, id)).ok).toBe(true);
    expect(await returnTimesheetCore(BM, { timesheetId: id, note: "Split the SD hours by activity." })).toMatchObject({ ok: true });
    expect(await statusOf(id)).toBe("rejected");
    expect(await reviewOf(id)).toEqual([]);
    const [sheet] = await q<{ rejection_note: string; rejected_by: string }>(
      "select rejection_note, rejected_by from timesheets where id = $1",
      [id],
    );
    expect(sheet).toEqual({ rejection_note: "Split the SD hours by activity.", rejected_by: A.userId });
    // DS can't return anything.
    expect(await returnTimesheetCore(DS, { timesheetId: id, note: "x" })).toEqual({ ok: false, error: FORBIDDEN_MESSAGE });
  });

  it("an approved sheet: BM reopens it with a note; rates are cleared and the log says reopened", async () => {
    await setRoute("principal_in_charge");
    const id = await submitted(KL, "2026-07-27");
    expect((await approve(BM, id)).ok).toBe(true);
    expect(await reopenTimesheetCore(JR, { timesheetId: id, note: "x" })).toEqual({ ok: false, error: FORBIDDEN_MESSAGE });
    expect(await reopenTimesheetCore(BM, { timesheetId: id, note: "Wrong project on Tuesday." })).toMatchObject({ ok: true });
    expect(await statusOf(id)).toBe("rejected");
    expect((await ratesOf(id)).every((r) => r.bill === null && r.cost === null)).toBe(true);
    expect(await q("select id from activity_log where entity_id = $1 and action = 'reopened'", [id])).toHaveLength(1);
  });
});

describe("bulk approve", () => {
  it("3 selected, one missing a rate on its last step: 2 approved and the toast names the other", async () => {
    await setRoute("principal_in_charge");
    const a = await submitted(KL, "2026-06-01");
    const b = await submitted(actorFor(A, ds), "2026-06-01");
    const c = await submitted(actorFor(A, nb), "2026-06-01", [{ hours: [0, 0, 8, 0, 0] }]);
    expect(await approveManyCore(BM, { timesheetIds: [a, b, c] })).toEqual({
      ok: true,
      message: "Approved 2. 1 not approved: NB has no rate on Jun 3.",
    });
    expect([await statusOf(a), await statusOf(b), await statusOf(c)]).toEqual(["approved", "approved", "submitted"]);
  });
});
