import type { Pool } from "@neondatabase/serverless";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { activityLog, companies, contacts } from "@/db/schema";
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
import { CONTACT_MESSAGES } from "@/lib/contacts/form";
import type { SettingsActor } from "@/server/settings/common";
import {
  archiveCompanyCore,
  archiveContactCore,
  saveCompanyCore,
  saveContactCore,
} from "./contacts";
import { loadContacts } from "./view";

// Contacts against the real database (contacts spec, acceptance tests that
// don't need projects or invoices).

let pool: Pool;
let A: TestFirm;
let B: TestFirm;
let pm: TestMember;
let staff: TestMember;
const users: string[] = [];

beforeAll(async () => {
  requireDbEnv();
  pool = createOwnerPool();
  A = await createTestFirm(pool, "Contacts");
  B = await createTestFirm(pool, "OtherContacts");
  pm = await addTestMember(pool, A, { firstName: "Pat", lastName: "Manager", role: "project_manager" });
  staff = await addTestMember(pool, A, { firstName: "Sam", lastName: "Staff", role: "staff" });
  users.push(pm.userId, staff.userId);
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

function actorFor(firm: TestFirm, who: { userId: string; membershipId: string }, appRole: AppRole): SettingsActor {
  return {
    firmId: firm.firmId,
    firmName: "Test",
    clerkOrgId: firm.clerkOrgId,
    userId: who.userId,
    clerkUserId: `clerk_${who.userId}`,
    member: { membershipId: who.membershipId, appRole, active: true },
  };
}
const owner = () => actorFor(A, A, "owner");
const asPm = () => actorFor(A, pm, "project_manager");
const asStaff = () => actorFor(A, staff, "staff");
const view = (appRole: AppRole, firm = A) =>
  withFirm(firm.firmId, (db) => loadContacts(db, { appRole, active: true }));

const company = (over: Record<string, unknown> = {}) => ({
  id: null,
  name: "Coastal Federal Credit Union",
  kind: "client",
  description: "Banking",
  phone: "",
  website: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  primaryContactId: null,
  billingContactId: null,
  notes: "",
  ...over,
});
const contact = (over: Record<string, unknown> = {}) => ({
  id: null,
  firstName: "Dana",
  lastName: "Diaz",
  designations: "",
  title: "Controller",
  companyId: null,
  email: "",
  phone: "",
  mobile: "",
  tags: [],
  notes: "",
  isMain: false,
  isBilling: false,
  ...over,
});

describe("what each role is sent", () => {
  it("owner gets money and QuickBooks status; nothing billed yet", async () => {
    const v = await view("owner");
    const c = v.companies.find((x) => x.id === A.companyId)!;
    expect(c.money).toEqual({ kind: "client", billedCents: 0, openCents: 0 });
    expect(c.quickbooksLinked).toBe(false);
    expect(v.kpis).toMatchObject({ openClients: 0, openCents: 0 });
    expect(v).toMatchObject({ canEdit: true, canArchive: true, seesMoney: true });
  });

  it("PM and staff get no money fields at all", async () => {
    for (const role of ["project_manager", "staff"] as const) {
      const v = await view(role);
      expect(JSON.stringify(v)).not.toMatch(/"money"|billedCents|openCents|feesCents|openClients|quickbooksLinked/);
    }
    expect(await view("project_manager")).toMatchObject({ canEdit: true, canArchive: false });
    expect(await view("staff")).toMatchObject({ canEdit: false, canArchive: false });
  });

  it("firm B can't see firm A's companies", async () => {
    const v = await view("owner", B);
    expect(v.companies.some((c) => c.id === A.companyId)).toBe(false);
  });
});

describe("companies", () => {
  let coastalId: string;

  it("a PM can create a company; it's missing a billing contact", async () => {
    const result = await saveCompanyCore(asPm(), company());
    expect(result.ok).toBe(true);
    if (result.ok) coastalId = result.data.id;
    const v = await view("owner");
    expect(v.companies.find((c) => c.id === coastalId)!.missingBilling).toBe(true);
    expect(v.kpis.missingBilling).toBe(1);
  });

  it("staff can't create a company and nothing is written", async () => {
    const before = (await view("owner")).companies.length;
    expect(await saveCompanyCore(asStaff(), company({ name: "Nope" }))).toEqual({
      ok: false,
      error: CONTACT_MESSAGES.forbidden,
    });
    expect((await view("owner")).companies.length).toBe(before);
  });

  it('ZIP "2940" is refused; a website gets https://', async () => {
    expect(await saveCompanyCore(owner(), company({ name: "Zip Co", postalCode: "2940" }))).toMatchObject({
      fieldErrors: { postalCode: CONTACT_MESSAGES.zip },
    });
    const ok = await saveCompanyCore(owner(), company({ name: "Web Co", kind: "vendor", website: "www.Web-Co.com/", state: "sc", postalCode: "29464-1234" }));
    if (!ok.ok) throw new Error("setup");
    const [row] = await withFirm(A.firmId, (db) => db.select().from(companies).where(eq(companies.id, ok.data.id)));
    expect(row).toMatchObject({ website: "https://www.Web-Co.com", state: "SC", postalCode: "29464-1234" });
  });

  it("a billing contact with no email still counts as missing", async () => {
    const r = await saveContactCore(owner(), contact({ companyId: coastalId, isBilling: true }));
    expect(r.ok).toBe(true);
    const v = await view("owner");
    expect(v.companies.find((c) => c.id === coastalId)!.missingBilling).toBe(true);
  });

  it("checking Billing contact sets the company's link and logs two rows", async () => {
    const r = await saveContactCore(owner(), contact({ firstName: "Bea", lastName: "Billing", email: "Bea@Coastal.org", companyId: coastalId, isBilling: true, isMain: true }));
    if (!r.ok) throw new Error(JSON.stringify(r));
    const [c] = await withFirm(A.firmId, (db) => db.select().from(companies).where(eq(companies.id, coastalId)));
    expect(c).toMatchObject({ billingContactId: r.data.id, primaryContactId: r.data.id });
    const logs = await withFirm(A.firmId, (db) =>
      db.select().from(activityLog).where(eq(activityLog.entityId, r.data.id)),
    );
    const companyLogs = await withFirm(A.firmId, (db) =>
      db.select().from(activityLog).where(and(eq(activityLog.entityId, coastalId), eq(activityLog.action, "updated"))),
    );
    expect(logs).toHaveLength(1);
    expect(companyLogs.length).toBeGreaterThanOrEqual(1);
    const [stored] = await withFirm(A.firmId, (db) => db.select().from(contacts).where(eq(contacts.id, r.data.id)));
    expect(stored.email).toBe("bea@coastal.org");
    expect((await view("owner")).companies.find((x) => x.id === coastalId)!.missingBilling).toBe(false);
  });

  it("the main contact must work at the company", async () => {
    expect(await saveCompanyCore(owner(), company({ id: coastalId, primaryContactId: A.contactId }))).toMatchObject({
      fieldErrors: { primaryContactId: CONTACT_MESSAGES.wrongCompanyContact },
    });
  });

  it("archiving the billing contact is blocked", async () => {
    const [c] = await withFirm(A.firmId, (db) => db.select().from(companies).where(eq(companies.id, coastalId)));
    expect(await archiveContactCore(owner(), c.billingContactId)).toEqual({
      ok: false,
      error: "Choose another billing contact for Coastal Federal Credit Union first.",
    });
  });

  it("a PM can't archive", async () => {
    expect(await archiveCompanyCore(asPm(), coastalId)).toEqual({ ok: false, error: CONTACT_MESSAGES.forbidden });
  });

  it("archiving a company hides it; its people show (archived company)", async () => {
    expect(await archiveCompanyCore(owner(), coastalId)).toEqual({ ok: true, data: { name: "Coastal Federal Credit Union" } });
    const v = await view("owner");
    expect(v.companies.some((c) => c.id === coastalId)).toBe(false);
    const bea = v.contacts.find((p) => p.firstName === "Bea")!;
    expect(bea.companyArchived).toBe(true);
    expect(v.archivedCompanyNames[coastalId]).toBe("Coastal Federal Credit Union");
  });
});

describe("contacts", () => {
  it("moving a contact to another company clears the old billing link", async () => {
    const other = await saveCompanyCore(owner(), company({ name: "Mill Creek Pediatrics" }));
    if (!other.ok) throw new Error("setup");
    const r = await saveContactCore(owner(), contact({ id: A.contactId, firstName: "Bill", lastName: "Payer", email: "bill@example.com", companyId: other.data.id }));
    expect(r.ok).toBe(true);
    const [old] = await withFirm(A.firmId, (db) => db.select().from(companies).where(eq(companies.id, A.companyId)));
    expect(old.billingContactId).toBeNull();
  });

  it("a contact with no billing role can be archived", async () => {
    const r = await saveContactCore(owner(), contact({ firstName: "Temp" }));
    if (!r.ok) throw new Error("setup");
    expect(await archiveContactCore(owner(), r.data.id)).toEqual({ ok: true, data: { name: "Temp Diaz" } });
    expect((await view("owner")).contacts.some((p) => p.id === r.data.id)).toBe(false);
  });

  it("tags are de-duplicated ignoring case", async () => {
    const r = await saveContactCore(owner(), contact({ firstName: "Tag", tags: ["Site", "site", "Billing"] }));
    if (!r.ok) throw new Error("setup");
    const [row] = await withFirm(A.firmId, (db) => db.select().from(contacts).where(eq(contacts.id, r.data.id)));
    expect(row.tags).toEqual(["Site", "Billing"]);
  });
});
