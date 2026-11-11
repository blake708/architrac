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
import type { AppRole } from "@/lib/auth/permissions";
import { INVOICE_MESSAGES } from "@/lib/invoices/builder";
import { reopenTimesheetCore } from "@/server/time/approval";
import { freezeSheetRates } from "@/server/time/review";
import {
  createDraftInvoiceCore,
  deleteDraftCore,
  recalculateDraftCore,
  removeLineCore,
  returnToDraftCore,
  saveAdjustmentCore,
  setConsultantPercentCore,
  setPhasePercentCore,
  submitForReviewCore,
  toggleEntryCore,
  updateDraftSettingsCore,
} from "./builder";
import type { InvoiceActor } from "./draft";
import { type BuilderView, loadBuilder, loadInvoicesPage } from "./view";

// The invoice builder against the real database (invoicing spec acceptance
// tests for 1.8 B). Medical Office Building numbers: SD fee $27,900 billed
// to 60 % on A-100; DD $46,500; Permitting NTE $9,300 with $8,200 billed;
// Additional Services hourly.
//
// Cast: BM (owner, Principal in Charge), JR (PM of the project), KL (staff),
// OP (a PM on no project), MW (admin).

let pool: Pool;
let A: TestFirm;
let B: TestFirm;
let jr: TestMember, kl: TestMember, op: TestMember, mw: TestMember;
const ph = { SD: "", DD: "", PERM: "", ADD: "" };
const role = { principal: "", architect: "" };
let draftId = "";
let unapprovedSheet = "";
let approvedSheetBM = "";

const actor = (who: { userId: string; membershipId: string }, appRole: AppRole): InvoiceActor => ({
  firmId: A.firmId,
  firmName: "Test",
  clerkOrgId: A.clerkOrgId,
  userId: who.userId,
  clerkUserId: `clerk_${who.userId}`,
  member: { membershipId: who.membershipId, appRole, active: true },
  timezone: "America/New_York",
});
const BM = () => actor(A, "owner");
const JR = () => actor(jr, "project_manager");
const OP = () => actor(op, "project_manager");

const q = <T extends Record<string, unknown>>(text: string, params: unknown[] = []) =>
  asFirm(pool, A.firmId, async (c) => (await c.query<T>(text, params)).rows);

/** A timesheet with one row per phase and the given entries (rates and role frozen). */
async function sheet(
  membershipId: string,
  week: string,
  status: "approved" | "submitted",
  entries: { phase: string; date: string; hours: number; rate: number; roleId: string | null; billable?: boolean }[],
) {
  return asFirm(pool, A.firmId, async (c) => {
    const s = await c.query<{ id: string }>(
      "insert into timesheets (firm_id, membership_id, week_start, status) values ($1, $2, $3, $4) returning id",
      [A.firmId, membershipId, week, status],
    );
    const rows = new Map<string, string>();
    for (const e of entries) {
      if (!rows.has(e.phase)) {
        const r = await c.query<{ id: string }>(
          "insert into timesheet_rows (firm_id, timesheet_id, row_type, project_id, project_phase_id, activity_id, billable, sort_order) values ($1, $2, 'project', $3, $4, $5, true, $6) returning id",
          [A.firmId, s.rows[0].id, A.projectId, e.phase, A.activityId, rows.size],
        );
        rows.set(e.phase, r.rows[0].id);
      }
      await c.query(
        `insert into time_entries (firm_id, timesheet_id, timesheet_row_id, work_date, project_id, project_phase_id, activity_id, hours, billable, bill_rate_cents, cost_rate_cents, firm_role_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          A.firmId,
          s.rows[0].id,
          rows.get(e.phase),
          e.date,
          A.projectId,
          e.phase,
          A.activityId,
          e.hours,
          e.billable ?? true,
          status === "approved" ? e.rate : null,
          status === "approved" ? 5000 : null,
          status === "approved" ? e.roleId : null,
        ],
      );
    }
    return s.rows[0].id;
  });
}

beforeAll(async () => {
  requireDbEnv();
  pool = createOwnerPool();
  A = await createTestFirm(pool, "A");
  B = await createTestFirm(pool, "B");
  jr = await addTestMember(pool, A, { firstName: "Jo", lastName: "Reyes", role: "project_manager" });
  kl = await addTestMember(pool, A, { firstName: "Kim", lastName: "Lee", role: "staff" });
  op = await addTestMember(pool, A, { firstName: "Otto", lastName: "Park", role: "project_manager" });
  mw = await addTestMember(pool, A, { firstName: "Mia", lastName: "Wu", role: "admin" });

  await asFirm(pool, A.firmId, async (c) => {
    await c.query("update projects set pm_membership_id = $1 where id = $2", [jr.membershipId, A.projectId]);
    await c.query("update project_phases set fee_cents = 2790000, percent_complete_bp = 6000 where id = $1", [A.projectPhaseId]);
    ph.SD = A.projectPhaseId;
    const add = async (code: string, name: string, sort: number, feeType: string, fee: number) =>
      (
        await c.query<{ id: string }>(
          "insert into project_phases (firm_id, project_id, code, name, sort_order, fee_type, fee_cents, status) values ($1, $2, $3, $4, $5, $6, $7, 'current') returning id",
          [A.firmId, A.projectId, code, name, sort, feeType, fee],
        )
      ).rows[0].id;
    ph.DD = await add("DD", "Design Development", 3, "fixed", 4_650_000);
    ph.PERM = await add("PERM", "Permitting", 5, "nte", 930_000);
    ph.ADD = await add("ADD", "Additional Services", 7, "hourly", 0);
    const r = async (name: string, sort: number) =>
      (await c.query<{ id: string }>("insert into firm_roles (firm_id, name, sort_order) values ($1, $2, $3) returning id", [A.firmId, name, sort]))
        .rows[0].id;
    role.principal = await r("Principal", 0);
    role.architect = await r("Project Architect", 2);
    await c.query("update memberships set firm_role_id = $1 where id = $2", [role.architect, jr.membershipId]);
    // A-100: SD billed to 60 %, Permitting $8,200 of hourly, both paid.
    const prior = await c.query<{ id: string }>(
      `insert into invoices (firm_id, project_id, client_company_id, number, status, issue_date, due_date, period_end, subtotal_cents, total_cents, amount_paid_cents, sent_at)
       values ($1, $2, $3, 'A-100', 'paid', '2026-09-16', '2026-10-16', '2026-09-30', 2494000, 2494000, 2494000, now()) returning id`,
      [A.firmId, A.projectId, A.companyId],
    );
    await c.query(
      `insert into invoice_lines (firm_id, invoice_id, project_phase_id, line_type, description, rate_cents, amount_cents, percent_complete_bp)
       values ($1, $2, $3, 'phase_fee', 'Schematic Design · 60% complete', 1674000, 1674000, 6000),
              ($1, $2, $4, 'hourly', 'Permitting · Designer · 74.55 h @ $110', 11000, 820000, null)`,
      [A.firmId, prior.rows[0].id, ph.SD, ph.PERM],
    );
  });

  approvedSheetBM = await sheet(A.membershipId, "2026-10-05", "approved", [
    { phase: ph.ADD, date: "2026-10-05", hours: 4, rate: 19_500, roleId: role.principal },
  ]);
  await sheet(jr.membershipId, "2026-10-05", "approved", [
    { phase: ph.ADD, date: "2026-10-06", hours: 10.5, rate: 14_500, roleId: role.architect },
    { phase: ph.ADD, date: "2026-10-07", hours: 2.25, rate: 14_500, roleId: role.architect },
    { phase: ph.PERM, date: "2026-10-08", hours: 3, rate: 14_500, roleId: role.architect },
  ]);
  await sheet(kl.membershipId, "2026-10-05", "approved", [
    { phase: ph.PERM, date: "2026-10-06", hours: 8, rate: 11_000, roleId: A.firmRoleId },
    // Non-billable time never lands on an invoice.
    { phase: ph.ADD, date: "2026-10-07", hours: 1, rate: 11_000, roleId: A.firmRoleId, billable: false },
  ]);
  unapprovedSheet = await sheet(kl.membershipId, "2026-10-12", "submitted", [
    { phase: ph.ADD, date: "2026-10-13", hours: 2, rate: 0, roleId: null },
  ]);
});

afterAll(async () => {
  if (pool) {
    if (A) await removeTestFirm(pool, A);
    if (B) await removeTestFirm(pool, B);
    await removeTestUsers(pool, [jr, kl, op, mw].filter(Boolean).map((m) => m.userId));
    await pool.end();
  }
  await closeDb();
});

const view = async (who: InvoiceActor = BM()) => (await withFirm(A.firmId, (db) => loadBuilder(db, who, draftId)))!;
const ok = <T>(r: { ok: true; data: T } | { ok: false; error?: string }): T => {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.data;
};
const lines = (v: BuilderView) => [
  ...v.fixed.filter((f) => f.thisInvoiceCents).map((f) => [f.name, f.thisInvoiceCents]),
  ...v.hourly.flatMap((h) => h.groups.map((g) => [`${h.name} · ${g.roleName}`, g.amountCents])),
];

describe("New invoice", () => {
  it("a PM on the project creates a draft through the end of the month, period from the last invoice", async () => {
    const r = ok(await createDraftInvoiceCore(JR(), { projectId: A.projectId }));
    expect(r.created).toBe(true);
    draftId = r.id;
    const v = await view(JR());
    expect(v.status).toBe("draft");
    expect(v.settings.periodStart).toBe("2026-10-01");
    expect(v.settings.periodEnd).toMatch(/^\d{4}-\d{2}-(28|29|30|31)$/);
    // Bill-to falls back to the company's billing contact.
    expect(v.settings.billToContactId).toBe(A.contactId);
  });

  it("clicking New invoice again opens the same draft (rule 12)", async () => {
    expect(ok(await createDraftInvoiceCore(BM(), { projectId: A.projectId }))).toEqual({ id: draftId, created: false });
    const n = await q<{ n: number }>("select count(*)::int as n from invoices where project_id = $1 and status = 'draft'", [A.projectId]);
    expect(n[0].n).toBe(1);
  });

  it("a PM on no project, staff, or another firm can't start or open one", async () => {
    expect((await createDraftInvoiceCore(OP(), { projectId: A.projectId })).ok).toBe(false);
    expect((await createDraftInvoiceCore(actor(kl, "staff"), { projectId: A.projectId })).ok).toBe(false);
    expect(await withFirm(A.firmId, (db) => loadBuilder(db, OP(), draftId))).toBeNull();
    expect(await withFirm(B.firmId, (db) => loadBuilder(db, { ...BM(), firmId: B.firmId }, draftId))).toBeNull();
  });

  it("the Invoices page lists it for the PM and owner, not for a PM on no project", async () => {
    const forJr = await withFirm(A.firmId, (db) => loadInvoicesPage(db, JR()));
    // The project's earlier invoice too: JR is its PM.
    expect(forJr.rows.map((r) => r.number ?? r.id).sort()).toEqual(["A-100", draftId].sort());
    expect(forJr.projects.find((p) => p.id === A.projectId)?.draftId).toBe(draftId);
    const forOp = await withFirm(A.firmId, (db) => loadInvoicesPage(db, OP()));
    expect(forOp.rows).toEqual([]);
    expect(forOp.projects).toEqual([]);
    expect((await withFirm(A.firmId, (db) => loadInvoicesPage(db, BM()))).rows.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Building the lines", () => {
  it("hourly time groups by the role frozen at approval: 78,000 and 184,875", async () => {
    const v = await view();
    const add = v.hourly.find((h) => h.phaseId === ph.ADD)!;
    expect(add.groups.map((g) => [g.roleName, g.hoursHundredths, g.amountCents])).toEqual([
      ["Principal", 400, 78_000],
      ["Project Architect", 1275, 184_875],
    ]);
    // Bill rates show on the entries; nothing about cost.
    expect(add.entries).toHaveLength(3);
    expect(JSON.stringify(v)).not.toMatch(/cost_rate|costRate|5000\b/);
  });

  it("a change of role after approval doesn't move the hours", async () => {
    await q("update memberships set firm_role_id = $1 where id = $2", [A.firmRoleId, jr.membershipId]);
    const v = ok(await recalculateDraftCore(BM(), { invoiceId: draftId, version: (await view()).version }));
    expect(v.hourly.find((h) => h.phaseId === ph.ADD)!.groups.map((g) => g.roleName)).toEqual(["Principal", "Project Architect"]);
  });

  it("non-billable time on an hourly phase gets a heads-up", async () => {
    expect((await view()).warnings.map((w) => w.message)).toContain(
      "1 h on hourly phases in this period is marked non-billable on timesheets, so it isn't on this invoice.",
    );
  });

  it("unapproved time isn't billed; a warning shows its hours", async () => {
    const v = await view();
    expect(v.warnings.map((w) => w.message)).toContain(
      `2 h of billable time through ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${v.settings.periodEnd}T00:00:00Z`))} isn't approved yet, so it isn't on this invoice.`,
    );
    const onDraft = await q("select 1 from time_entries where timesheet_id = $1 and invoice_id is not null", [unapprovedSheet]);
    expect(onDraft).toHaveLength(0);
  });

  it("NTE over the cap: a −21,500 write-down, net $1,100, and the red warning", async () => {
    const v = await view();
    const perm = v.hourly.find((h) => h.phaseId === ph.PERM)!;
    expect(perm).toMatchObject({ hourlyAmountCents: 131_500, netCents: 110_000, writeDownCents: 21_500, warning: "reached" });
    expect(v.warnings.map((w) => w.message)).toContain("Permitting: limit reached; $215 of time not billed.");
    const adj = await q<{ amount_cents: string }>(
      "select amount_cents from invoice_lines where invoice_id = $1 and line_type = 'adjustment' and project_phase_id = $2 and archived_at is null",
      [draftId, ph.PERM],
    );
    expect(adj.map((a) => Number(a.amount_cents))).toEqual([-21_500]);
  });

  it("DD set to 30 %: a phase-fee line of 1,395,000, saved on the phase too", async () => {
    const v = ok(await setPhasePercentCore(JR(), { invoiceId: draftId, version: (await view()).version, phaseId: ph.DD, percentCompleteBp: 3000 }));
    expect(v.fixed.find((f) => f.phaseId === ph.DD)).toMatchObject({ thisInvoiceCents: 1_395_000, earnedToDateCents: 1_395_000 });
    const [phase] = await q<{ percent_complete_bp: number }>("select percent_complete_bp from project_phases where id = $1", [ph.DD]);
    expect(phase.percent_complete_bp).toBe(3000);
  });

  it("SD at 60 % (last billed) makes no line; 100 % makes 1,116,000", async () => {
    let v = await view();
    expect(v.fixed.find((f) => f.phaseId === ph.SD)).toMatchObject({ lastBilledBp: 6000, thisInvoiceCents: 0 });
    v = ok(await setPhasePercentCore(JR(), { invoiceId: draftId, version: v.version, phaseId: ph.SD, percentCompleteBp: 10000 }));
    expect(v.fixed.find((f) => f.phaseId === ph.SD)!.thisInvoiceCents).toBe(1_116_000);
  });

  it("a % below what's already billed is refused", async () => {
    const r = await setPhasePercentCore(JR(), { invoiceId: draftId, version: (await view()).version, phaseId: ph.SD, percentCompleteBp: 5000 });
    expect(r).toMatchObject({ ok: false, fieldErrors: { percentCompleteBp: "% complete is below what's already billed (60%)." } });
  });

  it("a consultant bills by % complete of their marked-up fee (decision #31)", async () => {
    // MEP: $1,000 fee + 10 % markup = $1,100 to the client; A-100 billed 30 % ($330).
    // The owner connection sees every firm: filter by firm (another test file also has an A-100).
    const [prior] = await q<{ id: string }>("select id from invoices where firm_id = $1 and number = 'A-100'", [A.firmId]);
    await q(
      `insert into invoice_lines (firm_id, invoice_id, line_type, description, rate_cents, amount_cents, percent_complete_bp, consultant_id, markup_bp)
       values ($1, $2, 'consultant', 'MEP · 30% complete', 33000, 33000, 3000, $3, 1000)`,
      [A.firmId, prior.id, A.consultantId],
    );
    let v = await view();
    expect(v.consultants).toMatchObject([
      { consultantId: A.consultantId, feeCents: 100_000, markupBp: 1000, clientFeeCents: 110_000, lastBilledBp: 3000, previouslyBilledCents: 33_000 },
    ]);
    const below = await setConsultantPercentCore(JR(), { invoiceId: draftId, version: v.version, consultantId: A.consultantId, percentCompleteBp: 2000 });
    expect(below).toMatchObject({ ok: false, fieldErrors: { percentCompleteBp: "% complete is below what's already billed (30%)." } });
    v = ok(await setConsultantPercentCore(JR(), { invoiceId: draftId, version: v.version, consultantId: A.consultantId, percentCompleteBp: 5000 }));
    expect(v.consultants[0]).toMatchObject({ percentCompleteBp: 5000, earnedToDateCents: 55_000, thisInvoiceCents: 22_000 });
    const [c] = await q<{ percent_complete_bp: number }>("select percent_complete_bp from consultants where id = $1", [A.consultantId]);
    expect(c.percent_complete_bp).toBe(5000);
  });

  it("fixed-fee phases show WIP for the period and hours against budget", async () => {
    await q("update project_phases set budget_hours = 10 where id = $1", [ph.SD]);
    await q("update memberships set firm_role_id = $1 where id = $2", [A.firmRoleId, kl.membershipId]);
    // Approved at a frozen $145; unapproved valued at KL's role rate ($115).
    await sheet(jr.membershipId, "2026-10-12", "approved", [{ phase: ph.SD, date: "2026-10-13", hours: 5, rate: 14_500, roleId: role.architect }]);
    await sheet(kl.membershipId, "2026-10-19", "submitted", [{ phase: ph.SD, date: "2026-10-20", hours: 2, rate: 0, roleId: null }]);
    const sd = (await view()).fixed.find((f) => f.phaseId === ph.SD)!;
    expect(sd).toMatchObject({ wipCents: 95_500, wipHundredths: 700, usedHundredths: 700, suggestBp: 7000 });
  });

  it("adjustments can be negative (a retainer) and removed", async () => {
    let v = ok(await saveAdjustmentCore(JR(), { invoiceId: draftId, version: (await view()).version, description: "Retainer applied", amountCents: -100_000 }));
    expect(v.adjustments).toMatchObject([{ description: "Retainer applied", amountCents: -100_000 }]);
    v = ok(await removeLineCore(JR(), { invoiceId: draftId, version: v.version, lineId: v.adjustments[0].id }));
    expect(v.adjustments).toEqual([]);
    // Calculated lines can't be removed by hand.
    const fixedLine = await q<{ id: string }>("select id from invoice_lines where invoice_id = $1 and line_type = 'phase_fee' and archived_at is null limit 1", [draftId]);
    expect((await removeLineCore(JR(), { invoiceId: draftId, version: v.version, lineId: fixedLine[0].id })).ok).toBe(false);
  });

  it("totals add up on the server: DD + SD + hourly + Permitting net + MEP", async () => {
    const v = await view();
    expect(v.totals.totalCents).toBe(1_395_000 + 1_116_000 + 262_875 + 110_000 + 22_000);
    expect(lines(v)).toContainEqual(["Design Development", 1_395_000]);
  });

  it("a stale page can't overwrite", async () => {
    const r = await recalculateDraftCore(JR(), { invoiceId: draftId, version: "2020-01-01T00:00:00.000Z" });
    expect(r).toEqual({ ok: false, error: INVOICE_MESSAGES.stale });
  });
});

describe("Time on the draft", () => {
  it("opening a draft picks up time approved since; opening it again changes nothing", async () => {
    const before = await view();
    await sheet(kl.membershipId, "2026-10-26", "approved", [{ phase: ph.ADD, date: "2026-10-26", hours: 1, rate: 11_000, roleId: A.firmRoleId }]);
    const after = await view();
    expect(after.version).not.toBe(before.version);
    expect(after.hourly.find((h) => h.phaseId === ph.ADD)!.groups.map((g) => [g.roleName, g.amountCents])).toContainEqual(["Designer", 11_000]);
    expect((await view()).version).toBe(after.version);
  });

  it("an unticked entry comes off and stays off on Recalculate; ticking puts it back", async () => {
    let v = await view();
    const entry = v.hourly.find((h) => h.phaseId === ph.ADD)!.entries.find((e) => e.hours === "2.25")!;
    v = ok(await toggleEntryCore(JR(), { invoiceId: draftId, version: v.version, entryId: entry.id, include: false }));
    expect(v.hourly.find((h) => h.phaseId === ph.ADD)!.groups.find((g) => g.roleName === "Project Architect")!.hoursHundredths).toBe(1050);
    v = ok(await recalculateDraftCore(JR(), { invoiceId: draftId, version: v.version }));
    expect(v.hourly.find((h) => h.phaseId === ph.ADD)!.entries.find((e) => e.id === entry.id)!.included).toBe(false);
    v = ok(await toggleEntryCore(JR(), { invoiceId: draftId, version: v.version, entryId: entry.id, include: true }));
    expect(v.hourly.find((h) => h.phaseId === ph.ADD)!.groups.find((g) => g.roleName === "Project Architect")!.hoursHundredths).toBe(1275);
  });

  it("an earlier Period through releases later time", async () => {
    let v = await view();
    v = ok(await updateDraftSettingsCore(JR(), { invoiceId: draftId, version: v.version, periodEnd: "2026-10-05" }));
    expect(v.hourly.find((h) => h.phaseId === ph.ADD)!.groups.map((g) => g.roleName)).toEqual(["Principal"]);
    const before = await updateDraftSettingsCore(JR(), { invoiceId: draftId, version: v.version, periodEnd: "2026-09-15" });
    expect(before).toMatchObject({ ok: false, fieldErrors: { periodEnd: "Period through can't be before Oct 1, 2026." } });
    v = ok(await updateDraftSettingsCore(JR(), { invoiceId: draftId, version: v.version, periodEnd: "2026-10-31" }));
    expect(v.hourly.find((h) => h.phaseId === ph.ADD)!.groups).toHaveLength(3);
  });

  it("a new issue date moves the due date; due can't be before issue", async () => {
    let v = await view();
    v = ok(await updateDraftSettingsCore(JR(), { invoiceId: draftId, version: v.version, issueDate: "2026-10-16", dueDate: "2026-11-15" }));
    v = ok(await updateDraftSettingsCore(JR(), { invoiceId: draftId, version: v.version, issueDate: "2026-10-20" }));
    expect(v.settings).toMatchObject({ issueDate: "2026-10-20", dueDate: "2026-11-19" });
    const r = await updateDraftSettingsCore(JR(), { invoiceId: draftId, version: v.version, dueDate: "2026-10-01" });
    expect(r).toMatchObject({ ok: false, fieldErrors: { dueDate: INVOICE_MESSAGES.dueBeforeIssue } });
  });

  it("reserved time is locked: reopening its week is refused, and the database refuses edits", async () => {
    const r = await reopenTimesheetCore(
      {
        firmId: A.firmId,
        userId: mw.userId,
        membershipId: mw.membershipId,
        timezone: "America/New_York",
        weekStartsOn: 1,
        lockDay: 1,
        dueTime: "09:00:00",
        notesRule: "optional",
        member: { appRole: "admin", active: true },
      },
      { timesheetId: approvedSheetBM, note: "Fix hours" },
    );
    expect(r).toEqual({
      ok: false,
      error: "Some of this week's time is on a draft invoice. Untick it on the invoice (or delete the draft) before reopening.",
    });
    await expect(q("update time_entries set hours = 5 where timesheet_id = $1", [approvedSheetBM])).rejects.toThrow(/time_entry_locked/);
  });
});

describe("Review", () => {
  it("a bill-to with no email blocks Submit for review", async () => {
    await q("update contacts set email = null where id = $1", [A.contactId]);
    const r = await submitForReviewCore(JR(), { invoiceId: draftId, version: (await view()).version });
    expect(r).toEqual({ ok: false, error: "The bill-to contact needs an email address." });
    await q("update contacts set email = 'bill@example.com' where id = $1", [A.contactId]);
  });

  it("the PM submits; owners, admins and the Principal in Charge are notified", async () => {
    const v = ok(await submitForReviewCore(JR(), { invoiceId: draftId, version: (await view()).version }));
    expect(v.status).toBe("in_review");
    const notes = await q<{ membership_id: string; title: string }>(
      "select membership_id, title from notifications where kind = 'invoice_review' and entity_id = $1",
      [draftId],
    );
    expect(new Set(notes.map((n) => n.membership_id))).toEqual(new Set([A.membershipId, mw.membershipId]));
    expect(notes[0].title).toBe("Invoice ready to review: 2026-001 A Project");
  });

  it("in review, the PM can't edit; a PM who isn't Principal in Charge can't return it", async () => {
    const v = await view(JR());
    expect(v.can).toMatchObject({ edit: false, returnToDraft: false });
    expect(await recalculateDraftCore(JR(), { invoiceId: draftId, version: v.version })).toEqual({ ok: false, error: INVOICE_MESSAGES.notEditable });
    expect((await returnToDraftCore(JR(), { invoiceId: draftId, version: v.version, note: "Fix it" })).ok).toBe(false);
  });

  it("the owner returns it with a note; the PM is told", async () => {
    const v = await view();
    expect(await returnToDraftCore(BM(), { invoiceId: draftId, version: v.version, note: "ok" })).toMatchObject({
      ok: false,
      fieldErrors: { note: INVOICE_MESSAGES.returnNote },
    });
    const back = ok(await returnToDraftCore(BM(), { invoiceId: draftId, version: v.version, note: "Bill CA next month" }));
    expect(back.status).toBe("draft");
    const notes = await q<{ membership_id: string; body: string }>(
      "select membership_id, body from notifications where kind = 'invoice_returned' and entity_id = $1",
      [draftId],
    );
    expect(notes).toEqual([{ membership_id: jr.membershipId, body: "Bill CA next month" }]);
  });
});

describe("Delete draft", () => {
  it("frees its time, and the next draft picks it up", async () => {
    const reserved = async () =>
      (await q<{ n: number }>("select count(*)::int as n from time_entries where invoice_id = $1", [draftId]))[0].n;
    expect(await reserved()).toBeGreaterThan(0);
    const r = await deleteDraftCore(JR(), { invoiceId: draftId, version: (await view()).version });
    expect(r.ok).toBe(true);
    expect(await reserved()).toBe(0);
    expect(await withFirm(A.firmId, (db) => loadBuilder(db, BM(), draftId))).toBeNull();
    const next = ok(await createDraftInvoiceCore(BM(), { projectId: A.projectId }));
    expect(next.created).toBe(true);
    draftId = next.id;
    expect((await view()).hourly.find((h) => h.phaseId === ph.ADD)!.groups.map((g) => g.amountCents)).toEqual([78_000, 184_875, 11_000]);
  });
});

describe("Freezing the role at approval (decision #30)", () => {
  it("freezeSheetRates saves the role with the rates", async () => {
    const id = await sheet(A.membershipId, "2026-11-02", "submitted", [
      { phase: ph.ADD, date: "2026-11-02", hours: 1, rate: 0, roleId: null },
    ]);
    const r = await withFirm(A.firmId, (db) => freezeSheetRates(db, id, A.membershipId, A.firmRoleId, "BM"));
    expect(r.ok).toBe(true);
    const [e] = await q<{ firm_role_id: string; bill_rate_cents: string }>(
      "select firm_role_id, bill_rate_cents from time_entries where timesheet_id = $1",
      [id],
    );
    expect(e).toEqual({ firm_role_id: A.firmRoleId, bill_rate_cents: "11500" });
  });
});
