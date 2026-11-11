import type { Pool } from "@neondatabase/serverless";
import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { activityLog } from "@/db/schema";
import { withFirm } from "@/db/tenant";
import {
  type TestFirm,
  type TestMember,
  addTestMember,
  createOwnerPool,
  createTestFirm,
  removeTestFirm,
  removeTestUsers,
  requireDbEnv,
} from "@/db/test-helpers";
import type { AppRole } from "@/lib/auth/permissions";
import { loadBillingSettings, saveBillingSettingsCore } from "./billing";
import { FORBIDDEN_MESSAGE, type SettingsActor } from "./common";

// Settings → Billing & invoices against the real database (invoicing spec
// rule 1 acceptance tests; decisions #5, #28).

let pool: Pool;
let A: TestFirm;
let B: TestFirm;
let pm: TestMember;
let staff: TestMember;

beforeAll(async () => {
  requireDbEnv();
  pool = createOwnerPool();
  A = await createTestFirm(pool, "A");
  B = await createTestFirm(pool, "B");
  pm = await addTestMember(pool, A, { firstName: "Pat", lastName: "Manager", role: "project_manager" });
  staff = await addTestMember(pool, A, { firstName: "Sam", lastName: "Staff", role: "staff" });
});

afterAll(async () => {
  if (pool) {
    if (A) await removeTestFirm(pool, A);
    if (B) await removeTestFirm(pool, B);
    await removeTestUsers(pool, [pm, staff].filter(Boolean).map((m) => m.userId));
    await pool.end();
  }
  await closeDb();
});

const actorFor = (who: { userId: string; membershipId: string }, appRole: AppRole): SettingsActor => ({
  firmId: A.firmId,
  firmName: "Test Firm",
  clerkOrgId: A.clerkOrgId,
  userId: who.userId,
  clerkUserId: `clerk_${who.userId}`,
  member: { membershipId: who.membershipId, appRole, active: true },
});
const owner = () => actorFor(A, "owner");
const load = (firm: TestFirm) => withFirm(firm.firmId, loadBillingSettings);

describe("saveBillingSettings", () => {
  it("an owner saves TMG's formats, and each change is logged", async () => {
    const r = await saveBillingSettingsCore(owner(), { invoiceNumberFormat: " {PROJECT}-{##} ", projectNumberFormat: "{YY}{###}" });
    expect(r.ok).toBe(true);
    const s = await load(A);
    expect(s.invoiceNumberFormat).toBe("{PROJECT}-{##}");
    expect(s.projectNumberFormat).toBe("{YY}{###}");
    const [log] = await withFirm(A.firmId, (db) =>
      db
        .select()
        .from(activityLog)
        .where(and(eq(activityLog.entityType, "firm_settings"), eq(activityLog.entityId, A.firmId)))
        .orderBy(desc(activityLog.createdAt))
        .limit(1),
    );
    expect(log.changes).toEqual({
      invoice_number_format: { before: "A-{###}", after: "{PROJECT}-{##}" },
      project_number_format: { before: "{YYYY}-{###}", after: "{YY}{###}" },
    });
  });

  it("saves only the fields sent, so the next invoice number isn't put back", async () => {
    // Pretend an invoice was sent meanwhile and took number 128.
    await saveBillingSettingsCore(owner(), { nextInvoiceNumber: 129 });
    const r = await saveBillingSettingsCore(owner(), { remittanceText: "  Make checks payable to Test A.  " });
    expect(r.ok).toBe(true);
    const s = await load(A);
    expect(s.nextInvoiceNumber).toBe(129);
    expect(s.remittanceText).toBe("Make checks payable to Test A.");
    await saveBillingSettingsCore(owner(), { remittanceText: "" });
    expect((await load(A)).remittanceText).toBe("");
  });

  it("rejects a bad format, next number or terms with a field error and changes nothing", async () => {
    const before = await load(A);
    for (const [patch, field, message] of [
      [{ invoiceNumberFormat: "{YYYY}" }, "invoiceNumberFormat", "Add a counter, like {###}."],
      [{ invoiceNumberFormat: "{###}-{##}" }, "invoiceNumberFormat", "Use only one counter."],
      [{ invoiceNumberFormat: "<b>{###}" }, "invoiceNumberFormat", /^Only letters/],
      [{ projectNumberFormat: "{PROJECT}-{##}" }, "projectNumberFormat", "{PROJECT} can't be used in a project number."],
      [{ nextInvoiceNumber: 0 }, "nextInvoiceNumber", "The next number must be 1 or more."],
      [{ paymentTermsDays: 400 }, "paymentTermsDays", "Terms can be up to 365 days."],
    ] as const) {
      const r = await saveBillingSettingsCore(owner(), patch);
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      const got = r.fieldErrors?.[field];
      if (typeof message === "string") expect(got).toBe(message);
      else expect(got).toMatch(message);
    }
    expect(await load(A)).toEqual(before);
  });

  it("a PM or staff member gets 403", async () => {
    for (const who of [actorFor(pm, "project_manager"), actorFor(staff, "staff")]) {
      const r = await saveBillingSettingsCore(who, { paymentTermsDays: 15 });
      expect(r).toEqual({ ok: false, error: FORBIDDEN_MESSAGE });
    }
    expect((await load(A)).paymentTermsDays).toBe(30);
  });

  it("another firm's settings don't change", async () => {
    await saveBillingSettingsCore(owner(), { paymentTermsDays: 45 });
    expect((await load(A)).paymentTermsDays).toBe(45);
    expect(await load(B)).toMatchObject({ paymentTermsDays: 30, invoiceNumberFormat: "B-{###}", nextInvoiceNumber: 1 });
  });
});
