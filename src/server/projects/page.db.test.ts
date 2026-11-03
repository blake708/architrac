import type { Pool } from "@neondatabase/serverless";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { activityLog, companies, contacts, projectMembers, projects } from "@/db/schema";
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
import { PROJECT_MESSAGES } from "@/lib/projects/form";
import { loadContacts } from "@/server/contacts/view";
import type { SettingsActor } from "@/server/settings/common";
import { createProjectCore } from "./create";
import {
  addLinkCore,
  removeConsultantCore,
  removeLinkCore,
  removeMemberCore,
  saveConsultantCore,
  saveMemberCore,
  updateProjectCore,
} from "./edit";
import { loadProjectPage } from "./page";

// The project page and its edits against the real database
// (project-detail spec; time and invoices arrive in 1.6 and 1.8).

let pool: Pool;
let A: TestFirm;
let B: TestFirm;
let pm: TestMember;
let staff: TestMember;
let outsider: TestMember;
const users: string[] = [];
let mobId: string;
let otherId: string;
let mepId: string;
let mepContactId: string;
let gcId: string;

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
const page = (who: { membershipId: string }, appRole: AppRole, id = mobId, firm = A) =>
  withFirm(firm.firmId, (db) => loadProjectPage(db, { appRole, active: true, membershipId: who.membershipId }, id));
const noIds = (v: unknown) =>
  JSON.stringify(v).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>");

const project = (over: Record<string, unknown>) => ({
  number: "2026-014",
  name: "Medical Office Building",
  clientCompanyId: A.companyId,
  clientContactId: null,
  projectType: "Medical office",
  scopeKind: null,
  status: "active",
  principalMembershipId: A.membershipId,
  pmMembershipId: A.membershipId,
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  squareFeet: 20000,
  constructionCostCents: 620_000_000,
  startDate: "2026-08-03",
  targetEndDate: "",
  totalFeeCents: 18_600_000,
  totalBudgetHours: 1240,
  phases: [
    { templateId: null, code: "SD", name: "Schematic Design", feeType: "fixed", feeCents: 9_300_000, budgetHours: 620 },
    { templateId: null, code: "CD", name: "Construction Documents", feeType: "fixed", feeCents: 9_300_000, budgetHours: 620 },
  ],
  ...over,
});
const editInput = (over: Record<string, unknown> = {}) => {
  const rest: Record<string, unknown> = project({});
  for (const k of ["totalFeeCents", "totalBudgetHours", "phases"]) delete rest[k];
  return { ...rest, id: mobId, pmMembershipId: pm.membershipId, ...over };
};

beforeAll(async () => {
  requireDbEnv();
  pool = createOwnerPool();
  A = await createTestFirm(pool, "ProjectPage");
  B = await createTestFirm(pool, "OtherProjectPage");
  pm = await addTestMember(pool, A, { firstName: "Jo", lastName: "Rivera", role: "project_manager" });
  staff = await addTestMember(pool, A, { firstName: "Kim", lastName: "Lee", role: "staff" });
  outsider = await addTestMember(pool, A, { firstName: "Ann", lastName: "Park", role: "staff" });
  users.push(pm.userId, staff.userId, outsider.userId);

  const mob = await createProjectCore(owner(), project({ pmMembershipId: pm.membershipId }));
  if (!mob.ok) throw new Error(JSON.stringify(mob));
  mobId = mob.data.id;
  const other = await createProjectCore(owner(), project({ number: "2026-011", name: "Pine Street Bistro" }));
  if (!other.ok) throw new Error(JSON.stringify(other));
  otherId = other.data.id;

  await withFirm(A.firmId, async (db) => {
    await db.insert(projectMembers).values({ firmId: A.firmId, projectId: mobId, membershipId: staff.membershipId, projectRole: "Designer" });
    const [mep] = await db.insert(companies).values({ firmId: A.firmId, name: "Coastal MEP Engineers", kind: "consultant" }).returning();
    mepId = mep.id;
    const [ravi] = await db
      .insert(contacts)
      .values({ firmId: A.firmId, companyId: mep.id, firstName: "Ravi", lastName: "Kumar", title: "Principal", email: "ravi@coastalmep.com" })
      .returning();
    mepContactId = ravi.id;
    const [gc] = await db.insert(companies).values({ firmId: A.firmId, name: "Holder Builders", kind: "contractor" }).returning();
    gcId = gc.id;
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

describe("who sees what", () => {
  it("owner: financial view, rate overrides, edit options", async () => {
    const p = (await page(A, "owner"))!;
    expect(p.financial).toBe(true);
    expect(p.money).toMatchObject({ feeCents: 18_600_000, billedCents: 0, health: "on_track" });
    expect(p.phases[0].money?.feeCents).toBe(9_300_000);
    expect(p.team.map((m) => [m.projectRole, m.isPrincipal, m.isPm])).toEqual([
      ["Principal", true, false],
      ["PM", false, true],
      ["Designer", false, false],
    ]);
    expect(p.team[0]).toHaveProperty("rateOverrideCents");
    expect(p.canEdit && p.canSetOverride).toBe(true);
    expect(p.edit?.defaultMarkupBp).toBe(1000);
  });

  it("own PM: financial and can edit, but never sees rate overrides", async () => {
    const p = (await page(pm, "project_manager"))!;
    expect(p.financial && p.canEdit).toBe(true);
    expect(p.canSetOverride).toBe(false);
    expect(p.team.some((m) => "rateOverrideCents" in m)).toBe(false);
  });

  it("a PM on someone else's project gets the basic view, read-only", async () => {
    const p = (await page(pm, "project_manager", otherId))!;
    expect(p.financial || p.canEdit).toBe(false);
    expect(p.money).toBeUndefined();
    expect(p.edit).toBeUndefined();
  });

  it("staff on the team: basic view with no money anywhere", async () => {
    const p = (await page(staff, "staff"))!;
    expect(p.financial).toBe(false);
    // Activity may name the fields that changed, never their values.
    expect(noIds({ ...p, activity: [] })).not.toMatch(/feeCents|billed|budgetHours|health|rateOverride|markup/i);
    for (const a of p.activity)
      for (const [k, v] of Object.entries(a.changes ?? {})) if (k !== "status") expect(v).toBeNull();
  });

  it("staff not on the team, and other firms, get nothing", async () => {
    expect(await page(outsider, "staff")).toBeNull();
    expect(await page(B, "owner", mobId, B)).toBeNull();
    expect(await page(A, "owner", "not-a-uuid")).toBeNull();
  });
});

describe("edit project", () => {
  it("a PM on someone else's project can't edit it", async () => {
    const r = await updateProjectCore(asPm(), { ...editInput(), id: otherId, number: "2026-011", pmMembershipId: A.membershipId }, "America/New_York");
    expect(r).toEqual({ ok: false, error: PROJECT_MESSAGES.editForbidden });
  });

  it("closing sets closed_on and logs status_changed; reopening clears it", async () => {
    expect((await updateProjectCore(asPm(), editInput({ status: "closed" }), "America/New_York")).ok).toBe(true);
    let [row] = await withFirm(A.firmId, (db) => db.select().from(projects).where(eq(projects.id, mobId)));
    expect(row.status).toBe("closed");
    expect(row.closedOn).not.toBeNull();
    const logs = await withFirm(A.firmId, (db) =>
      db.select().from(activityLog).where(and(eq(activityLog.entityId, mobId), eq(activityLog.action, "status_changed"))),
    );
    expect(logs).toHaveLength(1);
    await updateProjectCore(asPm(), editInput({ status: "active" }), "America/New_York");
    [row] = await withFirm(A.firmId, (db) => db.select().from(projects).where(eq(projects.id, mobId)));
    expect(row.closedOn).toBeNull();
  });

  it("a duplicate number is refused", async () => {
    const r = await updateProjectCore(owner(), editInput({ number: "2026-011" }), "America/New_York");
    expect(r).toEqual({ ok: false, fieldErrors: { number: PROJECT_MESSAGES.numberUsed } });
  });
});

describe("team", () => {
  it("add a person; PMs can't send a rate override; owners can", async () => {
    const add = await saveMemberCore(asPm(), { id: null, projectId: mobId, membershipId: outsider.membershipId, projectRole: "Interior designer" });
    expect(add.ok).toBe(true);
    const dupe = await saveMemberCore(asPm(), { id: null, projectId: mobId, membershipId: outsider.membershipId, projectRole: "PA" });
    expect(dupe).toEqual({ ok: false, fieldErrors: { membershipId: PROJECT_MESSAGES.alreadyOnTeam } });
    const id = add.ok ? add.data.id : "";
    expect(
      await saveMemberCore(asPm(), { id, projectId: mobId, membershipId: outsider.membershipId, projectRole: "PA", billRateOverrideCents: 9000 }),
    ).toEqual({ ok: false, error: PROJECT_MESSAGES.editForbidden });
    expect(
      (await saveMemberCore(owner(), { id, projectId: mobId, membershipId: outsider.membershipId, projectRole: "PA", billRateOverrideCents: 18_500 })).ok,
    ).toBe(true);
    const p = (await page(A, "owner"))!;
    expect(p.team.find((m) => m.membershipId === outsider.membershipId)).toMatchObject({ projectRole: "PA", rateOverrideCents: 18_500 });
    // Now on the team, they can open the project.
    expect(await page(outsider, "staff")).not.toBeNull();
  });

  it("the PM and principal can't be removed; others can", async () => {
    const p = (await page(A, "owner"))!;
    const pmRow = p.team.find((m) => m.isPm)!;
    expect(await removeMemberCore(owner(), { projectId: mobId, id: pmRow.id })).toEqual({ ok: false, error: PROJECT_MESSAGES.keepPmPrincipal });
    const ann = p.team.find((m) => m.membershipId === outsider.membershipId)!;
    expect((await removeMemberCore(owner(), { projectId: mobId, id: ann.id })).ok).toBe(true);
    expect(await page(outsider, "staff")).toBeNull();
  });
});

describe("consultants", () => {
  it("fee to client with markup; shows in Contacts with the discipline and fees", async () => {
    const r = await saveConsultantCore(asPm(), {
      id: null,
      projectId: mobId,
      companyId: mepId,
      contactId: mepContactId,
      discipline: "MEP",
      feeCents: 3_680_000,
      markupBp: 1000,
      billedThrough: true,
    });
    expect(r.ok).toBe(true);
    const p = (await page(A, "owner"))!;
    expect(p.consultants[0]).toMatchObject({
      companyName: "Coastal MEP Engineers",
      discipline: "MEP",
      contact: { name: "Ravi Kumar", title: "Principal", email: "ravi@coastalmep.com" },
      money: { feeCents: 3_680_000, feeToClientCents: 4_048_000 },
    });
    // The basic view gets the consultant but not the money.
    expect((await page(staff, "staff"))!.consultants[0].money).toBeUndefined();

    const v = await withFirm(A.firmId, (db) => loadContacts(db, { appRole: "owner", active: true }));
    const mep = v.companies.find((c) => c.id === mepId)!;
    expect(mep.projects).toEqual([{ id: mobId, name: "Medical Office Building", note: "MEP" }]);
    expect(mep.money).toEqual({ kind: "consultant", feesCents: 3_680_000 });

    if (r.ok) expect((await removeConsultantCore(asPm(), { projectId: mobId, id: r.data.id })).ok).toBe(true);
    expect((await page(A, "owner"))!.consultants).toHaveLength(0);
  });

  it("only consultant companies, and only their own contacts", async () => {
    const base = { id: null, projectId: mobId, contactId: null, discipline: "Civil", feeCents: 0, markupBp: 0, billedThrough: true };
    expect(await saveConsultantCore(owner(), { ...base, companyId: gcId })).toEqual({
      ok: false,
      fieldErrors: { companyId: PROJECT_MESSAGES.notConsultant },
    });
    expect(await saveConsultantCore(owner(), { ...base, companyId: mepId, contactId: A.contactId })).toEqual({
      ok: false,
      fieldErrors: { contactId: PROJECT_MESSAGES.badCompanyContact },
    });
  });
});

describe("contractors, agencies, vendors", () => {
  it("link with a role; no clients; no duplicates; remove", async () => {
    const r = await addLinkCore(asPm(), { projectId: mobId, companyId: gcId, contactId: null, role: "General contractor" });
    expect(r.ok).toBe(true);
    expect(await addLinkCore(asPm(), { projectId: mobId, companyId: gcId, contactId: null, role: "" })).toEqual({
      ok: false,
      fieldErrors: { companyId: PROJECT_MESSAGES.alreadyLinked },
    });
    expect(await addLinkCore(asPm(), { projectId: mobId, companyId: A.companyId, contactId: null, role: "" })).toEqual({
      ok: false,
      fieldErrors: { companyId: PROJECT_MESSAGES.notLinkable },
    });
    const p = (await page(A, "owner"))!;
    expect(p.linked).toMatchObject([{ companyName: "Holder Builders", kind: "contractor", role: "General contractor" }]);
    const v = await withFirm(A.firmId, (db) => loadContacts(db, { appRole: "owner", active: true }));
    expect(v.companies.find((c) => c.id === gcId)!.projects).toEqual([
      { id: mobId, name: "Medical Office Building", note: "General contractor" },
    ]);
    if (r.ok) expect((await removeLinkCore(asPm(), { projectId: mobId, id: r.data.id })).ok).toBe(true);
    expect((await page(A, "owner"))!.linked).toHaveLength(0);
  });
});

describe("recent activity", () => {
  it("lists project and team changes, newest first, with values hidden from the basic view", async () => {
    const p = (await page(A, "owner"))!;
    expect(p.activity.length).toBeGreaterThan(3);
    expect(p.activity.some((a) => a.action === "status_changed")).toBe(true);
    const basic = (await page(staff, "staff"))!;
    const changed = basic.activity.find((a) => a.action === "status_changed")!;
    expect(changed.changes).toMatchObject({ status: { after: "active" } });
    const updated = basic.activity.find((a) => a.entityType === "consultant" && a.action === "created");
    if (updated?.changes) expect(Object.values(updated.changes).every((x) => x === null)).toBe(true);
  });
});
