import type { Pool } from "@neondatabase/serverless";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { withFirm } from "@/db/tenant";
import {
  type TestFirm,
  type TestMember,
  addTestInvoices,
  addTestMember,
  addTestTime,
  asFirm,
  createOwnerPool,
  createTestFirm,
  removeTestFirm,
  removeTestUsers,
  requireDbEnv,
} from "@/db/test-helpers";
import { boardColumns } from "@/lib/calc/home";
import { addDays } from "@/lib/calc/timesheet";
import { approvalAccess, approveStepCore } from "@/server/time/approval";
import { queueCount } from "@/server/time/approval-read";
import type { TimeActor } from "@/server/time/write";
import { submitTimesheetCore } from "@/server/time/write";
import { notSubmittedKpi } from "@/server/time/week-overview";
import { loadActiveCount, loadBoard, loadDue, loadFirmHealth, loadOutstanding, loadWaiting, loadYourTime } from "./home";

// Home against the real database (home spec, acceptance tests). The pure
// rules are in src/lib/calc/home.test.ts.
//
// Firm A: the owner (principal, PM and PIC of 2026-001, which has 2 h logged
// and a sent invoice); PM (PM and PIC of 2026-002, current phase DD; on the
// team of 2026-003, whose current phase is a custom "P2A"; PM of closed
// 2026-004); DS (staff, on the team of 2026-003). 2026-005 is on hold with
// its current phase on an optional template.

let pool: Pool;
let A: TestFirm;
let B: TestFirm;
let pm: TestMember;
let ds: TestMember;
const users: string[] = [];
const ids: Record<string, string> = {};

const actorFor = (firm: TestFirm, m: { userId: string; membershipId: string }, appRole: TimeActor["member"]["appRole"]): TimeActor => ({
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
let OWNER: TimeActor, PM: TimeActor, DS: TimeActor, B_OWNER: TimeActor;

const q = <T extends Record<string, unknown>>(text: string, params: unknown[] = []) =>
  asFirm(pool, A.firmId, async (c) => (await c.query<T>(text, params)).rows);

/** A project with phases [code, name, status]; returns its id. */
async function project(number: string, pmId: string, phases: [string, string, string][], status = "active", principalId = pmId) {
  const [p] = await q<{ id: string }>(
    "insert into projects (firm_id, number, name, client_company_id, project_type, scope_kind, status, principal_membership_id, pm_membership_id) values ($1, $2, $3, $4, 'Retail', 'tenant_upfit', $5, $6, $7) returning id",
    [A.firmId, number, `Project ${number}`, A.companyId, status, principalId, pmId],
  );
  for (const [i, [code, name, st]] of phases.entries())
    await q("insert into project_phases (firm_id, project_id, code, name, sort_order, fee_type, fee_cents, status) values ($1, $2, $3, $4, $5, 'fixed', 100000, $6)", [
      A.firmId,
      p.id,
      code,
      name,
      i + 1,
      st,
    ]);
  return p.id;
}

beforeAll(async () => {
  requireDbEnv();
  pool = createOwnerPool();
  A = await createTestFirm(pool, "HomeA");
  B = await createTestFirm(pool, "HomeB");
  pm = await addTestMember(pool, A, { firstName: "Jane", lastName: "Reed", role: "project_manager" });
  ds = await addTestMember(pool, A, { firstName: "Dan", lastName: "Shaw", role: "staff" });
  users.push(pm.userId, ds.userId);
  OWNER = actorFor(A, A, "owner");
  PM = actorFor(A, pm, "project_manager");
  DS = actorFor(A, ds, "staff");
  B_OWNER = actorFor(B, B, "owner");

  await q("update memberships set is_principal = true where id = any($1::uuid[])", [[A.membershipId, pm.membershipId]]);
  await q("update project_phases set budget_hours = 10 where id = $1", [A.projectPhaseId]);
  await q("insert into phase_templates (firm_id, code, name, is_optional, sort_order) values ($1, 'OPT', 'Test optional', true, 1)", [A.firmId]);

  ids.p2 = await project("2026-002", pm.membershipId, [
    ["PD", "Pre-Design", "complete"],
    ["DD", "Design Development", "current"],
  ]);
  ids.p3 = await project("2026-003", A.membershipId, [["P2A", "Phase 2A", "current"]]);
  ids.p4 = await project("2026-004", pm.membershipId, [["SD", "Schematic Design", "current"]], "closed");
  ids.p5 = await project("2026-005", A.membershipId, [["OPT", "Test optional", "upcoming"]], "on_hold");
  for (const m of [pm.membershipId, ds.membershipId])
    await q("insert into project_members (firm_id, project_id, membership_id) values ($1, $2, $3)", [A.firmId, ids.p3, m]);

  // The owner's draft week of Oct 12 (2 h on 2026-001) and a sent invoice for it.
  const time = await addTestTime(pool, A);
  await addTestInvoices(pool, A, time);
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

const board = (who: TimeActor) => withFirm(who.firmId, (db) => loadBoard(db, who));

describe("My projects", () => {
  it("counts the firm's active projects", async () => {
    expect(await withFirm(A.firmId, loadActiveCount)).toBe(3); // 001, 002, 003
  });

  it("shows a PM their projects in the right columns, never closed ones", async () => {
    const b = await board(PM);
    expect(b.canToggle).toBe(false);
    expect(b.cards.map((c) => c.number).sort()).toEqual(["2026-002", "2026-003"]);
    const cols = boardColumns(b.templates, b.cards);
    expect(cols.find((c) => c.key === "dd")?.cards.map((c) => c.number)).toEqual(["2026-002"]);
    const other = cols[cols.length - 1];
    expect(other.name).toBe("Other");
    expect(other.cards.map((c) => c.phaseName)).toEqual(["Phase 2A"]);
    expect(cols.some((c) => c.name === "Test optional")).toBe(false);
  });

  it("sends billed % to a PM only on projects they run", async () => {
    const b = await board(PM);
    expect("billedPct" in b.cards.find((c) => c.number === "2026-002")!).toBe(true);
    expect("billedPct" in b.cards.find((c) => c.number === "2026-003")!).toBe(false);
  });

  it("sends staff hours but no billed % at all", async () => {
    const b = await board(DS);
    expect(b.cards.map((c) => c.number)).toEqual(["2026-003"]);
    expect(b.cards.every((c) => !("billedPct" in c))).toBe(true);
    expect(b.cards[0].hours.text).toBe("0 h · no budget");
  });

  it("gives owners every active and on-hold project, marking their own", async () => {
    const b = await board(OWNER);
    expect(b.canToggle).toBe(true);
    expect(b.cards.map((c) => c.number).sort()).toEqual(["2026-001", "2026-002", "2026-003", "2026-005"]);
    expect(b.cards.filter((c) => c.mine).map((c) => c.number).sort()).toEqual(["2026-001", "2026-003", "2026-005"]);
    const p5 = b.cards.find((c) => c.number === "2026-005")!;
    expect(p5.onHold).toBe(true);
    expect(p5.kindLine).toBe("Tenant upfit · Retail");
    // The optional phase's column appears once a card is in it.
    expect(boardColumns(b.templates, b.cards).some((c) => c.name === "Test optional")).toBe(true);
  });

  it("shows hours vs budget and billed % from sent invoices only", async () => {
    const p1 = (await board(OWNER)).cards.find((c) => c.number === "2026-001")!;
    expect(p1.hours.text).toBe("2 of 10 h");
    // $10,000 fee; a sent $10,000 line counts, the draft's line doesn't.
    expect(p1.billedPct).toBe(100);
  });
});

describe("Your time", () => {
  it("shows this week's hours, billable % and status", async () => {
    const t = await withFirm(A.firmId, (db) => loadYourTime(db, OWNER, new Date("2026-10-14T15:00:00Z")));
    expect(t.weekStart).toBe("2026-10-12");
    expect(t.total).toBe(2);
    expect(t.billablePct).toBe(100);
    expect(t.bars.map((b) => b.date)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
    expect(t.statusLine.text).toBe("Not submitted · due Mon Oct 19");
    // No sheet at all for the week before counts as not submitted (rule 4).
    expect(t.banner).toEqual({ text: "Week of Oct 5 not submitted.", weekStart: "2026-10-05" });
  });

  it("warns about last week once its due time has passed", async () => {
    const t = await withFirm(A.firmId, (db) => loadYourTime(db, OWNER, new Date("2026-10-21T15:00:00Z")));
    expect(t.status).toBeNull();
    expect(t.statusLine.text).toBe("Not started · due Mon Oct 26");
    expect(t.banner).toEqual({ text: "Week of Oct 12 not submitted.", weekStart: "2026-10-12" });
  });
});

describe("Waiting on you", () => {
  let sheetId: string;

  beforeAll(async () => {
    // DS logs time on 2026-001 (PIC: owner) and 2026-002 (PIC: PM) and submits.
    const week = "2026-10-05";
    await asFirm(pool, A.firmId, async (c) => {
      const s = await c.query<{ id: string }>("insert into timesheets (firm_id, membership_id, week_start) values ($1, $2, $3) returning id", [
        A.firmId,
        ds.membershipId,
        week,
      ]);
      const phaseOf = async (projectId: string) =>
        (await c.query<{ id: string }>("select id from project_phases where project_id = $1 order by sort_order desc limit 1", [projectId])).rows[0].id;
      for (const [i, projectId] of [A.projectId, ids.p2].entries()) {
        const phaseId = projectId === A.projectId ? A.projectPhaseId : await phaseOf(projectId);
        const row = await c.query<{ id: string }>(
          "insert into timesheet_rows (firm_id, timesheet_id, row_type, project_id, project_phase_id, activity_id, billable, sort_order) values ($1, $2, 'project', $3, $4, $5, true, $6) returning id",
          [A.firmId, s.rows[0].id, projectId, phaseId, A.activityId, i],
        );
        for (let d = 0; d < 5; d++)
          await c.query(
            "insert into time_entries (firm_id, timesheet_id, timesheet_row_id, work_date, project_id, project_phase_id, activity_id, hours, billable) values ($1, $2, $3, $4, $5, $6, $7, 4, true)",
            [A.firmId, s.rows[0].id, row.rows[0].id, addDays(week, d), projectId, phaseId, A.activityId],
          );
      }
    });
    const r = await submitTimesheetCore(DS, { weekStart: week });
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    sheetId = r.data!.timesheetId!;
  });

  it("lists the sheet for each PIC, matching the Approvals tab count", async () => {
    const w = (await withFirm(A.firmId, (db) => loadWaiting(db, PM)))!;
    expect(w.items.map((i) => i.timesheetId)).toEqual([sheetId]);
    expect(w.items[0]).toMatchObject({ total: 40, partlyApproved: false });
    expect(w.items[0].step?.label).toContain("Principal in Charge");
    const tab = await withFirm(A.firmId, async (db) => queueCount(db, PM, await approvalAccess(db, PM)));
    expect(w.count).toBe(tab);
  });

  it("shows Partly approved once the other PIC approves", async () => {
    const r = await approveStepCore(OWNER, { timesheetId: sheetId });
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    const w = (await withFirm(A.firmId, (db) => loadWaiting(db, PM)))!;
    expect(w.items[0].partlyApproved).toBe(true);
    const owner = (await withFirm(A.firmId, (db) => loadWaiting(db, OWNER)))!;
    expect(owner.items.map((i) => i.timesheetId)).not.toContain(sheetId);
  });

  it("is not loaded for someone who can't open the Approvals tab", async () => {
    expect(await withFirm(A.firmId, (db) => loadWaiting(db, DS))).toBeNull();
  });
});

describe("Invoices outstanding", () => {
  it("totals open balances for owners", async () => {
    const o = (await withFirm(A.firmId, (db) => loadOutstanding(db, OWNER, new Date("2026-10-18T15:00:00Z"))))!;
    // The sent $10,000 invoice with $4,000 paid, due Oct 16; the draft is left out.
    expect(o).toMatchObject({ totalCents: 600_000, count: 1, over60: 0 });
    expect(o.rows[0]).toMatchObject({ number: "HomeA-100", flag: "2 days past due" });
    expect(o.buckets.find((b) => b.key === "1_30")?.cents).toBe(600_000);
  });

  it("returns nothing for PMs and staff", async () => {
    expect(await withFirm(A.firmId, (db) => loadOutstanding(db, PM))).toBeNull();
    expect(await withFirm(A.firmId, (db) => loadOutstanding(db, DS))).toBeNull();
  });
});

describe("Firm health", () => {
  beforeAll(async () => {
    // 2026-002's DD (fixed $1,000) is 50% complete and unbilled → $500.
    await q("update project_phases set percent_complete_bp = 5000 where project_id = $1 and code = 'DD'", [ids.p2]);
    // 2026-003 gets an hourly phase with 6 approved hours at $150 → $900,
    // plus 2 non-billable hours that don't count.
    const [phase] = await q<{ id: string }>(
      "insert into project_phases (firm_id, project_id, code, name, sort_order, fee_type, fee_cents, status) values ($1, $2, 'AS', 'Added services', 2, 'hourly', 0, 'current') returning id",
      [A.firmId, ids.p3],
    );
    const [sheet] = await q<{ id: string }>(
      "insert into timesheets (firm_id, membership_id, week_start, status) values ($1, $2, '2026-09-21', 'approved') returning id",
      [A.firmId, pm.membershipId],
    );
    const [row] = await q<{ id: string }>(
      "insert into timesheet_rows (firm_id, timesheet_id, row_type, project_id, project_phase_id, activity_id, billable) values ($1, $2, 'project', $3, $4, $5, true) returning id",
      [A.firmId, sheet.id, ids.p3, phase.id, A.activityId],
    );
    for (const [day, hours, billable] of [["2026-09-21", 4, true], ["2026-09-22", 2, true], ["2026-09-23", 2, false]] as const)
      await q(
        "insert into time_entries (firm_id, timesheet_id, timesheet_row_id, work_date, project_id, project_phase_id, activity_id, hours, billable, bill_rate_cents) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 15000)",
        [A.firmId, sheet.id, row.id, day, ids.p3, phase.id, A.activityId, hours, billable],
      );
    // Owner: 40 h a week, no target; PM: 40 h, target 80%; DS: 24 h, target 70%.
    await q("update memberships set weekly_capacity_hours = 40, target_utilization_bp = null where id = $1", [A.membershipId]);
    await q("update memberships set weekly_capacity_hours = 40, target_utilization_bp = 8000 where id = $1", [pm.membershipId]);
    await q("update memberships set weekly_capacity_hours = 24, target_utilization_bp = 7000 where id = $1", [ds.membershipId]);
  });

  it("gives owners receivables, unbilled work, utilization and late timesheets", async () => {
    const h = (await withFirm(A.firmId, (db) => loadFirmHealth(db, OWNER, new Date("2026-10-18T15:00:00Z"))))!;
    expect(h.receivables).toEqual({ totalCents: 600_000, count: 1, over60: 0 });
    // $500 earned on 2026-002 + $900 of hours on 2026-003. 2026-001 is billed in full.
    expect(h.unbilled).toEqual({ cents: 140_000, projects: 2 });
    // Window Sep 14 – Oct 11: PM's 6 billable approved hours + DS's 40
    // submitted ones (week of Oct 5) = 46 h over (40 + 40 + 24) × 4 = 416 h → 11%.
    // Target: (40 × 80% + 24 × 70%) ÷ 64 = 76.25% → 76%; the owner has none.
    expect(h.utilization).toEqual({ pct: 11, targetPct: 76 });
    // The Approvals tab's own figure.
    const tab = await withFirm(A.firmId, async (db) => notSubmittedKpi(db, OWNER, await approvalAccess(db, OWNER), new Date("2026-10-18T15:00:00Z")));
    expect(h.notSubmitted).toEqual(tab);
  });

  it("returns nothing for PMs and staff", async () => {
    expect(await withFirm(A.firmId, (db) => loadFirmHealth(db, PM))).toBeNull();
    expect(await withFirm(A.firmId, (db) => loadFirmHealth(db, DS))).toBeNull();
  });
});

describe("Due this week", () => {
  // Thursday Oct 15: week of Oct 12 – 18.
  const THU = new Date("2026-10-15T15:00:00Z");

  beforeAll(async () => {
    await q("update project_phases set end_date = '2026-10-09' where project_id = $1 and code = 'DD'", [ids.p2]);
    await q("update project_phases set end_date = '2026-10-16' where project_id = $1 and code = 'P2A'", [ids.p3]);
  });

  it("gives a PM their timesheet, approvals and phases, but no invoices", async () => {
    const d = await withFirm(A.firmId, (db) => loadDue(db, PM, THU));
    expect(d.weekStart).toBe("2026-10-12");
    expect(d.items.map((i) => [i.kind, i.title, i.flag])).toEqual([
      ["phase", "Design Development ends", "6 days late"],
      ["timesheet", "Submit timesheet", "3 days late"],
      ["approvals", "Approve 1 timesheet", ""],
      ["phase", "Phase 2A ends", ""],
    ]);
    expect(d.items.find((i) => i.kind === "timesheet")?.detail).toBe("Week of Oct 5");
  });

  it("adds open invoices for owners", async () => {
    const d = await withFirm(A.firmId, (db) => loadDue(db, OWNER, THU));
    const inv = d.items.find((i) => i.kind === "invoice")!;
    expect(inv).toMatchObject({ title: "Invoice HomeA-100 due", flag: "", date: "2026-10-16" });
    // The owner isn't on 2026-002, so its phase isn't theirs.
    expect(d.items.some((i) => i.title === "Design Development ends")).toBe(false);
  });

  it("gives staff only their own timesheet and phases", async () => {
    const d = await withFirm(A.firmId, (db) => loadDue(db, DS, THU));
    expect(d.items.map((i) => i.kind).sort()).toEqual(["phase"]);
    expect(d.items.some((i) => i.kind === "invoice" || i.kind === "approvals")).toBe(false);
  });
});

describe("tenant isolation", () => {
  it("shows firm B none of firm A's projects, time or invoices", async () => {
    const b = await board(B_OWNER);
    expect(b.cards.map((c) => c.number)).toEqual(["2026-001"]);
    expect(b.cards[0].name).toBe("HomeB Project");
    const t = await withFirm(B.firmId, (db) => loadYourTime(db, B_OWNER, new Date("2026-10-14T15:00:00Z")));
    expect(t.total).toBe(0);
    const o = (await withFirm(B.firmId, (db) => loadOutstanding(db, B_OWNER)))!;
    expect(o.count).toBe(0);
    expect((await withFirm(B.firmId, (db) => loadWaiting(db, B_OWNER)))?.count ?? 0).toBe(0);
    const h = (await withFirm(B.firmId, (db) => loadFirmHealth(db, B_OWNER)))!;
    expect(h.receivables.count).toBe(0);
    expect(h.unbilled).toEqual({ cents: 0, projects: 0 });
    const d = await withFirm(B.firmId, (db) => loadDue(db, B_OWNER, new Date("2026-10-15T15:00:00Z")));
    expect(d.items.some((i) => i.kind === "phase" || i.kind === "invoice")).toBe(false);
  });
});
