import type { Pool } from "@neondatabase/serverless";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
import { RecordingMailer, setMailerForTests } from "@/lib/integrations/email";
import { MemoryStore, setStorageForTests } from "@/lib/integrations/storage";
import { INVOICE_MESSAGES } from "@/lib/invoices/builder";
import { createDraftInvoiceCore, setPhasePercentCore } from "./builder";
import { loadInvoiceDetail, loadSendDefaults } from "./detail";
import type { InvoiceActor } from "./draft";
import { resendInvoiceCore, sendInvoiceCore, voidInvoiceCore } from "./send";
import { loadBuilder } from "./view";

// Sending, numbering, resending and voiding against the real database
// (invoicing spec acceptance tests for 1.8 C). File storage and email are
// stand-ins that keep what they're given.
//
// Cast: BM (owner), JR (PM of the project, not Principal in Charge),
// PC (a PM who is Principal in Charge of the second project), MW (admin).

let pool: Pool;
let A: TestFirm;
let jr: TestMember, pc: TestMember, mw: TestMember;
let project2 = "";
let phase2 = "";
let addPhase = "";
let mail: RecordingMailer;

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
const PC = () => actor(pc, "project_manager");
const MW = () => actor(mw, "admin");

const q = <T extends Record<string, unknown>>(text: string, params: unknown[] = []) =>
  asFirm(pool, A.firmId, async (c) => (await c.query<T>(text, params)).rows);

const ok = <T>(r: { ok: true; data: T } | { ok: false; error?: string }): T => {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.data;
};

const view = (id: string, who: InvoiceActor = BM()) => withFirm(A.firmId, (db) => loadBuilder(db, who, id)).then((v) => v!);

/** A draft on a project with one fixed phase set to `bp` % complete. */
async function draftAt(projectId: string, phaseId: string, bp: number, who: InvoiceActor = BM()) {
  const { id } = ok(await createDraftInvoiceCore(who, { projectId }));
  ok(await setPhasePercentCore(who, { invoiceId: id, version: (await view(id, who)).version, phaseId, percentCompleteBp: bp }));
  return id;
}

const emailSend = async (id: string, issueDate: string, who: InvoiceActor = BM(), extra: Record<string, unknown> = {}) => {
  const v = await view(id, who);
  return sendInvoiceCore(who, {
    invoiceId: id,
    version: v.version,
    mode: "email",
    issueDate,
    expectedNumber: "",
    to: "ap@client.example",
    cc: "bill@example.com",
    subject: "Invoice · A Project",
    message: "Attached.",
    ...extra,
  });
};

const markSent = async (id: string, issueDate: string, who: InvoiceActor = BM()) =>
  sendInvoiceCore(who, { invoiceId: id, version: (await view(id, who)).version, mode: "mark", issueDate });

const row = async (id: string) =>
  (
    await q<{ number: string | null; status: string; pdf_url: string | null; emailed_at: Date | null; sent_to: string[] | null; reviewed_by: string | null; issue_date: string; due_date: string }>(
      "select number, status, pdf_url, emailed_at, sent_to, reviewed_by, issue_date::text, due_date::text from invoices where id = $1",
      [id],
    )
  )[0];

// The owner login sees every firm: always name the test firm.
const settings = async () =>
  (await q<{ next_invoice_number: number }>("select next_invoice_number from firm_settings where firm_id = $1", [A.firmId]))[0];
const setFormat = (format: string) => q("update firm_settings set invoice_number_format = $2 where firm_id = $1", [A.firmId, format]);

beforeAll(async () => {
  requireDbEnv();
  pool = createOwnerPool();
  A = await createTestFirm(pool, "A");
  jr = await addTestMember(pool, A, { firstName: "Jo", lastName: "Reyes", role: "project_manager" });
  pc = await addTestMember(pool, A, { firstName: "Pat", lastName: "Cole", role: "project_manager" });
  mw = await addTestMember(pool, A, { firstName: "Mia", lastName: "Wu", role: "admin" });
  await asFirm(pool, A.firmId, async (c) => {
    await c.query("update projects set pm_membership_id = $1 where id = $2", [jr.membershipId, A.projectId]);
    await c.query("update project_phases set fee_cents = 2790000 where id = $1", [A.projectPhaseId]);
    await c.query("update contacts set email = 'bill@example.com' where id = $1", [A.contactId]);
    await c.query("update companies set billing_email = 'ap@client.example', billing_contact_id = $2 where id = $1", [A.companyId, A.contactId]);
    await c.query(
      "update firm_settings set invoice_number_format = '{YYYY}-{###}', next_invoice_number = 128, default_payment_terms_days = 30 where firm_id = $1",
      [A.firmId],
    );
    // An hourly phase with approved time, so voiding has time to free.
    addPhase = (
      await c.query<{ id: string }>(
        "insert into project_phases (firm_id, project_id, code, name, sort_order, fee_type, fee_cents, status) values ($1, $2, 'ADD', 'Additional Services', 7, 'hourly', 0, 'current') returning id",
        [A.firmId, A.projectId],
      )
    ).rows[0].id;
    const s = await c.query<{ id: string }>(
      "insert into timesheets (firm_id, membership_id, week_start, status) values ($1, $2, '2026-10-05', 'approved') returning id",
      [A.firmId, A.membershipId],
    );
    const r = await c.query<{ id: string }>(
      "insert into timesheet_rows (firm_id, timesheet_id, row_type, project_id, project_phase_id, activity_id, billable, sort_order) values ($1, $2, 'project', $3, $4, $5, true, 0) returning id",
      [A.firmId, s.rows[0].id, A.projectId, addPhase, A.activityId],
    );
    await c.query(
      `insert into time_entries (firm_id, timesheet_id, timesheet_row_id, work_date, project_id, project_phase_id, activity_id, hours, billable, bill_rate_cents, cost_rate_cents, firm_role_id)
       values ($1, $2, $3, '2026-10-05', $4, $5, $6, 4, true, 19500, 5000, $7)`,
      [A.firmId, s.rows[0].id, r.rows[0].id, A.projectId, addPhase, A.activityId, A.firmRoleId],
    );
    // A second project, where PC is Principal in Charge (and PM).
    project2 = (
      await c.query<{ id: string }>(
        "insert into projects (firm_id, number, name, client_company_id, project_type, principal_membership_id, pm_membership_id, next_invoice_seq) values ($1, '26031', 'Second Project', $2, 'Office', $3, $3, 4) returning id",
        [A.firmId, A.companyId, pc.membershipId],
      )
    ).rows[0].id;
    phase2 = (
      await c.query<{ id: string }>(
        "insert into project_phases (firm_id, project_id, code, name, sort_order, fee_type, fee_cents, status) values ($1, $2, 'SD', 'Schematic Design', 1, 'fixed', 1000000, 'current') returning id",
        [A.firmId, project2],
      )
    ).rows[0].id;
  });
});

// One file store for the whole run (Resend reads what Send saved); a fresh mailbox per test.
const files = new MemoryStore();
beforeEach(() => {
  mail = new RecordingMailer();
  setStorageForTests(files);
  setMailerForTests(mail);
});
afterEach(() => {
  setStorageForTests(null);
  setMailerForTests(null);
});

afterAll(async () => {
  if (pool) {
    if (A) await removeTestFirm(pool, A);
    await removeTestUsers(pool, [jr, pc, mw].filter(Boolean).map((m) => m.userId));
    await pool.end();
  }
  await closeDb();
});

let first = "";

describe("Send", () => {
  it("a PM who isn't Principal in Charge can't send (403); the Send dialog isn't offered", async () => {
    first = await draftAt(A.projectId, A.projectPhaseId, 3000, JR());
    expect((await view(first, JR())).can.send).toBe(false);
    expect(await emailSend(first, "2026-10-16", JR())).toEqual({ ok: false, error: "You don't have access to this." });
    expect(await withFirm(A.firmId, (db) => loadSendDefaults(db, JR(), first))).toBeNull();
    expect((await row(first)).number).toBeNull();
  });

  it("a stale page can't send", async () => {
    const r = await sendInvoiceCore(BM(), {
      invoiceId: first,
      version: "2020-01-01T00:00:00.000Z",
      mode: "mark",
      issueDate: "2026-10-16",
    });
    expect(r).toEqual({ ok: false, error: INVOICE_MESSAGES.stale });
  });

  it("the Send dialog suggests the next number, today's date, and the billing email copying the contact", async () => {
    const d = (await withFirm(A.firmId, (db) => loadSendDefaults(db, BM(), first)))!;
    expect(d.expectedNumber).toMatch(/^\d{4}-128$/);
    expect(d).toMatchObject({ to: "ap@client.example", cc: "bill@example.com" });
    expect(d.subject).toContain("A Project");
    expect(d.message).toContain(d.expectedNumber);
  });

  it("{YYYY}-{###} with next 128 issued Oct 16, 2026 → 2026-128, next 129; the PDF is saved and emailed", async () => {
    const r = ok(await emailSend(first, "2026-10-16"));
    expect(r.number).toBe("2026-128");
    expect((await settings()).next_invoice_number).toBe(129);
    const inv = await row(first);
    expect(inv).toMatchObject({ number: "2026-128", status: "sent", issue_date: "2026-10-16", due_date: "2026-11-15" });
    expect(inv.reviewed_by).toBe(A.userId);
    expect(inv.sent_to).toEqual(["ap@client.example", "bill@example.com"]);
    expect(inv.pdf_url).toBe(`firms/${A.firmId}/invoices/${first}/Invoice-2026-128.pdf`);
    expect(files.files.get(inv.pdf_url!)?.contentType).toBe("application/pdf");
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: ["ap@client.example"], cc: ["bill@example.com"], subject: "Invoice · A Project" });
    expect(mail.sent[0].attachments[0].name).toBe("Invoice-2026-128.pdf");
    const log = await q<{ action: string }>("select action from activity_log where entity_id = $1 order by created_at", [first]);
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(["numbered", "status_changed"]));
  });

  it("sending again does nothing (it's already sent)", async () => {
    expect(ok(await emailSend(first, "2026-10-16")).number).toBe("2026-128");
    expect(mail.sent).toHaveLength(0);
    expect((await settings()).next_invoice_number).toBe(129);
  });

  it("the next one, issued Jan 5, 2027, is 2027-129", async () => {
    const id = await draftAt(A.projectId, A.projectPhaseId, 4000);
    expect(ok(await markSent(id, "2027-01-05")).number).toBe("2027-129");
    expect(mail.sent).toHaveLength(0);
    expect((await row(id)).emailed_at).toBeNull();
  });

  it("a number already taken is skipped", async () => {
    await q(
      "insert into invoices (firm_id, project_id, client_company_id, number, status, issue_date, due_date, period_end, voided_at, void_reason) values ($1, $2, $3, '2027-130', 'void', '2027-01-01', '2027-01-31', '2026-12-31', now(), 'Typed in QuickBooks')",
      [A.firmId, A.projectId, A.companyId],
    );
    const id = await draftAt(A.projectId, A.projectPhaseId, 5000);
    expect(ok(await markSent(id, "2027-01-06")).number).toBe("2027-131");
    expect((await settings()).next_invoice_number).toBe(132);
  });
});

describe("Numbering with {PROJECT} and two at once", () => {
  it("{PROJECT}-{##} counts per project: 26031-04, project next 5, firm counter unchanged", async () => {
    await setFormat("{PROJECT}-{##}");
    const id = await draftAt(project2, phase2, 2000, PC());
    // The Principal in Charge (a PM) can send (decision #26).
    expect((await view(id, PC())).can.send).toBe(true);
    expect(ok(await markSent(id, "2026-10-20", PC())).number).toBe("26031-04");
    expect((await q<{ next_invoice_seq: number }>("select next_invoice_seq from projects where id = $1", [project2]))[0].next_invoice_seq).toBe(5);
    expect((await settings()).next_invoice_number).toBe(132);
  });

  it("two drafts sent at the same moment get different, consecutive numbers", async () => {
    await setFormat("{YYYY}-{###}");
    const a = await draftAt(A.projectId, A.projectPhaseId, 6000);
    const b = await draftAt(project2, phase2, 3000);
    const [ra, rb] = await Promise.all([markSent(a, "2027-02-01"), markSent(b, "2027-02-01")]);
    const numbers = [ok(ra).number, ok(rb).number].sort();
    expect(numbers).toEqual(["2027-132", "2027-133"]);
  });
});

describe("A failure partway", () => {
  let id = "";
  it("the email provider fails: not sent, number kept, the draft is frozen", async () => {
    id = await draftAt(A.projectId, A.projectPhaseId, 7000);
    mail.failNext = new Error("Postmark is down");
    const r = await emailSend(id, "2027-03-01");
    expect(r).toMatchObject({ ok: false, retry: true });
    expect(r.ok ? "" : r.error).toContain("Postmark is down");
    const inv = await row(id);
    expect(inv).toMatchObject({ number: "2027-134", status: "draft", emailed_at: null });
    expect(inv.pdf_url).not.toBeNull();
    const v = await view(id);
    expect(v).toMatchObject({ sendStarted: true, number: "2027-134" });
    expect(v.can).toMatchObject({ edit: false, delete: false, send: true });
    const edit = await setPhasePercentCore(BM(), { invoiceId: id, version: v.version, phaseId: A.projectPhaseId, percentCompleteBp: 8000 });
    expect(edit).toEqual({ ok: false, error: INVOICE_MESSAGES.sending });
  });

  it("Retry finishes it with the same number and emails once", async () => {
    // A retry may come from a page that's now out of date: that's fine.
    const r = await sendInvoiceCore(BM(), {
      invoiceId: id,
      version: "old",
      mode: "email",
      issueDate: "2027-03-09",
      expectedNumber: "",
      to: "ap@client.example",
      cc: "",
      subject: "Invoice",
      message: "Attached.",
    });
    expect(ok(r).number).toBe("2027-134");
    expect(mail.sent).toHaveLength(1);
    expect((await row(id))).toMatchObject({ status: "sent", issue_date: "2027-03-01" });
    expect((await settings()).next_invoice_number).toBe(135);
  });

  it("if storage isn't set up, it says so", async () => {
    setStorageForTests(null);
    const saved = process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCOUNT_ID;
    const id2 = await draftAt(project2, phase2, 4000);
    try {
      const r = await markSent(id2, "2027-03-02");
      expect(r).toMatchObject({ ok: false, retry: true });
      expect(r.ok ? "" : r.error).toContain("File storage isn't set up");
    } finally {
      if (saved !== undefined) process.env.R2_ACCOUNT_ID = saved;
    }
    setStorageForTests(files);
    expect(ok(await markSent(id2, "2027-03-02")).number).toBe("2027-135");
  });
});

describe("Resend", () => {
  it("emails the saved PDF again; the status doesn't change", async () => {
    const r = await resendInvoiceCore(BM(), { invoiceId: first, to: "ap@client.example", cc: "", subject: "Again", message: "Hi" });
    expect(r.ok).toBe(true);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: ["ap@client.example"], subject: "Again" });
    expect(mail.sent[0].attachments[0].name).toBe("Invoice-2026-128.pdf");
    expect((await row(first)).status).toBe("sent");
    const log = await q<{ action: string }>("select action from activity_log where entity_id = $1 and action = 'resent'", [first]);
    expect(log).toHaveLength(1);
  });

  it("a PM who isn't Principal in Charge can't resend", async () => {
    const r = await resendInvoiceCore(JR(), { invoiceId: first, to: "ap@client.example", cc: "", subject: "Again", message: "Hi" });
    expect(r).toEqual({ ok: false, error: "You don't have access to this." });
  });
});

describe("Void", () => {
  let id = "";
  it("only owner/admin: the Principal in Charge can't void", async () => {
    id = await draftAt(project2, phase2, 6000, PC());
    ok(await markSent(id, "2027-04-01", PC()));
    expect(await voidInvoiceCore(PC(), { invoiceId: id, reason: "Wrong %" })).toEqual({ ok: false, error: "You don't have access to this." });
    const d = (await withFirm(A.firmId, (db) => loadInvoiceDetail(db, PC(), id)))!;
    expect(d.can).toMatchObject({ download: true, resend: true, void: false });
  });

  it("with a payment it's blocked: Delete payments first", async () => {
    const [p] = await q<{ id: string }>(
      "insert into payments (firm_id, invoice_id, received_on, amount_cents, method) values ($1, $2, '2027-04-02', 100, 'check') returning id",
      [A.firmId, id],
    );
    expect(await voidInvoiceCore(MW(), { invoiceId: id, reason: "Wrong %" })).toEqual({ ok: false, error: INVOICE_MESSAGES.hasPayments });
    await q("update payments set archived_at = now() where id = $1", [p.id]);
  });

  it("needs a reason", async () => {
    expect(await voidInvoiceCore(MW(), { invoiceId: id, reason: " " })).toMatchObject({ ok: false, fieldErrors: { reason: INVOICE_MESSAGES.voidReason } });
  });

  it("voids: the number stays, and its % bills again on the next draft", async () => {
    ok(await voidInvoiceCore(MW(), { invoiceId: id, reason: "Wrong %" }));
    const [inv] = await q<{ status: string; number: string; void_reason: string; voided_by: string }>(
      "select status, number, void_reason, voided_by from invoices where id = $1",
      [id],
    );
    expect(inv).toMatchObject({ status: "void", void_reason: "Wrong %", voided_by: mw.userId });
    expect(inv.number).toBeTruthy();
    // Project 2 is billed to 40 % on counted invoices; the voided 60 % no longer counts.
    const next = ok(await createDraftInvoiceCore(PC(), { projectId: project2 }));
    const fixed = (await view(next.id, PC())).fixed.find((f) => f.phaseId === phase2)!;
    expect(fixed.previouslyBilledCents).toBe(400_000);
    expect(fixed.thisInvoiceCents).toBe(200_000);
    // Resend and void are gone from a void invoice.
    const d = (await withFirm(A.firmId, (db) => loadInvoiceDetail(db, BM(), id)))!;
    expect(d.can).toMatchObject({ resend: false, void: false });
    expect(d.void?.reason).toBe("Wrong %");
  });

  it("a voided invoice's time is billable again", async () => {
    // The first sent invoice (2026-128) carried the 4 h of Additional Services.
    const [before] = await q<{ n: string }>("select count(*)::text as n from time_entries where invoice_id = $1", [first]);
    expect(before.n).toBe("1");
    ok(await voidInvoiceCore(BM(), { invoiceId: first, reason: "Re-issue" }));
    const [after] = await q<{ n: string }>("select count(*)::text as n from time_entries where invoice_id = $1", [first]);
    expect(after.n).toBe("0");
  });

  it("only a sent invoice can be voided", async () => {
    expect(await voidInvoiceCore(BM(), { invoiceId: first, reason: "Again" })).toEqual({ ok: false, error: INVOICE_MESSAGES.notSent });
  });
});
