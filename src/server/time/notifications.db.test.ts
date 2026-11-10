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
import { listNotificationsCore, markAllReadCore, markReadCore, unreadCountCore } from "@/server/notifications/inbox";
import { type ApprovalActor, approvalAccess, approveStepCore, returnTimesheetCore } from "./approval";
import { loadQueue } from "./approval-read";
import { nudgeCore, remindAllCore, runRemindersForFirm, sendReminderCore } from "./reminders";
import { loadWeekOverview } from "./week-overview";
import { submitTimesheetCore } from "./write";

// Notifications, week overview, reminders and nudges against the real
// database (timesheet-approval spec, 1.7 C acceptance tests).
//
// Cast: BM (owner, principal, PIC of 2026-001), PD (principal, PIC of
// 2026-017), JR (leads Medical: JR, KL, DS), MW (admin), CF and NB (no team).

let pool: Pool;
let A: TestFirm;
const users: string[] = [];
let pd: TestMember, jr: TestMember, kl: TestMember, ds: TestMember, mw: TestMember, cf: TestMember, nb: TestMember;
let p2: { projectId: string; phaseId: string };
const WEEK = "2026-10-12";

const actorFor = (m: { userId: string; membershipId: string }, appRole: ApprovalActor["member"]["appRole"] = "staff"): ApprovalActor => ({
  firmId: A.firmId,
  userId: m.userId,
  membershipId: m.membershipId,
  timezone: "America/New_York",
  weekStartsOn: 1,
  lockDay: 1,
  dueTime: "09:00:00",
  notesRule: "optional",
  member: { appRole, active: true },
});
let BM: ApprovalActor, PD: ApprovalActor, JR: ApprovalActor, KL: ApprovalActor, DS: ApprovalActor, MW: ApprovalActor;

const q = <T extends Record<string, unknown>>(text: string, params: unknown[] = []) =>
  asFirm(pool, A.firmId, async (c) => (await c.query<T>(text, params)).rows);
const me = (m: { membershipId: string }) => ({ firmId: A.firmId, membershipId: m.membershipId, active: true });
const inbox = async (m: { membershipId: string }) => (await listNotificationsCore(me(m), {})).items;

async function setRoute(...kinds: string[]) {
  await q("update review_steps set archived_at = now() where firm_id = $1 and archived_at is null", [A.firmId]);
  for (const [i, kind] of kinds.entries())
    await q("insert into review_steps (firm_id, sort_order, kind) values ($1, $2, $3)", [A.firmId, i, kind]);
}

/** A complete week (8 h Mon–Fri on 2026-001, or 2026-017 for p2), submitted by its owner. */
async function submitted(who: ApprovalActor, week: string, lines: { p2?: boolean; hours: number[] }[] = [{ hours: [8, 8, 8, 8, 8] }]) {
  await asFirm(pool, A.firmId, async (c) => {
    const s = await c.query<{ id: string }>(
      "insert into timesheets (firm_id, membership_id, week_start) values ($1, $2, $3) returning id",
      [A.firmId, who.membershipId, week],
    );
    for (const [i, l] of lines.entries()) {
      const projectId = l.p2 ? p2.projectId : A.projectId;
      const phaseId = l.p2 ? p2.phaseId : A.projectPhaseId;
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

beforeAll(async () => {
  requireDbEnv();
  pool = createOwnerPool();
  A = await createTestFirm(pool, "Notif");
  pd = await addTestMember(pool, A, { firstName: "Pat", lastName: "Dunn", role: "project_manager" });
  jr = await addTestMember(pool, A, { firstName: "Jo", lastName: "Reyes", role: "staff" });
  kl = await addTestMember(pool, A, { firstName: "Kat", lastName: "Lee", role: "staff", title: "Designer" });
  ds = await addTestMember(pool, A, { firstName: "Dan", lastName: "Sole", role: "staff" });
  mw = await addTestMember(pool, A, { firstName: "Mia", lastName: "Wong", role: "admin" });
  cf = await addTestMember(pool, A, { firstName: "Cal", lastName: "Fox", role: "staff" });
  nb = await addTestMember(pool, A, { firstName: "Nia", lastName: "Bell", role: "staff" });
  users.push(pd.userId, jr.userId, kl.userId, ds.userId, mw.userId, cf.userId, nb.userId);
  BM = actorFor(A, "owner");
  PD = actorFor(pd, "project_manager");
  JR = actorFor(jr);
  KL = actorFor(kl);
  DS = actorFor(ds);
  MW = actorFor(mw, "admin");
  await asFirm(pool, A.firmId, async (c) => {
    await c.query("update users set first_name = 'Blake', last_name = 'Mason', initials = 'BM' where id = $1", [A.userId]);
    // Everyone joined before the test weeks.
    await c.query("update memberships set created_at = '2026-01-01' where firm_id = $1", [A.firmId]);
    await c.query("update memberships set is_principal = true where id = any($1::uuid[])", [[A.membershipId, pd.membershipId]]);
    const team = await c.query<{ id: string }>(
      "insert into teams (firm_id, name, leader_membership_id, sort_order) values ($1, 'Medical', $2, 1) returning id",
      [A.firmId, jr.membershipId],
    );
    await c.query("update memberships set team_id = $1 where id = any($2::uuid[])", [
      team.rows[0].id,
      [jr.membershipId, kl.membershipId, ds.membershipId],
    ]);
    await c.query("update memberships set firm_role_id = $1 where firm_id = $2", [A.firmRoleId, A.firmId]);
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
    await removeTestUsers(pool, users);
    await pool.end();
  }
  await closeDb();
});

describe("notifications from approvals", () => {
  it("KL submits and it waits on BM: BM has one unread review_waiting linking to the detail page", async () => {
    await setRoute("principal_in_charge");
    const id = await submitted(KL, "2026-08-03");
    const items = await inbox(BM);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "review_waiting",
      title: "Kat Lee's timesheet is waiting for you",
      body: "Week of Aug 3 – 9 · 40 h",
      link: `/app/time/approvals/${id}`,
      read: false,
    });
    expect(await unreadCountCore(me(BM))).toBe(1);

    // Opening it marks it read; someone else can't mark it.
    expect(await markReadCore(me(KL), { id: items[0].id })).toEqual({ ok: false });
    expect(await unreadCountCore(me(BM))).toBe(1);
    expect(await markReadCore(me(BM), { id: items[0].id })).toEqual({ ok: true });
    expect(await unreadCountCore(me(BM))).toBe(0);
    // Nobody else got it.
    expect(await inbox(KL)).toEqual([]);
    expect(await inbox(PD)).toEqual([]);

    // Approved: KL is told.
    expect((await approveStepCore(BM, { timesheetId: id })).ok).toBe(true);
    expect((await inbox(KL))[0]).toMatchObject({ kind: "timesheet_approved", title: "Your timesheet for Aug 3 – 9 was approved" });
  });

  it("two PICs: BM approving tells nobody new; standing in tells BM and PD", async () => {
    await setRoute("principal_in_charge");
    await markAllReadCore(me(PD));
    const before = (await inbox(PD)).length;
    const id = await submitted(KL, "2026-08-10", [{ hours: [8, 8, 0, 0, 0] }, { p2: true, hours: [0, 0, 8, 8, 8] }]);
    expect((await inbox(PD)).length).toBe(before + 1);
    expect((await approveStepCore(BM, { timesheetId: id })).ok).toBe(true);
    expect((await inbox(PD)).length).toBe(before + 1);

    const other = await submitted(KL, "2026-08-17", [{ hours: [8, 8, 0, 0, 0] }, { p2: true, hours: [0, 0, 8, 8, 8] }]);
    expect((await approveStepCore(MW, { timesheetId: other, onBehalf: true, note: "Both out" })).ok).toBe(true);
    for (const who of [BM, PD]) {
      expect((await inbox(who))[0].title).toBe("Mia Wong approved Kat Lee's timesheet for you (week of Aug 17).");
    }
  });

  it("route [Team leader, Any principal]: after JR, every active principal is told", async () => {
    await setRoute("team_leader", "any_principal");
    const id = await submitted(KL, "2026-08-24");
    expect((await inbox(JR))[0].link).toBe(`/app/time/approvals/${id}`);
    expect((await approveStepCore(JR, { timesheetId: id })).ok).toBe(true);
    expect((await inbox(BM))[0].link).toBe(`/app/time/approvals/${id}`);
    expect((await inbox(PD))[0].link).toBe(`/app/time/approvals/${id}`);
  });

  it("a return tells KL, with the note", async () => {
    await setRoute("principal_in_charge");
    const id = await submitted(KL, "2026-08-31");
    expect((await returnTimesheetCore(BM, { timesheetId: id, note: "Split SD hours." })).ok).toBe(true);
    expect((await inbox(KL))[0]).toMatchObject({
      kind: "timesheet_returned",
      title: "Your timesheet for Aug 31 – Sep 6 was returned",
      body: "Split SD hours.",
      link: "/app/time/week/2026-08-31",
    });
  });
});

describe("week overview, reminders and nudges", () => {
  const LATE = new Date("2026-10-19T18:00:00Z"); // Mon Oct 19, 2 PM New York: past due.

  beforeAll(async () => {
    await setRoute("team_leader", "principal_in_charge");
    await submitted(JR, WEEK); // JR leads his own team → waits on BM (PIC)
    await submitted(DS, WEEK); // waits on JR
    await submitted(KL, WEEK); // waits on JR
  });

  it("BM sees everyone: CF and NB not submitted, KPI 2, Remind all (2)", async () => {
    const o = await withFirm(A.firmId, async (db) => loadWeekOverview(db, BM, await approvalAccess(db, BM), WEEK, LATE));
    expect(o.notSubmitted).toBe(4); // CF, NB, MW and PD haven't submitted either
    const medical = o.cards.find((c) => c.name === "Medical")!;
    expect(medical.rows.map((r) => [r.person.name, r.badge.label])).toEqual([
      ["Kat Lee", "Waiting on Jo Reyes"],
      ["Jo Reyes", "Waiting on you"],
      ["Dan Sole", "Waiting on Jo Reyes"],
    ]);
    expect(medical.summary).toBe("1 waiting on you · 2 with others");
    const none = o.cards.find((c) => c.teamId === null)!;
    expect(none.rows.find((r) => r.person.name === "Cal Fox")?.badge).toEqual({ label: "Not submitted", tone: "orange", look: "diamond" });
    expect(none.remindable).toBe(4);
    // Nudge JR on DS's row (owner).
    expect(medical.rows.find((r) => r.person.name === "Dan Sole")?.nudge?.label).toBe("Jo Reyes");
  });

  it("JR (team leader, not a principal) sees only his team", async () => {
    const o = await withFirm(A.firmId, async (db) => loadWeekOverview(db, JR, await approvalAccess(db, JR), WEEK, LATE));
    expect(o.cards.map((c) => c.name)).toEqual(["Medical"]);
    expect(o.cards[0].rows.map((r) => r.person.name).sort()).toEqual(["Dan Sole", "Kat Lee"]);
    // He can remind his team but not CF.
    expect(await sendReminderCore(JR, { membershipId: cf.membershipId, weekStart: WEEK }, LATE)).toMatchObject({ ok: false });
  });

  it("BM reminds CF: one notification, a log entry, then blocked for 12 h", async () => {
    expect(await sendReminderCore(BM, { membershipId: cf.membershipId, weekStart: WEEK }, LATE)).toMatchObject({ ok: true });
    const items = await inbox(cf);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "timesheet_reminder",
      title: "Your timesheet for Oct 12 – 18 is overdue",
      body: "You haven't logged any hours yet.",
      link: `/app/time/week/${WEEK}`,
    });
    const logs = await q<{ changes: { week_start: string; automatic: boolean } }>(
      "select changes from activity_log where firm_id = $1 and entity_id = $2 and action = 'reminder_sent'",
      [A.firmId, cf.membershipId],
    );
    expect(logs.map((l) => l.changes)).toEqual([{ week_start: WEEK, automatic: false }]);
    expect(await sendReminderCore(BM, { membershipId: cf.membershipId, weekStart: WEEK }, LATE)).toEqual({
      ok: false,
      error: "Already reminded in the last 12 hours.",
    });
    const o = await withFirm(A.firmId, async (db) => loadWeekOverview(db, BM, await approvalAccess(db, BM), WEEK, LATE));
    expect(o.cards.find((c) => c.teamId === null)?.rows.find((r) => r.person.name === "Cal Fox")?.remind?.sentAt).not.toBeNull();
    // Someone who submitted can't be reminded.
    expect(await sendReminderCore(BM, { membershipId: kl.membershipId, weekStart: WEEK }, LATE)).toEqual({
      ok: false,
      error: "That timesheet is already in.",
    });
  });

  it("Remind all skips CF (reminded an hour ago)", async () => {
    const r = await remindAllCore(BM, { weekStart: WEEK, teamId: null }, new Date(LATE.getTime() + 60 * 60 * 1000));
    expect(r).toMatchObject({ ok: true, sent: 3 });
    expect(await inbox(cf)).toHaveLength(1);
    expect(await inbox(nb)).toHaveLength(1);
  });

  it("BM nudges JR: one notification with his count; staff can't nudge", async () => {
    const before = (await inbox(JR)).length;
    expect(await nudgeCore(BM, { membershipIds: [jr.membershipId] }, LATE)).toMatchObject({ ok: true, sent: 1 });
    const items = await inbox(JR);
    expect(items.length).toBe(before + 1);
    expect(items[0]).toMatchObject({ kind: "approver_nudge", title: "You have 2 timesheets waiting for approval" });
    expect(await nudgeCore(DS, { membershipIds: [jr.membershipId] }, LATE)).toMatchObject({ ok: false });
  });

  it("the cron at 09:05 and 10:05 Mon Oct 19 reminds each missing person once", async () => {
    const at905 = new Date("2026-10-19T13:05:00Z");
    const first = await runRemindersForFirm(A.firmId, at905);
    // CF, NB, MW, PD and BM himself (manual reminders don't count).
    expect(first.reminders).toBe(5);
    expect(first.summaries).toBeGreaterThan(0);
    const second = await runRemindersForFirm(A.firmId, new Date("2026-10-19T14:05:00Z"));
    expect(second).toEqual({ reminders: 0, summaries: 0 });
    const auto = await q(
      "select entity_id from activity_log where firm_id = $1 and action = 'reminder_sent' and changes->>'automatic' = 'true'",
      [A.firmId],
    );
    expect(auto).toHaveLength(5);
  });

  it("the queue shows full names: 'Also waiting on' and the person", async () => {
    await setRoute("principal_in_charge");
    const id = await submitted(KL, "2026-09-07", [{ hours: [8, 8, 0, 0, 0] }, { p2: true, hours: [0, 0, 8, 8, 8] }]);
    const queue = await withFirm(A.firmId, async (db) => loadQueue(db, BM, await approvalAccess(db, BM)));
    const item = queue.weeks.flatMap((w) => w.items).find((i) => i.timesheetId === id)!;
    expect(item.person.name).toBe("Kat Lee");
    expect(item.step?.note).toBe("Also waiting on Pat Dunn");
  });
});
