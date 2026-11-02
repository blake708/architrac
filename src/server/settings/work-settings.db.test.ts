import type { Pool } from "@neondatabase/serverless";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import {
  activities,
  activityLog,
  firmSettings,
  overheadCategories,
  phaseTemplates,
  rates,
} from "@/db/schema";
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
import {
  avgMultiplierHundredths,
  blendedBillRateCents,
  breakevenHundredths,
  multiplierHundredths,
  multiplierStatus,
  rolesFlagged,
} from "@/lib/calc/rates";
import type { PhasesForm } from "@/lib/settings/phases";
import type { RatesView } from "@/lib/settings/rates";
import type { TimeListsForm } from "@/lib/settings/time-lists";
import { FORBIDDEN_MESSAGE, type SettingsActor } from "./common";
import { loadPhases, savePhasesCore } from "./phases";
import {
  addRoleCore,
  archiveRoleCore,
  editRoleCore,
  loadRates,
  saveRatesCore,
} from "./rates";
import { loadTimeLists, saveTimeListsCore } from "./time-lists";

// Settings → Phases & fees, Roles & rates, Timesheet lists against the real
// database (settings-rates-phases spec, acceptance tests).

let pool: Pool;
/** Firm with the TMG roles and people. */
let T: TestFirm;
/** Firm for phases and timesheet lists. */
let A: TestFirm;
/** Another firm, to prove nothing of theirs changes. */
let B: TestFirm;
let pm: TestMember;
const users: string[] = [];

const TODAY = "2026-10-15";

// settings-rates-phases → Seed values (firm_roles + rates).
const TMG_ROLES = [
  { sort: 1, name: "Principal", desc: "Owners and partners", billable: true, bill: 18500, cost: 9500, people: 1 },
  { sort: 2, name: "Project manager", desc: "Runs projects and leads a team", billable: true, bill: 15000, cost: 6200, people: 1 },
  { sort: 3, name: "Project architect", desc: "Licensed, technical lead", billable: true, bill: 14500, cost: 5800, people: 2 },
  { sort: 4, name: "Designer", desc: "Production and design", billable: true, bill: 11500, cost: 4400, people: 6 },
  { sort: 5, name: "Interior designer", desc: "Finishes, FF&E", billable: true, bill: 12000, cost: 5200, people: 1 },
  { sort: 6, name: "Intern", desc: "Part-time", billable: true, bill: 7500, cost: 2400, people: 1 },
  { sort: 7, name: "Office manager", desc: "Overhead", billable: false, bill: 0, cost: 3800, people: 1 },
  { sort: 8, name: "Bookkeeper", desc: "Overhead · part-time", billable: false, bill: 0, cost: 4000, people: 1 },
];

async function seedTmg(firm: TestFirm) {
  // createTestFirm already made "Designer" ($115 / $44 from 2026-01-01).
  const ids = new Map<string, string>();
  await asFirm(pool, firm.firmId, async (c) => {
    for (const r of TMG_ROLES) {
      if (r.name === "Designer") {
        await c.query(
          "update firm_roles set sort_order = $1, description = $2 where id = $3",
          [r.sort, r.desc, firm.firmRoleId],
        );
        ids.set(r.name, firm.firmRoleId);
        continue;
      }
      const role = await c.query<{ id: string }>(
        "insert into firm_roles (firm_id, name, description, is_billable, sort_order) values ($1, $2, $3, $4, $5) returning id",
        [firm.firmId, r.name, r.desc, r.billable, r.sort],
      );
      ids.set(r.name, role.rows[0].id);
      await c.query(
        "insert into rates (firm_id, firm_role_id, bill_rate_cents, cost_rate_cents, effective_from) values ($1, $2, $3, $4, '2026-01-01')",
        [firm.firmId, role.rows[0].id, r.bill, r.cost],
      );
    }
  });
  for (const r of TMG_ROLES) {
    for (let i = 0; i < r.people; i++) {
      const m = await addTestMember(pool, firm, {
        firstName: r.name.replace(/\W/g, ""),
        lastName: `P${i}`,
        role: "staff",
      });
      users.push(m.userId);
      await asFirm(pool, firm.firmId, (c) =>
        c.query("update memberships set firm_role_id = $1 where id = $2", [
          ids.get(r.name),
          m.membershipId,
        ]),
      );
    }
  }
}

beforeAll(async () => {
  requireDbEnv();
  pool = createOwnerPool();
  T = await createTestFirm(pool, "Tmg");
  A = await createTestFirm(pool, "Lists");
  B = await createTestFirm(pool, "Other");
  await seedTmg(T);
  pm = await addTestMember(pool, T, {
    firstName: "Pat",
    lastName: "Manager",
    role: "project_manager",
  });
  users.push(pm.userId);
});

afterAll(async () => {
  if (pool) {
    for (const f of [T, A, B]) if (f) await removeTestFirm(pool, f);
    await removeTestUsers(pool, users);
    await pool.end();
  }
  await closeDb();
});

function actorFor(
  firm: TestFirm,
  who: { userId: string; membershipId: string },
  appRole: AppRole,
): SettingsActor {
  return {
    firmId: firm.firmId,
    firmName: "Test Firm",
    clerkOrgId: firm.clerkOrgId,
    userId: who.userId,
    clerkUserId: `clerk_${who.userId}`,
    member: { membershipId: who.membershipId, appRole, active: true },
  };
}
const ownerT = () => actorFor(T, T, "owner");
const ownerA = () => actorFor(A, A, "owner");
const pmT = () => actorFor(T, pm, "project_manager");

const view = (today = TODAY) =>
  withFirm(T.firmId, (db) => loadRates(db, T.firmId, today));
const role = (v: RatesView, name: string) =>
  v.roles.find((r) => r.name === name)!;

/** The Save (Rates) input for the current view, with some rates changed. */
function ratesInput(
  v: RatesView,
  changes: Record<string, { bill?: number; cost?: number }> = {},
  extra: Partial<{
    effectiveFrom: string | null;
    overheadPct: number;
    includeOverheadDefault: boolean;
  }> = {},
) {
  return {
    roles: v.roles.map((r) => ({
      id: r.id,
      billDollars: changes[r.name]?.bill ?? r.billCents / 100,
      costDollars: changes[r.name]?.cost ?? r.costCents / 100,
    })),
    effectiveFrom: extra.effectiveFrom ?? null,
    overheadPct: extra.overheadPct ?? v.overheadBp / 100,
    includeOverheadDefault:
      extra.includeOverheadDefault ?? v.includeOverheadDefault,
  };
}

const designerRates = () =>
  withFirm(T.firmId, (db) =>
    db
      .select()
      .from(rates)
      .where(eq(rates.firmRoleId, T.firmRoleId))
      .orderBy(asc(rates.effectiveFrom)),
  );

describe("Roles & rates", () => {
  it('KPIs read "$126 / h", "2.54×", "3", "1.60×" for the TMG seed', async () => {
    const v = await view();
    const facts = v.roles.map((r) => ({
      billCents: r.billCents,
      costCents: r.costCents,
      people: r.people,
    }));
    expect(blendedBillRateCents(facts)).toBe(12_583);
    expect(avgMultiplierHundredths(facts)).toBe(254);
    expect(rolesFlagged(facts)).toBe(3);
    expect(breakevenHundredths(v.overheadBp)).toBe(160);
  });

  it("Principal 1.95× flagged, Project architect 2.50× ok, Office manager not billable", async () => {
    const v = await view();
    const p = role(v, "Principal");
    expect(multiplierHundredths(p.billCents, p.costCents)).toBe(195);
    expect(multiplierStatus(p.billCents, p.costCents)).toBe("flagged");
    const pa = role(v, "Project architect");
    expect(multiplierHundredths(pa.billCents, pa.costCents)).toBe(250);
    expect(multiplierStatus(pa.billCents, pa.costCents)).toBe("ok");
    const om = role(v, "Office manager");
    expect(om.isBillable).toBe(false);
    expect(multiplierStatus(om.billCents, om.costCents)).toBe("none");
    expect(role(v, "Designer").people).toBe(6);
    expect(role(v, "Designer").effectiveFrom).toBe("2026-01-01");
  });

  it("a project manager gets access denied and no rates", async () => {
    const v = await view();
    const before = await designerRates();
    const result = await saveRatesCore(
      pmT(),
      ratesInput(v, { Designer: { bill: 999 } }, { effectiveFrom: TODAY }),
      TODAY,
    );
    expect(result).toEqual({ ok: false, error: FORBIDDEN_MESSAGE });
    expect(JSON.stringify(result)).not.toContain("4400");
    expect(await designerRates()).toEqual(before);
    for (const r of [
      await addRoleCore(pmT(), {}, TODAY),
      await editRoleCore(pmT(), {}, TODAY),
      await archiveRoleCore(pmT(), T.firmRoleId, TODAY),
    ])
      expect(r).toEqual({ ok: false, error: FORBIDDEN_MESSAGE });
  });

  it("rejects a date before the current rate starts, and writes nothing", async () => {
    const v = await view();
    const before = await designerRates();
    const result = await saveRatesCore(
      ownerT(),
      ratesInput(v, { Designer: { bill: 120 } }, { effectiveFrom: "2025-12-15" }),
      TODAY,
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toBe(
        "Pick Jan 1, 2026 or later — Designer's current rate starts then.",
      );
    expect(await designerRates()).toEqual(before);
  });

  it("the same date as the current rate updates that row in place", async () => {
    const v = await view();
    const pmRole = role(v, "Project manager");
    const result = await saveRatesCore(
      ownerT(),
      ratesInput(v, { "Project manager": { cost: 63 } }, { effectiveFrom: "2026-01-01" }),
      TODAY,
    );
    expect(result.ok).toBe(true);
    const rows = await withFirm(T.firmId, (db) =>
      db.select().from(rates).where(eq(rates.firmRoleId, pmRole.id)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      costRateCents: 6300,
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
    });
  });

  it("Designer $120 from 2026-11-01 ends the old rate on 2026-10-31", async () => {
    const v = await view();
    const result = await saveRatesCore(
      ownerT(),
      ratesInput(v, { Designer: { bill: 120 } }, { effectiveFrom: "2026-11-01" }),
      TODAY,
    );
    expect(result.ok).toBe(true);
    const rows = await designerRates();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-10-31",
      billRateCents: 11500,
    });
    expect(rows[1]).toMatchObject({
      effectiveFrom: "2026-11-01",
      effectiveTo: null,
      billRateCents: 12000,
      costRateCents: 4400,
    });
    const logs = await withFirm(T.firmId, (db) =>
      db
        .select()
        .from(activityLog)
        .where(
          and(eq(activityLog.entityType, "rate"), eq(activityLog.entityId, rows[1].id)),
        ),
    );
    expect(logs).toHaveLength(1);

    // The Effective column shows Jan 1 until Nov 1, then Nov 1.
    expect(role(await view("2026-10-31"), "Designer").effectiveFrom).toBe("2026-01-01");
    expect(role(await view("2026-11-01"), "Designer")).toMatchObject({
      effectiveFrom: "2026-11-01",
      billCents: 12000,
    });
    expect(role(await view(), "Designer").history).toHaveLength(2);
  });

  it("saves the overhead rate and the include-overhead switch", async () => {
    const v = await view();
    const result = await saveRatesCore(
      ownerT(),
      ratesInput(v, {}, { overheadPct: 75, includeOverheadDefault: false }),
      TODAY,
    );
    expect(result.ok).toBe(true);
    const [s] = await withFirm(T.firmId, (db) =>
      db.select().from(firmSettings).where(eq(firmSettings.firmId, T.firmId)),
    );
    expect(s.overheadRateBp).toBe(7500);
    expect(s.includeOverheadDefault).toBe(false);
    expect(breakevenHundredths(s.overheadRateBp)).toBe(175);
  });

  it("rejects an overhead rate over 300%", async () => {
    const v = await view();
    const result = await saveRatesCore(ownerT(), ratesInput(v, {}, { overheadPct: 301 }), TODAY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors?.overhead).toBeDefined();
  });

  it("adds Senior designer last with 2.60× and 0 people", async () => {
    const result = await addRoleCore(
      ownerT(),
      {
        name: "Senior designer",
        description: "",
        isBillable: true,
        billDollars: 130,
        costDollars: 50,
        effectiveFrom: "2026-01-01",
      },
      TODAY,
    );
    expect(result.ok).toBe(true);
    const v = await view();
    const last = v.roles.at(-1)!;
    expect(last).toMatchObject({ name: "Senior designer", people: 0 });
    expect(multiplierHundredths(last.billCents, last.costCents)).toBe(260);
  });

  it("won't add a second role with the same name", async () => {
    const result = await addRoleCore(
      ownerT(),
      {
        name: "senior DESIGNER",
        description: "",
        isBillable: true,
        billDollars: 130,
        costDollars: 50,
        effectiveFrom: "2026-01-01",
      },
      TODAY,
    );
    expect(result).toMatchObject({
      ok: false,
      fieldErrors: { name: "A role with this name already exists" },
    });
  });

  it("won't archive Designer while 6 people have it", async () => {
    const result = await archiveRoleCore(ownerT(), T.firmRoleId, TODAY);
    expect(result).toEqual({
      ok: false,
      error: "Move the 6 people in Designer to another role on the Team page first.",
    });
    expect(role(await view(), "Designer")).toBeDefined();
  });

  it("archives a role with no people", async () => {
    const id = role(await view(), "Senior designer").id;
    const result = await archiveRoleCore(ownerT(), id, TODAY);
    expect(result.ok).toBe(true);
    expect((await view()).roles.some((r) => r.id === id)).toBe(false);
  });

  it("turning Billable off sets the bill rate to 0 from today", async () => {
    const intern = role(await view(), "Intern");
    const result = await editRoleCore(
      ownerT(),
      { id: intern.id, name: "Intern", description: "Part-time", isBillable: false, billDollars: null },
      TODAY,
    );
    expect(result.ok).toBe(true);
    const after = role(await view(), "Intern");
    expect(after).toMatchObject({ isBillable: false, billCents: 0, costCents: 2400, effectiveFrom: TODAY });
  });

  it("firm A's save changes no rates in firm B", async () => {
    const before = await withFirm(B.firmId, (db) => db.select().from(rates));
    const v = await view();
    await saveRatesCore(
      ownerT(),
      ratesInput(v, { Principal: { bill: 190 } }, { effectiveFrom: "2026-12-01" }),
      TODAY,
    );
    expect(await withFirm(B.firmId, (db) => db.select().from(rates))).toEqual(before);
  });
});

// ── Phases & fees ───────────────────────────────────────────────────────────

const phases = () => withFirm(A.firmId, loadPhases);
const storedPhases = () =>
  withFirm(A.firmId, (db) =>
    db.select().from(phaseTemplates).orderBy(asc(phaseTemplates.id)),
  );

describe("Phases & fees", () => {
  it("loads the 7 default phases adding up to 100%", async () => {
    const f = await phases();
    expect(f.defaults.map((p) => p.code)).toEqual(["PD", "SD", "DD", "CD", "PRM", "CA", "CO"]);
    expect(f.defaults.reduce((n, p) => n + p.pct, 0)).toBe(100);
    expect(f.optional).toEqual([]);
  });

  it("CD at 30% is blocked: 95% and nothing written", async () => {
    const before = await storedPhases();
    const f = await phases();
    f.defaults[3].pct = 30;
    const result = await savePhasesCore(ownerA(), f);
    expect(result).toMatchObject({
      ok: false,
      error: "Phase shares must add up to 100%. Now 95%.",
    });
    expect(await storedPhases()).toEqual(before);
  });

  it("renames Permitting's abbreviation to PRM2", async () => {
    const f = await phases();
    f.defaults[4].code = "prm2";
    const result = await savePhasesCore(ownerA(), f);
    expect(result.ok).toBe(true);
    const prm = (await storedPhases()).find((p) => p.name === "Permitting")!;
    expect(prm.code).toBe("PRM2");
  });

  it("stores a description, and clearing it stores null", async () => {
    let f = await phases();
    f.defaults[0].description = "  Programming, site analysis and code review ";
    expect((await savePhasesCore(ownerA(), f)).ok).toBe(true);
    let pd = (await storedPhases()).find((p) => p.code === "PD")!;
    expect(pd.description).toBe("Programming, site analysis and code review");

    f = await phases();
    f.defaults[0].description = "";
    expect((await savePhasesCore(ownerA(), f)).ok).toBe(true);
    pd = (await storedPhases()).find((p) => p.code === "PD")!;
    expect(pd.description).toBeNull();
  });

  it("adds optional phase INT Interior Design (hourly) outside the 100%", async () => {
    const f = await phases();
    f.optional.push({
      id: null,
      code: "INT",
      name: "Interior Design",
      description: "",
      pct: 0,
      feeType: "hourly",
    });
    const result = await savePhasesCore(ownerA(), f);
    expect(result.ok).toBe(true);
    const int = (await storedPhases()).find((p) => p.code === "INT")!;
    expect(int).toMatchObject({
      isOptional: true,
      defaultFeeType: "hourly",
      defaultFeeShareBp: 0,
    });
    const after = await phases();
    expect(after.defaults.reduce((n, p) => n + p.pct, 0)).toBe(100);
    expect(after.optional).toHaveLength(1);
  });

  it("an abbreviation already used by an optional phase is rejected", async () => {
    const before = await storedPhases();
    const f = await phases();
    f.defaults.push({ id: null, code: "int", name: "Interiors", description: "", pct: 0, feeType: "fixed" });
    const result = await savePhasesCore(ownerA(), f);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.fieldErrors?.["defaults.7.code"]).toMatch(/already used/);
    expect(await storedPhases()).toEqual(before);
  });

  it("can swap two abbreviations and reorder in one save", async () => {
    const f = await phases();
    f.defaults[1].code = "DD";
    f.defaults[2].code = "SD";
    [f.defaults[0], f.defaults[1]] = [f.defaults[1], f.defaults[0]];
    expect((await savePhasesCore(ownerA(), f)).ok).toBe(true);
    const after = await phases();
    expect(after.defaults.slice(0, 3).map((p) => `${p.code} ${p.name}`)).toEqual([
      "DD Schematic Design",
      "PD Pre-Design",
      "SD Design Development",
    ]);
  });

  it("removing every optional phase saves and archives them", async () => {
    const f = await phases();
    f.optional = [];
    expect((await savePhasesCore(ownerA(), f)).ok).toBe(true);
    expect((await phases()).optional).toEqual([]);
    const int = (await storedPhases()).find((p) => p.code === "INT")!;
    expect(int.archivedAt).not.toBeNull();
  });

  it("a project manager can't save phases", async () => {
    const f: PhasesForm = await phases();
    const result = await savePhasesCore(actorFor(A, A, "project_manager"), f);
    expect(result).toEqual({ ok: false, error: FORBIDDEN_MESSAGE });
  });
});

// ── Timesheet phases & activities ───────────────────────────────────────────

const lists = () => withFirm(A.firmId, loadTimeLists);
const allActivities = () =>
  withFirm(A.firmId, (db) => db.select().from(activities));
const allCategories = () =>
  withFirm(A.firmId, (db) => db.select().from(overheadCategories));
const save = (f: TimeListsForm) => saveTimeListsCore(ownerA(), f);

describe("Timesheet phases & activities", () => {
  it("loads 13 project activities, 4 overhead phases and 3 leave types", async () => {
    const f = await lists();
    expect(f.projectActivities).toHaveLength(13);
    expect(f.overheadPhases.map((p) => p.name)).toEqual([
      "Marketing",
      "Administration",
      "Professional development",
      "Firm standards",
    ]);
    expect(f.leaveTypes.map((l) => l.name)).toEqual(["Vacation", "Sick", "Personal"]);
  });

  it('adds "Punch walk" as project activity 14', async () => {
    const f = await lists();
    f.projectActivities.push({ id: null, name: "Punch walk" });
    expect((await save(f)).ok).toBe(true);
    const row = (await allActivities()).find((a) => a.name === "Punch walk")!;
    expect(row).toMatchObject({ appliesTo: "project", sortOrder: 14, active: true });
  });

  it('removing "Travel" keeps the row, inactive; adding it back reuses it', async () => {
    let f = await lists();
    const travel = f.projectActivities.find((a) => a.name === "Travel")!;
    f.projectActivities = f.projectActivities.filter((a) => a.name !== "Travel");
    expect((await save(f)).ok).toBe(true);
    let row = (await allActivities()).find((a) => a.id === travel.id)!;
    expect(row.active).toBe(false);

    f = await lists();
    f.projectActivities.push({ id: null, name: "Travel" });
    expect((await save(f)).ok).toBe(true);
    const rows = (await allActivities()).filter((a) => a.name === "Travel");
    expect(rows).toHaveLength(1);
    row = rows[0];
    expect(row).toMatchObject({ id: travel.id, active: true });
  });

  it('overhead phase "IT" with no activities is blocked', async () => {
    const f = await lists();
    f.overheadPhases.push({ id: null, name: "IT", activities: [], loggedHours: 0 });
    const result = await save(f);
    expect(result).toMatchObject({
      ok: false,
      fieldErrors: { "overheadPhases.4": "Add at least one activity to IT, or remove it." },
    });
    expect((await allCategories()).some((c) => c.name === "IT")).toBe(false);
  });

  it('renaming "Firm standards" to "Standards" keeps its id', async () => {
    const f = await lists();
    const fs = f.overheadPhases.find((p) => p.name === "Firm standards")!;
    fs.name = "Standards";
    expect((await save(f)).ok).toBe(true);
    const row = (await allCategories()).find((c) => c.id === fs.id)!;
    expect(row.name).toBe("Standards");
  });

  it('adds leave type "Bereavement" under PTO; Holiday is unchanged', async () => {
    const holidayBefore = (await allActivities()).filter((a) => a.name === "Holiday");
    const f = await lists();
    f.leaveTypes.push({ id: null, name: "Bereavement" });
    expect((await save(f)).ok).toBe(true);
    const cats = await allCategories();
    const pto = cats.find((c) => c.code === "PTO")!;
    const row = (await allActivities()).find((a) => a.name === "Bereavement")!;
    expect(row.overheadCategoryId).toBe(pto.id);
    expect((await allActivities()).filter((a) => a.name === "Holiday")).toEqual(holidayBefore);
  });

  it("an empty leave list is blocked", async () => {
    const f = await lists();
    f.leaveTypes = [];
    expect(await save(f)).toMatchObject({ ok: false, fieldErrors: { leaveTypes: "Add at least one leave type." } });
  });

  it("a project manager can't save the lists", async () => {
    const result = await saveTimeListsCore(actorFor(A, A, "project_manager"), await lists());
    expect(result).toEqual({ ok: false, error: FORBIDDEN_MESSAGE });
  });
});
