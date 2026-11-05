import type { Pool } from "@neondatabase/serverless";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
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
import { addDays, weekStartOf } from "@/lib/calc/timesheet";
import { todayIn } from "@/lib/format";
import type { TimesheetView } from "./week";
import {
  type TimeActor,
  addRowCore,
  loadWeekCore,
  recallTimesheetCore,
  removeRowCore,
  setHoursCore,
  submitTimesheetCore,
  updateRowCore,
} from "./write";

// Timesheet server actions against the real database (timesheet spec,
// acceptance tests). The math is in src/lib/calc/timesheet.test.ts.

let pool: Pool;
let A: TestFirm;
let B: TestFirm;
let kl: TestMember;
const users: string[] = [];
const WEEK = "2026-10-12";
let ids: Record<string, string>;

const actorFor = (firm: TestFirm, m: { userId: string; membershipId: string }, extra: Partial<TimeActor> = {}): TimeActor => ({
  firmId: firm.firmId,
  userId: m.userId,
  membershipId: m.membershipId,
  timezone: "America/New_York",
  weekStartsOn: 1,
  lockDay: 1,
  dueTime: "09:00:00",
  billableNotesRequired: false,
  member: { appRole: "staff", active: true },
  ...extra,
});
let bm: TimeActor; // the owner, leader of the firm's team
let klA: TimeActor; // staff on that team

/** The data of a successful result (fails the test otherwise). */
function ok(r: { ok: boolean; data?: TimesheetView; error?: string }): TimesheetView {
  expect(r.ok, r.error).toBe(true);
  return r.data!;
}

/** Add a row to the week and return its id. */
async function newRow(who: TimeActor, week = WEEK) {
  const v = ok(await addRowCore(who, { weekStart: week }));
  return v.rows[v.rows.length - 1].id;
}

const q = <T extends Record<string, unknown>>(text: string, params: unknown[] = []) =>
  asFirm(pool, A.firmId, async (c) => (await c.query<T>(text, params)).rows);

beforeAll(async () => {
  requireDbEnv();
  pool = createOwnerPool();
  A = await createTestFirm(pool, "Time");
  B = await createTestFirm(pool, "Time B");
  kl = await addTestMember(pool, A, { firstName: "Kat", lastName: "Lee", role: "staff" });
  users.push(kl.userId);
  bm = actorFor(A, A, { member: { appRole: "owner", active: true } });
  klA = actorFor(A, kl);
  ids = await asFirm(pool, A.firmId, async (c) => {
    await c.query("update memberships set team_id = $1 where id = $2", [A.teamId, kl.membershipId]);
    await c.query("update project_phases set code = 'DD', name = 'Design Development' where id = $1", [A.projectPhaseId]);
    const closed = await c.query<{ id: string }>(
      "insert into project_phases (firm_id, project_id, code, name, sort_order, fee_type, status) values ($1, $2, 'SD', 'Schematic Design', 0, 'fixed', 'closed') returning id",
      [A.firmId, A.projectId],
    );
    const pick = async (sql: string, p: unknown[] = []) => (await c.query<{ id: string }>(sql, [A.firmId, ...p])).rows[0].id;
    return {
      closedPhase: closed.rows[0].id,
      meetings: await pick("select id from activities where firm_id = $1 and applies_to = 'project' order by sort_order limit 1"),
      marketing: await pick("select id from overhead_categories where firm_id = $1 and name = 'Marketing'"),
      admin: await pick("select id from overhead_categories where firm_id = $1 and name = 'Administration'"),
      proposals: await pick("select id from activities where firm_id = $1 and name = 'Proposals'"),
      holiday: await pick("select id from overhead_categories where firm_id = $1 and code = 'HOL'"),
      holidayAct: await pick("select id from activities where firm_id = $1 and name = 'Holiday'"),
    };
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

describe("viewing a week", () => {
  it("creates nothing on view and shows the due date", async () => {
    const v = await loadWeekCore(bm, "2026-10-26");
    expect(v.timesheetId).toBeNull();
    expect(v.rows).toEqual([]);
    expect(v.dueLabel).toBe("Mon Nov 2, 9:00 AM");
    expect(await q("select id from timesheets where week_start = '2026-10-26'")).toHaveLength(0);
  });

  it("a Friday 5:00 PM due date reads Fri Oct 16, 5:00 PM", async () => {
    const v = await loadWeekCore({ ...bm, lockDay: 5, dueTime: "17:00:00" }, WEEK);
    expect(v.dueLabel).toBe("Fri Oct 16, 5:00 PM");
  });
});

describe("rows", () => {
  it("choosing a project picks its current phase; closed phases are offered disabled", async () => {
    const rowId = await newRow(klA);
    const v = ok(await updateRowCore(klA, { rowId, change: { type: "pick", pick: { kind: "project", projectId: A.projectId } } }));
    const row = v.rows.find((r) => r.id === rowId)!;
    expect(row.rowType).toBe("project");
    expect(row.projectPhaseId).toBe(A.projectPhaseId);
    expect(row.activityId).toBeNull();
    expect(row.billable).toBe(true);
    const opts = v.options.phases[A.projectId];
    expect(opts.find((o) => o.id === A.projectPhaseId)?.label).toBe("Design Development · current");
    expect(opts.find((o) => o.id === ids.closedPhase)).toMatchObject({ label: "Schematic Design · closed", closed: true });
  });

  it("the server refuses a closed phase", async () => {
    const rowId = await newRow(klA);
    ok(await updateRowCore(klA, { rowId, change: { type: "pick", pick: { kind: "project", projectId: A.projectId } } }));
    const r = await updateRowCore(klA, { rowId, change: { type: "phase", id: ids.closedPhase } });
    expect(r).toMatchObject({ ok: false, error: "That phase is closed. Pick an open phase." });
    const [row] = await q<{ project_phase_id: string }>("select project_phase_id from timesheet_rows where id = $1", [rowId]);
    expect(row.project_phase_id).toBe(A.projectPhaseId);
  });

  it("changing an overhead phase clears an activity from the old one", async () => {
    const rowId = await newRow(klA);
    ok(await updateRowCore(klA, { rowId, change: { type: "pick", pick: { kind: "overhead" } } }));
    ok(await updateRowCore(klA, { rowId, change: { type: "phase", id: ids.marketing } }));
    let v = ok(await updateRowCore(klA, { rowId, change: { type: "activity", id: ids.proposals } }));
    expect(v.rows.find((r) => r.id === rowId)?.activityId).toBe(ids.proposals);
    v = ok(await updateRowCore(klA, { rowId, change: { type: "phase", id: ids.admin } }));
    expect(v.rows.find((r) => r.id === rowId)?.activityId).toBeNull();
    expect(v.options.overhead.find((c) => c.id === ids.admin)?.activities.map((a) => a.name)).toEqual([
      "Admin & IT",
      "Accounting & billing",
      "Office management",
    ]);
  });

  it("an activity from another phase is refused", async () => {
    const rowId = await newRow(klA);
    ok(await updateRowCore(klA, { rowId, change: { type: "pick", pick: { kind: "overhead" } } }));
    ok(await updateRowCore(klA, { rowId, change: { type: "phase", id: ids.admin } }));
    expect(await updateRowCore(klA, { rowId, change: { type: "activity", id: ids.proposals } })).toMatchObject({ ok: false });
  });

  it("leave with one activity picks it, and is never billable", async () => {
    const rowId = await newRow(klA);
    const v = ok(await updateRowCore(klA, { rowId, change: { type: "pick", pick: { kind: "leave", categoryId: ids.holiday } } }));
    expect(v.rows.find((r) => r.id === rowId)).toMatchObject({ rowType: "leave", activityId: ids.holidayAct, billable: false });
    expect(await updateRowCore(klA, { rowId, change: { type: "billable", value: true } })).toMatchObject({
      ok: false,
      error: "Overhead and leave are always non-billable.",
    });
  });

  it("hours can't go on a row nobody has picked yet", async () => {
    const rowId = await newRow(klA);
    expect(await setHoursCore(klA, { rowId, workDate: "2026-10-12", hours: 2 })).toMatchObject({ ok: false });
  });
});

describe("hours", () => {
  let rowId: string;
  beforeAll(async () => {
    rowId = await newRow(bm, "2026-09-28");
    ok(await updateRowCore(bm, { rowId, change: { type: "pick", pick: { kind: "project", projectId: A.projectId } } }));
  });

  it("saves, changes and clears a day", async () => {
    let v = ok(await setHoursCore(bm, { rowId, workDate: "2026-09-29", hours: 1.5 }));
    expect(v.rows.find((r) => r.id === rowId)?.hours[1]).toBe(1.5);
    v = ok(await setHoursCore(bm, { rowId, workDate: "2026-09-29", hours: 2.25 }));
    expect(v.rows.find((r) => r.id === rowId)?.hours[1]).toBe(2.25);
    v = ok(await setHoursCore(bm, { rowId, workDate: "2026-09-29", hours: null }));
    expect(v.rows.find((r) => r.id === rowId)?.hours[1]).toBe(0);
    const live = await q("select id from time_entries where timesheet_row_id = $1 and archived_at is null", [rowId]);
    expect(live).toHaveLength(0);
  });

  it("refuses 1.3 (not a quarter hour), a date outside the week and a negative", async () => {
    expect((await setHoursCore(bm, { rowId, workDate: "2026-09-29", hours: 1.3 })).ok).toBe(false);
    expect((await setHoursCore(bm, { rowId, workDate: "2026-10-05", hours: 1 })).ok).toBe(false);
    expect((await setHoursCore(bm, { rowId, workDate: "2026-09-29", hours: -2 })).ok).toBe(false);
  });

  it("a day can't pass 24 h across rows, and the error returns the week", async () => {
    const other = await newRow(bm, "2026-09-28");
    ok(await updateRowCore(bm, { rowId: other, change: { type: "pick", pick: { kind: "overhead" } } }));
    ok(await setHoursCore(bm, { rowId, workDate: "2026-09-30", hours: 20 }));
    const r = await setHoursCore(bm, { rowId: other, workDate: "2026-09-30", hours: 5 });
    expect(r).toMatchObject({ ok: false, error: "Sep 30 would total 25 h. A day can't exceed 24 h." });
    expect(r.data?.rows.find((x) => x.id === other)?.hours[2]).toBe(0);
  });

  it("toggling billing moves the row's hours with it", async () => {
    ok(await setHoursCore(bm, { rowId, workDate: "2026-10-01", hours: 3 }));
    ok(await updateRowCore(bm, { rowId, change: { type: "billable", value: false } }));
    const rows = await q<{ billable: boolean }>("select billable from time_entries where timesheet_row_id = $1 and archived_at is null", [rowId]);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((e) => e.billable === false)).toBe(true);
  });

  it("removing a row archives it and its hours", async () => {
    const v = ok(await removeRowCore(bm, { rowId }));
    expect(v.rows.find((r) => r.id === rowId)).toBeUndefined();
    const live = await q("select id from time_entries where timesheet_row_id = $1 and archived_at is null", [rowId]);
    expect(live).toHaveLength(0);
  });
});

describe("submit and recall", () => {
  it("blocks a row with hours and no activity", async () => {
    const week = "2026-09-21";
    const rowId = await newRow(klA, week);
    ok(await updateRowCore(klA, { rowId, change: { type: "pick", pick: { kind: "project", projectId: A.projectId } } }));
    ok(await setHoursCore(klA, { rowId, workDate: week, hours: 3 }));
    expect(await submitTimesheetCore(klA, { weekStart: week })).toMatchObject({
      ok: false,
      error: "1 row needs a phase and an activity before you can submit.",
    });
  });

  it("blocks an empty week", async () => {
    const week = "2026-09-14";
    await newRow(klA, week);
    expect(await submitTimesheetCore(klA, { weekStart: week })).toMatchObject({ ok: false, error: "Add your hours before submitting." });
  });

  it("blocks a week that hasn't started", async () => {
    const next = addDays(weekStartOf(todayIn("America/New_York"), 1), 7);
    const rowId = await newRow(klA, next);
    ok(await updateRowCore(klA, { rowId, change: { type: "pick", pick: { kind: "project", projectId: A.projectId } } }));
    ok(await updateRowCore(klA, { rowId, change: { type: "activity", id: ids.meetings } }));
    ok(await setHoursCore(klA, { rowId, workDate: next, hours: 2 }));
    expect(await submitTimesheetCore(klA, { weekStart: next })).toMatchObject({
      ok: false,
      error: "You can't submit a week that hasn't started.",
    });
  });

  it("a team member's sheet goes to the team leader; empty rows are dropped; it locks", async () => {
    const week = "2026-08-31";
    const rowId = await newRow(klA, week);
    await newRow(klA, week); // stays empty
    ok(await updateRowCore(klA, { rowId, change: { type: "pick", pick: { kind: "project", projectId: A.projectId } } }));
    ok(await updateRowCore(klA, { rowId, change: { type: "activity", id: ids.meetings } }));
    ok(await setHoursCore(klA, { rowId, workDate: week, hours: 8 }));
    const v = ok(await submitTimesheetCore(klA, { weekStart: week }));
    expect(v.status).toBe("submitted");
    expect(v.reviewer).toBe("TT"); // the owner: "Time Test"
    expect(v.canRecall).toBe(true);
    expect(v.rows.map((r) => r.id)).toEqual([rowId]);
    const [sheet] = await q<{ reviewer_membership_id: string; submitted_at: Date }>(
      "select reviewer_membership_id, submitted_at from timesheets where id = $1",
      [v.timesheetId],
    );
    expect(sheet.reviewer_membership_id).toBe(A.membershipId);
    expect(sheet.submitted_at).not.toBeNull();
    const logs = await q("select id from activity_log where entity_id = $1 and action = 'status_changed'", [v.timesheetId]);
    expect(logs).toHaveLength(1);
    expect(await setHoursCore(klA, { rowId, workDate: week, hours: 4 })).toMatchObject({
      ok: false,
      error: "This timesheet is submitted and can't be changed.",
    });

    // Recall returns it to draft.
    const back = ok(await recallTimesheetCore(klA, { weekStart: week }));
    expect(back.status).toBe("draft");
    expect(back.editable).toBe(true);
  });

  it("the team leader's own sheet goes straight to a principal", async () => {
    const week = "2026-08-24";
    const rowId = await newRow(bm, week);
    ok(await updateRowCore(bm, { rowId, change: { type: "pick", pick: { kind: "project", projectId: A.projectId } } }));
    ok(await updateRowCore(bm, { rowId, change: { type: "activity", id: ids.meetings } }));
    ok(await setHoursCore(bm, { rowId, workDate: week, hours: 8 }));
    const v = ok(await submitTimesheetCore(bm, { weekStart: week }));
    expect(v.status).toBe("leader_approved");
    expect(v.reviewer).toBeNull();
    expect(v.canRecall).toBe(true);
  });

  it("can't recall once the team leader has approved", async () => {
    const week = "2026-08-17";
    const rowId = await newRow(klA, week);
    ok(await updateRowCore(klA, { rowId, change: { type: "pick", pick: { kind: "project", projectId: A.projectId } } }));
    ok(await updateRowCore(klA, { rowId, change: { type: "activity", id: ids.meetings } }));
    ok(await setHoursCore(klA, { rowId, workDate: week, hours: 8 }));
    const v = ok(await submitTimesheetCore(klA, { weekStart: week }));
    await q("update timesheets set status = 'leader_approved', leader_approved_at = now(), leader_approved_by = $2 where id = $1", [
      v.timesheetId,
      A.userId,
    ]);
    const after = await loadWeekCore(klA, week);
    expect(after.canRecall).toBe(false);
    expect(after.leaderApprovedBy).toBe("TT");
    expect(await recallTimesheetCore(klA, { weekStart: week })).toMatchObject({ ok: false, error: "This timesheet can't be recalled now." });
  });

  it("requires notes on billable days when the firm says so", async () => {
    const week = "2026-08-10";
    const rowId = await newRow(klA, week);
    ok(await updateRowCore(klA, { rowId, change: { type: "pick", pick: { kind: "project", projectId: A.projectId } } }));
    ok(await updateRowCore(klA, { rowId, change: { type: "activity", id: ids.meetings } }));
    ok(await setHoursCore(klA, { rowId, workDate: week, hours: 8 }));
    expect(await submitTimesheetCore({ ...klA, billableNotesRequired: true }, { weekStart: week })).toMatchObject({
      ok: false,
      error: "1 billable day needs a note before you can submit.",
    });
  });
});

describe("who can touch what", () => {
  let bmRow: string;
  beforeAll(async () => {
    bmRow = await newRow(bm, "2026-08-03");
  });

  it("another person's row is not found", async () => {
    expect(await setHoursCore(klA, { rowId: bmRow, workDate: "2026-08-03", hours: 1 })).toMatchObject({
      ok: false,
      error: "That timesheet wasn't found.",
    });
    expect(await removeRowCore(klA, { rowId: bmRow })).toMatchObject({ ok: false, error: "That timesheet wasn't found." });
  });

  it("another firm's row is not found", async () => {
    const bActor = actorFor(B, B, { member: { appRole: "owner", active: true } });
    expect(await updateRowCore(bActor, { rowId: bmRow, change: { type: "billable", value: false } })).toMatchObject({ ok: false });
  });

  it("no payload carries rates", async () => {
    const v = await loadWeekCore(bm, "2026-08-24");
    const json = JSON.stringify(v);
    expect(json).not.toMatch(/bill_rate_cents|cost_rate_cents|billRateCents|costRateCents/);
  });

  it("a week far in the future can't be written", async () => {
    const far = addDays(weekStartOf(todayIn("America/New_York"), 1), 7 * 9);
    expect(await addRowCore(bm, { weekStart: far })).toMatchObject({ ok: false, error: "That isn't a week you can change." });
    expect(await addRowCore(bm, { weekStart: "2026-10-14" })).toMatchObject({ ok: false, error: "That isn't a week you can change." });
  });
});

describe("logged time feeds the other screens (decision #20)", () => {
  it("counts drafts on the project, blocks archiving the phase, and costs hours at the rate on the work date", async () => {
    await q("update memberships set firm_role_id = $1 where id = $2", [A.firmRoleId, kl.membershipId]);
    const week = "2026-07-27";
    const rowId = await newRow(klA, week);
    ok(await updateRowCore(klA, { rowId, change: { type: "pick", pick: { kind: "project", projectId: A.projectId } } }));
    ok(await setHoursCore(klA, { rowId, workDate: week, hours: 3 }));

    const { withFirm } = await import("@/db/tenant");
    const { costedHours, hoursByPhase, hoursByPhaseAndPerson, phasesWithTime } = await import("./used");
    const [byPhase, byPerson, has, costed] = await withFirm(A.firmId, async (db) => [
      await hoursByPhase(db, [A.projectId]),
      await hoursByPhaseAndPerson(db, A.projectId),
      await phasesWithTime(db, [A.projectPhaseId, ids.closedPhase]),
      await costedHours(db, A.projectId),
    ] as const);
    expect(byPhase.get(A.projectPhaseId)).toBeGreaterThanOrEqual(3);
    expect(byPerson.find((p) => p.membershipId === kl.membershipId && p.phaseId === A.projectPhaseId)?.hours).toBeGreaterThanOrEqual(3);
    expect(has.has(A.projectPhaseId)).toBe(true);
    expect(has.has(ids.closedPhase)).toBe(false);
    // Kat is a Designer: $44 cost from 2026-01-01.
    expect(costed.find((c) => c.membershipId === kl.membershipId)?.rateCents).toBe(4400);
  });
});
