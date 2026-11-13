import type { Pool } from "@neondatabase/serverless";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
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
import type { AppRole } from "@/lib/auth/permissions";
import { PAYMENT_MESSAGES } from "@/lib/invoices/payments";
import type { InvoiceActor } from "./draft";
import { deletePaymentCore, recordPaymentCore } from "./payments";

// Recording and deleting payments against the real database (invoicing
// spec rule 9 and its acceptance tests). The QuickBooks hook is replaced
// with a recorder so the tests can see what would be queued.

const qbo = vi.hoisted(() => ({
  calls: [] as { paymentId: string; kind: string }[],
}));
vi.mock("./quickbooks", async (orig) => ({
  ...(await orig<typeof import("./quickbooks")>()),
  queueQuickbooksPayment: async (
    _db: unknown,
    paymentId: string,
    kind: string,
  ) => {
    qbo.calls.push({ paymentId, kind });
  },
}));

let pool: Pool;
let A: TestFirm, B: TestFirm;
let jr: TestMember, mw: TestMember;
let sent = ""; // 2026-121: $11,160 sent, due Nov 15
let draft = "";
let otherFirmPayment = "";

const actor = (
  firm: TestFirm,
  who: { userId: string; membershipId: string },
  appRole: AppRole,
): InvoiceActor => ({
  firmId: firm.firmId,
  firmName: "Test",
  clerkOrgId: firm.clerkOrgId,
  userId: who.userId,
  clerkUserId: `clerk_${who.userId}`,
  member: { membershipId: who.membershipId, appRole, active: true },
  timezone: "America/New_York",
});
const BM = () => actor(A, A, "owner");
const JR = () => actor(A, jr, "project_manager");
const MW = () => actor(A, mw, "admin");

const q = <T extends Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
) => asFirm(pool, A.firmId, async (c) => (await c.query<T>(text, params)).rows);

const invoice = async (id: string) =>
  (
    await q<{ status: string; amount_paid_cents: string }>(
      "select status, amount_paid_cents from invoices where id = $1",
      [id],
    )
  )[0];

const pay = (amountCents: number, extra: Record<string, unknown> = {}) => ({
  invoiceId: sent,
  receivedOn: "2026-10-20",
  amountCents,
  method: "check",
  reference: "1042",
  ...extra,
});

async function insertInvoice(
  firm: TestFirm,
  status: string,
  number: string | null,
) {
  return asFirm(pool, firm.firmId, async (c) => {
    const r = await c.query<{ id: string }>(
      `insert into invoices (firm_id, project_id, client_company_id, number, status, issue_date, due_date, period_end, subtotal_cents, total_cents, sent_at)
       values ($1, $2, $3, $4, $5::invoice_status, '2026-10-16', '2026-11-15', '2026-10-31', 1116000, 1116000, case when $5::invoice_status = 'draft' then null else now() end) returning id`,
      [firm.firmId, firm.projectId, firm.companyId, number, status],
    );
    return r.rows[0].id;
  });
}

beforeAll(async () => {
  requireDbEnv();
  pool = createOwnerPool();
  A = await createTestFirm(pool, "A");
  B = await createTestFirm(pool, "B");
  jr = await addTestMember(pool, A, {
    firstName: "Jo",
    lastName: "Reyes",
    role: "project_manager",
  });
  mw = await addTestMember(pool, A, {
    firstName: "Mia",
    lastName: "Wu",
    role: "admin",
  });
  await q(
    "update projects set pm_membership_id = $1, principal_membership_id = $1 where id = $2",
    [jr.membershipId, A.projectId],
  );
  sent = await insertInvoice(A, "sent", "2026-121");
  // Firm B's invoice and payment, to check Firm A can't reach them.
  const bInvoice = await insertInvoice(B, "sent", "B-001");
  otherFirmPayment = await asFirm(pool, B.firmId, async (c) => {
    const r = await c.query<{ id: string }>(
      "insert into payments (firm_id, invoice_id, received_on, amount_cents, method) values ($1, $2, '2026-10-20', 1000, 'check') returning id",
      [B.firmId, bInvoice],
    );
    return r.rows[0].id;
  });
});

beforeEach(() => {
  qbo.calls.length = 0;
});

afterAll(async () => {
  if (pool) {
    if (A) await removeTestFirm(pool, A);
    if (B) await removeTestFirm(pool, B);
    await removeTestUsers(
      pool,
      [jr, mw].filter(Boolean).map((m) => m.userId),
    );
    await pool.end();
  }
  await closeDb();
});

const DENIED = { ok: false, error: "You don't have access to this." };

describe("Record payment", () => {
  it("a PM, even the project's Principal in Charge, can't record a payment (#26)", async () => {
    expect(await recordPaymentCore(JR(), pay(500_000))).toEqual(DENIED);
    expect(await invoice(sent)).toEqual({
      status: "sent",
      amount_paid_cents: "0",
    });
  });

  it("$5,000 of $11,160 → partially paid, balance $6,160; logged and queued for QuickBooks", async () => {
    const r = await recordPaymentCore(MW(), pay(500_000));
    expect(r).toMatchObject({ ok: true, data: { status: "partially_paid" } });
    expect(await invoice(sent)).toEqual({
      status: "partially_paid",
      amount_paid_cents: "500000",
    });
    const [log] = await q<{ action: string; changes: Record<string, unknown> }>(
      "select action, changes from activity_log where entity_id = $1 and action = 'payment_recorded'",
      [sent],
    );
    expect(log?.changes).toMatchObject({
      amountCents: 500_000,
      method: "check",
      reference: "1042",
      status: { before: "sent", after: "partially_paid" },
    });
    expect(qbo.calls).toEqual([
      { paymentId: expect.any(String), kind: "create" },
    ]);
  });

  it("more than the balance is refused", async () => {
    expect(await recordPaymentCore(BM(), pay(616_001))).toMatchObject({
      ok: false,
      fieldErrors: { amountCents: "That's more than the balance." },
    });
  });

  it("a date in the future and a $0 amount are refused", async () => {
    expect(
      await recordPaymentCore(BM(), pay(100, { receivedOn: "2099-01-01" })),
    ).toMatchObject({
      ok: false,
      fieldErrors: { receivedOn: "The received date can't be in the future." },
    });
    expect(await recordPaymentCore(BM(), pay(0))).toMatchObject({
      ok: false,
      fieldErrors: { amountCents: "Enter an amount over $0." },
    });
    expect(
      await recordPaymentCore(BM(), pay(100, { method: "barter" })),
    ).toMatchObject({
      ok: false,
      fieldErrors: { method: PAYMENT_MESSAGES.method },
    });
  });

  it("the remaining $6,160 → paid; nothing more can be recorded", async () => {
    expect(
      await recordPaymentCore(
        BM(),
        pay(616_000, { method: "ach", reference: "" }),
      ),
    ).toMatchObject({ ok: true, data: { status: "paid" } });
    expect(await invoice(sent)).toEqual({
      status: "paid",
      amount_paid_cents: "1116000",
    });
    expect(await recordPaymentCore(BM(), pay(1))).toEqual({
      ok: false,
      error: PAYMENT_MESSAGES.notOpen,
    });
  });

  it("a draft can't take a payment", async () => {
    draft = await insertInvoice(A, "draft", null);
    expect(
      await recordPaymentCore(BM(), pay(100, { invoiceId: draft })),
    ).toEqual({ ok: false, error: PAYMENT_MESSAGES.notOpen });
  });
});

describe("Delete payment", () => {
  it("a PM can't delete one", async () => {
    const [p] = await q<{ id: string }>(
      "select id from payments where invoice_id = $1 and archived_at is null limit 1",
      [sent],
    );
    expect(await deletePaymentCore(JR(), { paymentId: p.id })).toEqual(DENIED);
  });

  it("deleting from a paid invoice: archived (not erased), paid and status recompute, QuickBooks delete queued", async () => {
    const [p] = await q<{ id: string }>(
      "select id from payments where invoice_id = $1 and amount_cents = 616000",
      [sent],
    );
    expect(await deletePaymentCore(BM(), { paymentId: p.id })).toMatchObject({
      ok: true,
      data: { status: "partially_paid" },
    });
    expect(await invoice(sent)).toEqual({
      status: "partially_paid",
      amount_paid_cents: "500000",
    });
    const [row] = await q<{ archived: boolean }>(
      "select archived_at is not null as archived from payments where id = $1",
      [p.id],
    );
    expect(row?.archived).toBe(true);
    expect(qbo.calls).toEqual([{ paymentId: p.id, kind: "delete" }]);
    const logs = await q<{ action: string }>(
      "select action from activity_log where entity_id = $1 and action = 'payment_deleted'",
      [sent],
    );
    expect(logs).toHaveLength(1);
    // Deleting it again finds nothing.
    expect(await deletePaymentCore(BM(), { paymentId: p.id })).toEqual({
      ok: false,
      error: PAYMENT_MESSAGES.notFound,
    });
  });

  it("deleting the last payment → sent again", async () => {
    const [p] = await q<{ id: string }>(
      "select id from payments where invoice_id = $1 and archived_at is null",
      [sent],
    );
    expect(await deletePaymentCore(MW(), { paymentId: p.id })).toMatchObject({
      ok: true,
      data: { status: "sent" },
    });
    expect(await invoice(sent)).toEqual({
      status: "sent",
      amount_paid_cents: "0",
    });
  });

  it("another firm's payment can't be reached", async () => {
    expect(
      await deletePaymentCore(BM(), { paymentId: otherFirmPayment }),
    ).toEqual({ ok: false, error: PAYMENT_MESSAGES.notFound });
    const still = await asFirm(
      pool,
      B.firmId,
      async (c) =>
        (
          await c.query<{ archived: boolean }>(
            "select archived_at is not null as archived from payments where id = $1",
            [otherFirmPayment],
          )
        ).rows[0],
    );
    expect(still?.archived).toBe(false);
  });
});
