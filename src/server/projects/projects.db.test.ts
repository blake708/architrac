import type { Pool } from "@neondatabase/serverless";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { activityLog, phaseTemplates, projectMembers, projectPhases, projects } from "@/db/schema";
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
import { PROJECT_MESSAGES } from "@/lib/projects/form";
import { archiveCompanyCore } from "@/server/contacts/contacts";
import { loadContacts } from "@/server/contacts/view";
import type { SettingsActor } from "@/server/settings/common";
import { createProjectCore } from "./create";
import { loadNewProjectOptions, loadProjects } from "./view";

// Projects against the real database (projects-list spec, acceptance tests;
// fixture F1 without time or invoices, which arrive in 1.6 and 1.8).

let pool: Pool;
let A: TestFirm;
let B: TestFirm;
let pm: TestMember;
let staff: TestMember;
const users: string[] = [];
let mobId: string;
let bistroId: string;

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
const viewAs = (who: { membershipId: string }, appRole: AppRole, firm = A) =>
  withFirm(firm.firmId, (db) => loadProjects(db, { appRole, active: true, membershipId: who.membershipId }));

/** The seed templates, as the page would send them for a total fee and hours. */
async function seedPhases(firm: TestFirm, fees: number[], hours: number[]) {
  const t = await withFirm(firm.firmId, (db) =>
    db
      .select()
      .from(phaseTemplates)
      .where(eq(phaseTemplates.isOptional, false))
      .orderBy(asc(phaseTemplates.sortOrder)),
  );
  return t.map((x, i) => ({
    templateId: x.id,
    code: x.code,
    name: x.name,
    feeType: x.defaultFeeType,
    feeCents: fees[i] ?? 0,
    budgetHours: hours[i] ?? 0,
  }));
}

const input = (over: Record<string, unknown> = {}) => ({
  number: "2026-014",
  name: "Medical Office Building",
  clientCompanyId: A.companyId,
  clientContactId: null,
  projectType: "Medical office",
  scopeKind: "ground_up",
  status: "active",
  principalMembershipId: A.membershipId,
  pmMembershipId: pm.membershipId,
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  squareFeet: null,
  constructionCostCents: 620_000_000,
  startDate: "",
  targetEndDate: "",
  totalFeeCents: 0,
  totalBudgetHours: 0,
  phases: [] as unknown[],
  ...over,
});

beforeAll(async () => {
  requireDbEnv();
  pool = createOwnerPool();
  A = await createTestFirm(pool, "Projects");
  B = await createTestFirm(pool, "OtherProjects");
  pm = await addTestMember(pool, A, { firstName: "Jo", lastName: "Rivera", role: "project_manager" });
  staff = await addTestMember(pool, A, { firstName: "Kim", lastName: "Lee", role: "staff" });
  users.push(pm.userId, staff.userId);
  // The test firm starts with one project of its own ("2026-001"); archive it
  // so the list matches fixture F1.
  await asFirm(pool, A.firmId, (c) => c.query("update projects set archived_at = now() where id = $1", [A.projectId]));

  const mobFees = [930_000, 2_790_000, 4_650_000, 6_510_000, 930_000, 2_790_000, 0];
  const mob = await createProjectCore(
    owner(),
    input({
      totalFeeCents: 18_600_000,
      totalBudgetHours: 1240,
      phases: await seedPhases(A, mobFees, [62, 186, 310, 434, 62, 186, 0]),
    }),
  );
  if (!mob.ok) throw new Error(JSON.stringify(mob));
  mobId = mob.data.id;

  const bistro = await createProjectCore(
    owner(),
    input({
      number: "2026-011",
      name: "Pine Street Bistro",
      projectType: "Restaurant",
      pmMembershipId: A.membershipId,
      constructionCostCents: null,
      totalFeeCents: 4_100_000,
      totalBudgetHours: 300,
      phases: [{ templateId: null, code: "ALL", name: "Full service", feeType: "fixed", feeCents: 4_100_000, budgetHours: 300 }],
    }),
  );
  if (!bistro.ok) throw new Error(JSON.stringify(bistro));
  bistroId = bistro.data.id;
  await withFirm(A.firmId, (db) =>
    db.insert(projectMembers).values({ firmId: A.firmId, projectId: bistroId, membershipId: staff.membershipId, projectRole: "Designer" }),
  );

  const westside = await createProjectCore(
    owner(),
    input({
      number: "2025-004",
      name: "Westside Tire & Service",
      projectType: "Retail",
      constructionCostCents: 64_000_000,
      phases: [{ templateId: null, code: "ALL", name: "Full service", feeType: "hourly", feeCents: 0, budgetHours: 0 }],
    }),
  );
  if (!westside.ok) throw new Error(JSON.stringify(westside));
  await asFirm(pool, A.firmId, (c) =>
    c.query("update projects set status = 'closed', closed_on = '2025-12-01' where id = $1", [westside.data.id]),
  );
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

describe("creating a project", () => {
  it("writes phases in order, the first current, PM + principal on the team, and one log row", async () => {
    const phases = await withFirm(A.firmId, (db) =>
      db.select().from(projectPhases).where(eq(projectPhases.projectId, mobId)).orderBy(asc(projectPhases.sortOrder)),
    );
    expect(phases.map((p) => p.sortOrder)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(phases.map((p) => p.status)).toEqual(["current", ...Array(6).fill("upcoming")]);
    expect(phases.reduce((n, p) => n + p.feeCents, 0)).toBe(18_600_000);
    expect(phases[0].budgetHours).toBe("62.00");
    // Template descriptions are copied over.
    const [pd] = await withFirm(A.firmId, (db) =>
      db.select({ d: phaseTemplates.description }).from(phaseTemplates).where(eq(phaseTemplates.code, phases[0].code)),
    );
    expect(phases[0].description).toBe(pd.d);

    const team = await withFirm(A.firmId, (db) =>
      db.select().from(projectMembers).where(eq(projectMembers.projectId, mobId)),
    );
    expect(team.map((m) => [m.membershipId, m.projectRole]).sort()).toEqual(
      [
        [pm.membershipId, "PM"],
        [A.membershipId, "Principal"],
      ].sort(),
    );
    const logs = await withFirm(A.firmId, (db) =>
      db.select().from(activityLog).where(and(eq(activityLog.entityType, "project"), eq(activityLog.entityId, mobId))),
    );
    expect(logs).toHaveLength(1);
    expect(logs[0].changes).toMatchObject({ phaseCount: 7, totalFeeCents: 18_600_000 });
  });

  it("the same person as PM and principal gets one PM row", async () => {
    const team = await withFirm(A.firmId, (db) =>
      db.select().from(projectMembers).where(eq(projectMembers.projectId, bistroId)),
    );
    expect(team.filter((m) => m.membershipId === A.membershipId).map((m) => m.projectRole)).toEqual(["PM"]);
  });

  it("a project that isn't active starts with every phase upcoming", async () => {
    const r = await createProjectCore(
      owner(),
      input({ number: "2026-090", status: "pursuit", phases: [{ templateId: null, code: "A", name: "A", feeType: "fixed", feeCents: 0, budgetHours: 0 }] }),
    );
    if (!r.ok) throw new Error(JSON.stringify(r));
    const ph = await withFirm(A.firmId, (db) => db.select().from(projectPhases).where(eq(projectPhases.projectId, r.data.id)));
    expect(ph.map((p) => p.status)).toEqual(["upcoming"]);
  });

  it("number already used, ignoring case", async () => {
    const r = await createProjectCore(owner(), input({ number: "2026-014", phases: [{ templateId: null, code: "A", name: "A", feeType: "fixed", feeCents: 0, budgetHours: 0 }] }));
    expect(r).toEqual({ ok: false, fieldErrors: { number: PROJECT_MESSAGES.numberUsed } });
  });

  it("server re-checks the sums, the cap and at least one phase", async () => {
    const one = (o: Record<string, unknown>) => [{ templateId: null, code: "A", name: "A", feeType: "fixed", feeCents: 100, budgetHours: 1, ...o }];
    const bad = [
      input({ number: "X-1", totalFeeCents: 101, totalBudgetHours: 1, phases: one({}) }),
      input({ number: "X-2", totalFeeCents: 100, totalBudgetHours: 2, phases: one({}) }),
      input({ number: "X-3", phases: one({ feeType: "nte", feeCents: 0, budgetHours: 0 }) }),
      input({ number: "X-4", phases: [] }),
    ];
    const errors = [];
    for (const b of bad) {
      const r = await createProjectCore(owner(), b);
      errors.push(r.ok ? null : r.fieldErrors?.phases);
    }
    expect(errors).toEqual([
      "Phase fees add up to $1; total fee is $1.01",
      "Phase hours add up to 1; total budget hours is 2",
      PROJECT_MESSAGES.nteCap,
      PROJECT_MESSAGES.noPhases,
    ]);
  });

  it("staff can't create; another firm's client is refused", async () => {
    const asStaff = actorFor(A, staff, "staff");
    expect(await createProjectCore(asStaff, input({ number: "X-5" }))).toEqual({ ok: false, error: PROJECT_MESSAGES.forbidden });
    const r = await createProjectCore(owner(), input({ number: "X-6", clientCompanyId: B.companyId, phases: [{ templateId: null, code: "A", name: "A", feeType: "fixed", feeCents: 0, budgetHours: 0 }] }));
    expect(r).toEqual({ ok: false, fieldErrors: { clientCompanyId: PROJECT_MESSAGES.notClient } });
  });

  it("a staff member can't be the PM", async () => {
    const r = await createProjectCore(owner(), input({ number: "X-7", pmMembershipId: staff.membershipId, phases: [{ templateId: null, code: "A", name: "A", feeType: "fixed", feeCents: 0, budgetHours: 0 }] }));
    expect(r).toEqual({ ok: false, fieldErrors: { pmMembershipId: PROJECT_MESSAGES.badPerson } });
  });
});

describe("the list", () => {
  it("owner: counts, order, KPIs and money on every row", async () => {
    const v = await viewAs(A, "owner");
    const visible = v.rows.filter((r) => ["2026-014", "2026-011", "2025-004"].includes(r.number));
    expect(visible.filter((r) => r.status === "active").map((r) => r.number)).toEqual(["2026-014", "2026-011"]);
    expect(v.counts.closed).toBe(1);
    const mob = v.rows.find((r) => r.number === "2026-014")!;
    expect(mob.money).toEqual({ feeCents: 18_600_000, billedCents: 0, billedPct: 0, health: "on_track" });
    expect(mob.phaseText).toBe("Pre-Design");
    expect(mob.pm?.name).toBe("Jo Rivera");
    expect(v.kpis).toMatchObject({ activeFeesCents: 22_700_000, billedCents: 0, flagged: 0 });
    expect(v.types).toEqual(["Medical office", "Restaurant", "Retail"]);
  });

  it("PM: no KPIs; money only on projects they manage", async () => {
    const v = await viewAs(pm, "project_manager");
    expect(v.kpis).toBeUndefined();
    expect(v.rows.find((r) => r.number === "2026-014")!.money?.feeCents).toBe(18_600_000);
    expect(v.rows.find((r) => r.number === "2026-011")!.money).toBeUndefined();
  });

  it("staff: only assigned projects and no fee values anywhere", async () => {
    const v = await viewAs(staff, "staff");
    expect(v.rows.map((r) => r.number)).toEqual(["2026-011"]);
    expect(v.showMoneyColumns).toBe(false);
    expect(v.canCreate).toBe(false);
    // Ids are hex, so they can contain "fee" by chance; ignore them.
    const text = JSON.stringify(v).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>");
    expect(text).not.toMatch(/fee|billed|health/i);
  });

  it("another firm sees none of these projects", async () => {
    const v = await viewAs(B, "owner", B);
    expect(v.rows.map((r) => r.number)).toEqual(["2026-001"]);
  });
});

describe("the new project form", () => {
  it("suggests the next number and lists the default templates", async () => {
    const o = await withFirm(A.firmId, (db) => loadNewProjectOptions(db, A.firmId, "America/New_York"));
    const year = new Date().getFullYear();
    expect(o.suggestedNumber).toBe(year === 2026 ? "2026-091" : `${year}-001`);
    expect(o.templates.length).toBeGreaterThan(0);
    expect(o.principals.map((p) => p.membershipId)).toEqual([A.membershipId]); // nobody marked → owners
    expect(o.pms.map((p) => p.membershipId)).not.toContain(staff.membershipId);
  });

  it("people marked Principal are the principal choices", async () => {
    await asFirm(pool, A.firmId, (c) => c.query("update memberships set is_principal = true where id = $1", [pm.membershipId]));
    const o = await withFirm(A.firmId, (db) => loadNewProjectOptions(db, A.firmId, "America/New_York"));
    expect(o.principals.map((p) => p.membershipId)).toEqual([pm.membershipId]);
    await asFirm(pool, A.firmId, (c) => c.query("update memberships set is_principal = false where id = $1", [pm.membershipId]));
  });
});

describe("contacts link-up", () => {
  it("the client lists its projects with where they stand", async () => {
    const v = await withFirm(A.firmId, (db) => loadContacts(db, { appRole: "owner", active: true }));
    const client = v.companies.find((c) => c.id === A.companyId)!;
    expect(client.projects.find((p) => p.id === mobId)?.note).toBe("Pre-Design");
  });

  it("a client on open projects can't be archived", async () => {
    const r = await archiveCompanyCore(owner(), A.companyId);
    expect(r.ok).toBe(false);
    const [row] = await withFirm(A.firmId, (db) => db.select().from(projects).where(eq(projects.id, mobId)));
    expect(row.archivedAt).toBeNull();
  });
});
