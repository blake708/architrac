import type { Pool } from "@neondatabase/serverless";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { activityLog, consultants, projectPhaseRoles, projectPhases, projectTypeBenchmarks, projects } from "@/db/schema";
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
import { benchmarkKey } from "@/lib/calc/benchmarks";
import { PROJECT_MESSAGES } from "@/lib/projects/form";
import { BENCHMARK_MESSAGES } from "@/lib/settings/benchmarks";
import { saveBenchmarksCore } from "@/server/settings/benchmarks";
import type { SettingsActor } from "@/server/settings/common";
import { createProjectCore } from "./create";
import { loadBenchmarkSources } from "./estimate";
import { loadNewProjectOptions } from "./view";

// New project in two steps (Blake, 2026-11-04): Settings ranges, where the
// estimate comes from, and creating a project with custom phases, roles and
// consultants.

let pool: Pool;
let A: TestFirm;
let B: TestFirm;
let pm: TestMember;
const users: string[] = [];
let mepId: string;
let raviId: string;
let otherContactId: string;

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

const range = (projectType: string, scopeKind: string | null, over: Record<string, unknown> = {}) => ({
  id: null,
  projectType,
  scopeKind,
  costPerSfLowCents: 29_000,
  costPerSfHighCents: 33_000,
  feeLowBp: 280,
  feeHighBp: 340,
  ...over,
});

let n = 100;
const input = (over: Record<string, unknown> = {}) => ({
  number: `T-${n++}`,
  name: "Test project",
  clientCompanyId: A.companyId,
  clientContactId: null,
  projectType: "Medical office",
  scopeKind: "ground_up",
  status: "active",
  principalMembershipId: A.membershipId,
  pmMembershipId: A.membershipId,
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  squareFeet: 10_000,
  constructionCostCents: 300_000_000,
  startDate: "",
  targetEndDate: "",
  totalFeeCents: 9_000_000,
  totalBudgetHours: 0,
  phases: [{ templateId: null, code: "ALL", name: "Full service", feeType: "fixed", feeCents: 9_000_000, budgetHours: 0 }],
  ...over,
});

beforeAll(async () => {
  requireDbEnv();
  pool = createOwnerPool();
  A = await createTestFirm(pool, "NewProject");
  B = await createTestFirm(pool, "NewProject B");
  pm = await addTestMember(pool, A, { firstName: "Jo", lastName: "Rivera", role: "project_manager" });
  users.push(pm.userId);
  // The helper's own project would count as a past project; archive it.
  await asFirm(pool, A.firmId, (c) => c.query("update projects set archived_at = now() where id = $1", [A.projectId]));
  [mepId, raviId, otherContactId] = await asFirm(pool, A.firmId, async (c) => {
    const mep = await c.query<{ id: string }>("insert into companies (firm_id, name, kind) values ($1, 'Coastal MEP', 'consultant') returning id", [A.firmId]);
    const ravi = await c.query<{ id: string }>(
      "insert into contacts (firm_id, company_id, first_name, last_name) values ($1, $2, 'Ravi', 'Kumar') returning id",
      [A.firmId, mep.rows[0].id],
    );
    const other = await c.query<{ id: string }>(
      "insert into contacts (firm_id, company_id, first_name, last_name) values ($1, $2, 'Cal', 'Client') returning id",
      [A.firmId, A.companyId],
    );
    return [mep.rows[0].id, ravi.rows[0].id, other.rows[0].id];
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

describe("Settings → project type ranges", () => {
  it("only owners and admins save them", async () => {
    expect(await saveBenchmarksCore(asPm(), { rows: [range("Retail", null)] })).toMatchObject({ ok: false });
  });

  it("checks each row and refuses a duplicate type + scope", async () => {
    const r = await saveBenchmarksCore(owner(), {
      rows: [range("Retail", null, { feeHighBp: 200 }), range("retail ", null), range("", null)],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fieldErrors).toMatchObject({
      "rows.0.feeHighBp": BENCHMARK_MESSAGES.feeOrder,
      "rows.1.projectType": BENCHMARK_MESSAGES.duplicate,
      "rows.2.projectType": BENCHMARK_MESSAGES.type,
    });
  });

  it("adds, updates and archives, with a log row for each", async () => {
    const first = await saveBenchmarksCore(owner(), { rows: [range("Retail", null), range("Retail", "shell"), range("Office", null)] });
    if (!first.ok) throw new Error(JSON.stringify(first));
    expect(first.data.rows.map((r) => `${r.projectType}|${r.scopeKind ?? ""}`)).toEqual(["Office|", "Retail|shell", "Retail|"]);
    const [office, shell, retail] = first.data.rows;
    const second = await saveBenchmarksCore(owner(), { rows: [{ ...retail, feeHighBp: 360 }, shell] });
    if (!second.ok) throw new Error(JSON.stringify(second));
    expect(second.data.rows).toHaveLength(2);
    const logs = await withFirm(A.firmId, (db) =>
      db.select({ action: activityLog.action, id: activityLog.entityId }).from(activityLog).where(eq(activityLog.entityType, "project_type_benchmark")),
    );
    expect(logs.filter((l) => l.action === "created")).toHaveLength(3);
    expect(logs).toContainEqual({ action: "updated", id: retail.id });
    expect(logs).toContainEqual({ action: "archived", id: office.id });
    // Archived, not deleted.
    const all = await withFirm(A.firmId, (db) => db.select({ id: projectTypeBenchmarks.id }).from(projectTypeBenchmarks));
    expect(all).toHaveLength(3);
  });

  it("another firm can't see or write them", async () => {
    expect(await withFirm(B.firmId, (db) => db.select().from(projectTypeBenchmarks))).toEqual([]);
    await expect(
      withFirm(B.firmId, (db) =>
        db.insert(projectTypeBenchmarks).values({ firmId: A.firmId, projectType: "Hack", costPerSfLowCents: 1, costPerSfHighCents: 1, feeLowBp: 1, feeHighBp: 1 }),
      ),
    ).rejects.toThrow();
  });
});

describe("where the estimate comes from", () => {
  it("Settings until there are 3 similar past projects; pursuits don't count", async () => {
    const make = (cost: number, fee: number, status = "active") =>
      createProjectCore(
        owner(),
        input({
          status,
          constructionCostCents: cost,
          totalFeeCents: fee,
          phases: [{ templateId: null, code: "ALL", name: "Full service", feeType: "fixed", feeCents: fee, budgetHours: 0 }],
        }),
      );
    await saveBenchmarksCore(owner(), { rows: [range("Medical office", null)] });
    expect(await make(300_000_000, 9_000_000)).toMatchObject({ ok: true }); // $300/SF, 3%
    expect((await make(320_000_000, 8_960_000)).ok).toBe(true); // $320/SF, 2.8%
    expect((await make(999_000_000, 1_000_000, "pursuit")).ok).toBe(true);
    let s = await withFirm(A.firmId, (db) => loadBenchmarkSources(db));
    expect(s.past[benchmarkKey("Medical office", null)]).toBeUndefined();
    expect(s.settings[benchmarkKey("medical office", null)]?.source.kind).toBe("settings");

    expect((await make(340_000_000, 11_560_000)).ok).toBe(true); // $340/SF, 3.4%
    s = await withFirm(A.firmId, (db) => loadBenchmarkSources(db));
    const past = s.past[benchmarkKey("Medical office", "ground_up")];
    expect(past).toEqual({
      costPerSfCents: { low: 31_000, typical: 32_000, high: 33_000 },
      feeBp: { low: 290, typical: 300, high: 320 },
      source: { kind: "past", count: 3, scoped: true },
    });
    // The options carry ranges only, never a project's own numbers.
    await asFirm(pool, A.firmId, (c) =>
      c.query("insert into phase_templates (firm_id, code, name, is_optional, sort_order) values ($1, 'AS', 'Additional Services', true, 50)", [A.firmId]),
    );
    const o = await withFirm(A.firmId, (db) => loadNewProjectOptions(db, A.firmId, "America/New_York"));
    expect(JSON.stringify(o.benchmarks)).not.toMatch(/11560000|feeCents|constructionCents/);
    // Optional phases come last and start unchecked on the page.
    expect(o.templates.at(-1)).toMatchObject({ code: "AS", isOptional: true });
  });
});

describe("creating with custom phases and consultants", () => {
  it("saves a custom phase with its roles, and consultants with a log row each", async () => {
    const r = await createProjectCore(
      owner(),
      input({
        totalFeeCents: 1_000_000,
        totalBudgetHours: 87,
        phases: [
          {
            templateId: null,
            code: "FS",
            name: "Feasibility study",
            feeType: "fixed",
            feeCents: 1_000_000,
            budgetHours: 87,
            mix: [{ firmRoleId: A.firmRoleId, shareBp: 10_000 }],
          },
        ],
        consultants: [
          { discipline: "MEP", companyId: mepId, contactId: raviId, feeCents: 1_200_000, markupBp: 1000, billedThrough: true },
          { discipline: "Civil", companyId: mepId, contactId: null, feeCents: 500_000, markupBp: 0, billedThrough: false },
        ],
      }),
    );
    if (!r.ok) throw new Error(JSON.stringify(r));
    const id = r.data.id;
    const [phase] = await withFirm(A.firmId, (db) => db.select().from(projectPhases).where(eq(projectPhases.projectId, id)));
    expect(phase).toMatchObject({ code: "FS", name: "Feasibility study", description: null, feeCents: 1_000_000 });
    const roles = await withFirm(A.firmId, (db) =>
      db.select().from(projectPhaseRoles).where(and(eq(projectPhaseRoles.projectPhaseId, phase.id), isNull(projectPhaseRoles.archivedAt))),
    );
    expect(roles.map((x) => [x.shareBp, x.rateCents, Number(x.hours)])).toEqual([[10_000, 11_500, 87]]);
    const cons = await withFirm(A.firmId, (db) => db.select().from(consultants).where(eq(consultants.projectId, id)));
    expect(cons.map((c) => [c.discipline, c.feeCents, c.markupBp, c.billedThrough, c.contactId])).toEqual([
      ["MEP", 1_200_000, 1000, true, raviId],
      ["Civil", 500_000, 0, false, null],
    ]);
    const logs = await withFirm(A.firmId, (db) =>
      db.select().from(activityLog).where(and(eq(activityLog.entityType, "consultant"), eq(activityLog.action, "created"))),
    );
    expect(logs.filter((l) => cons.some((c) => c.id === l.entityId))).toHaveLength(2);
  });

  it("refuses two phases with the same code", async () => {
    const r = await createProjectCore(
      owner(),
      input({
        totalFeeCents: 9_000_000,
        phases: [
          { templateId: null, code: "SD", name: "One", feeType: "fixed", feeCents: 4_500_000, budgetHours: 0 },
          { templateId: null, code: "sd", name: "Two", feeType: "fixed", feeCents: 4_500_000, budgetHours: 0 },
        ],
      }),
    );
    expect(r).toEqual({ ok: false, fieldErrors: { phases: PROJECT_MESSAGES.codeUsed } });
  });

  it("marks the consultant row that's wrong, and saves nothing", async () => {
    const before = await withFirm(A.firmId, (db) => db.select({ id: projects.id }).from(projects));
    const notConsultant = await createProjectCore(
      owner(),
      input({ consultants: [{ discipline: "MEP", companyId: mepId, contactId: null, feeCents: 1, markupBp: 0, billedThrough: true }, { discipline: "Civil", companyId: A.companyId, contactId: null, feeCents: 1, markupBp: 0, billedThrough: true }] }),
    );
    expect(notConsultant).toEqual({ ok: false, fieldErrors: { "consultants.1.companyId": PROJECT_MESSAGES.notConsultant } });
    const wrongContact = await createProjectCore(
      owner(),
      input({ consultants: [{ discipline: "MEP", companyId: mepId, contactId: otherContactId, feeCents: 1, markupBp: 0, billedThrough: true }] }),
    );
    expect(wrongContact).toEqual({ ok: false, fieldErrors: { "consultants.0.contactId": PROJECT_MESSAGES.badCompanyContact } });
    const badFee = await createProjectCore(
      owner(),
      input({ consultants: [{ discipline: "", companyId: mepId, contactId: null, feeCents: -5, markupBp: 0, billedThrough: true }] }),
    );
    expect(badFee.ok).toBe(false);
    if (!badFee.ok) expect(Object.keys(badFee.fieldErrors ?? {})).toEqual(["consultants.0.discipline", "consultants.0.feeCents"]);
    const after = await withFirm(A.firmId, (db) => db.select({ id: projects.id }).from(projects));
    expect(after).toHaveLength(before.length);
  });
});
