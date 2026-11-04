import type { Pool } from "@neondatabase/serverless";
import { and, asc, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { activityLog, phaseTemplateRoles, phaseTemplates, projectPhaseRoles, projectPhases } from "@/db/schema";
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
import { EDIT_MESSAGES } from "@/lib/calc/phase-edit";
import { PROJECT_MESSAGES } from "@/lib/projects/form";
import type { SettingsActor } from "@/server/settings/common";
import { createProjectCore } from "./create";
import { loadProjectPage } from "./page";
import { PHASE_MESSAGES, addPhaseCore, updatePhasesCore } from "./phases";
import { saveTemplateMixCore } from "./roles";

// Editing phases and role mixes against the real database
// (project-detail spec rules 5–6; role mixes, Blake 2026-11-03).

const TZ = "America/New_York";
let pool: Pool;
let A: TestFirm;
let pm: TestMember;
let otherPm: TestMember;
const users: string[] = [];
let principalRoleId: string;
let projectId: string;
let optionalId: string;

function actorFor(who: { userId: string; membershipId: string }, appRole: AppRole): SettingsActor {
  return {
    firmId: A.firmId,
    firmName: "Test",
    clerkOrgId: A.clerkOrgId,
    userId: who.userId,
    clerkUserId: `clerk_${who.userId}`,
    member: { membershipId: who.membershipId, appRole, active: true },
  };
}
const owner = () => actorFor(A, "owner");
const asPm = () => actorFor(pm, "project_manager");

async function phases() {
  return withFirm(A.firmId, (db) =>
    db.select().from(projectPhases).where(and(eq(projectPhases.projectId, projectId), isNull(projectPhases.archivedAt))).orderBy(asc(projectPhases.sortOrder)),
  );
}
async function mixOf(phaseId: string) {
  return withFirm(A.firmId, (db) =>
    db
      .select()
      .from(projectPhaseRoles)
      .where(and(eq(projectPhaseRoles.projectPhaseId, phaseId), isNull(projectPhaseRoles.archivedAt)))
      .orderBy(asc(projectPhaseRoles.sortOrder)),
  );
}
/** The page's rows as Edit phases sends them back. */
async function editRows() {
  return (await phases()).map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description ?? "",
    feeType: p.feeType,
    feeCents: p.feeCents,
    budgetHours: Number(p.budgetHours),
    budgetHoursManual: p.budgetHoursManual,
    percentCompleteBp: p.percentCompleteBp,
    status: p.status,
    startDate: p.startDate ?? "",
    endDate: p.endDate ?? "",
    isAdditionalService: p.isAdditionalService,
    archived: false,
  }));
}
const now = () => new Date().toISOString();

beforeAll(async () => {
  requireDbEnv();
  pool = createOwnerPool();
  A = await createTestFirm(pool, "Phases");
  pm = await addTestMember(pool, A, { firstName: "Jo", lastName: "Rivera", role: "project_manager" });
  otherPm = await addTestMember(pool, A, { firstName: "Ola", lastName: "Other", role: "project_manager" });
  users.push(pm.userId, otherPm.userId);
  // Roles: Designer $115 (from the helper) and Principal $185; the owner is a Principal.
  principalRoleId = await asFirm(pool, A.firmId, async (c) => {
    const r = await c.query<{ id: string }>("insert into firm_roles (firm_id, name, sort_order) values ($1, 'Principal', 0) returning id", [A.firmId]);
    await c.query(
      "insert into rates (firm_id, firm_role_id, bill_rate_cents, cost_rate_cents, effective_from) values ($1, $2, 18500, 9500, '2026-01-01')",
      [A.firmId, r.rows[0].id],
    );
    await c.query("update memberships set firm_role_id = $1 where id = $2", [r.rows[0].id, A.membershipId]);
    const opt = await c.query<{ id: string }>(
      "insert into phase_templates (firm_id, code, name, description, is_optional, default_fee_type, sort_order) values ($1, 'AS', 'Additional Services', 'Work beyond the base contract', true, 'hourly', 50) returning id",
      [A.firmId],
    );
    optionalId = opt.rows[0].id;
    return r.rows[0].id;
  });
});

afterAll(async () => {
  if (pool) {
    if (A) await removeTestFirm(pool, A);
    await removeTestUsers(pool, users);
    await pool.end();
  }
  await closeDb();
});

describe("Settings: a template's default role mix", () => {
  it("must add up to 100%; owners and admins only", async () => {
    expect(
      await saveTemplateMixCore(owner(), {
        templateId: A.phaseTemplateId,
        mix: [{ firmRoleId: A.firmRoleId, shareBp: 6000 }],
      }),
    ).toEqual({ ok: false, error: "Role shares must add up to 100%" });
    expect((await saveTemplateMixCore(asPm(), { templateId: A.phaseTemplateId, mix: [] })).ok).toBe(false);
    const r = await saveTemplateMixCore(owner(), {
      templateId: A.phaseTemplateId,
      mix: [
        { firmRoleId: principalRoleId, shareBp: 2000 },
        { firmRoleId: A.firmRoleId, shareBp: 8000 },
      ],
    });
    expect(r.ok).toBe(true);
    const rows = await withFirm(A.firmId, (db) =>
      db.select().from(phaseTemplateRoles).where(and(eq(phaseTemplateRoles.phaseTemplateId, A.phaseTemplateId), isNull(phaseTemplateRoles.archivedAt))),
    );
    // The helper's own 100% Designer row was archived, not deleted.
    expect(rows.map((x) => x.shareBp).sort()).toEqual([2000, 8000]);
  });
});

describe("New project with a role mix", () => {
  it("saves today's bill rates and the hours they give", async () => {
    const [sd] = await withFirm(A.firmId, (db) => db.select().from(phaseTemplates).where(eq(phaseTemplates.id, A.phaseTemplateId)));
    const r = await createProjectCore(
      owner(),
      {
        number: "2026-014",
        name: "Medical Office Building",
        clientCompanyId: A.companyId,
        clientContactId: null,
        projectType: "Office",
        scopeKind: null,
        status: "active",
        principalMembershipId: A.membershipId,
        pmMembershipId: pm.membershipId,
        addressLine1: "",
        addressLine2: "",
        city: "",
        state: "",
        postalCode: "",
        squareFeet: null,
        constructionCostCents: null,
        startDate: "",
        targetEndDate: "",
        totalFeeCents: 2_790_000 + 6_510_000,
        totalBudgetHours: 211.25 + 434,
        phases: [
          {
            templateId: sd.id,
            code: "SD",
            name: "Schematic Design",
            feeType: "fixed",
            feeCents: 2_790_000,
            budgetHours: 211.25,
            mix: [
              { firmRoleId: principalRoleId, shareBp: 2000 },
              { firmRoleId: A.firmRoleId, shareBp: 8000 },
            ],
          },
          { templateId: null, code: "CD", name: "Construction Documents", feeType: "fixed", feeCents: 6_510_000, budgetHours: 434, budgetHoursManual: true },
        ],
      },
      TZ,
    );
    if (!r.ok) throw new Error(JSON.stringify(r));
    projectId = r.data.id;
    const [sdPhase, cd] = await phases();
    const mix = await mixOf(sdPhase.id);
    // $5,580 ÷ $185 = 30.16 → 30.25 h; $22,320 ÷ $115 = 194.09 → 194 h
    expect(mix.map((m) => [m.shareBp, m.rateCents, m.hours])).toEqual([
      [2000, 18_500, "30.25"],
      [8000, 11_500, "194.00"],
    ]);
    expect(cd.budgetHoursManual).toBe(true);
  });

  it("a mix that doesn't add up to 100% is refused", async () => {
    const r = await createProjectCore(owner(), {
      number: "2026-099",
      name: "X",
      clientCompanyId: A.companyId,
      clientContactId: null,
      projectType: "Office",
      scopeKind: null,
      status: "active",
      principalMembershipId: A.membershipId,
      pmMembershipId: pm.membershipId,
      addressLine1: "",
      addressLine2: "",
      city: "",
      state: "",
      postalCode: "",
      squareFeet: null,
      constructionCostCents: null,
      startDate: "",
      targetEndDate: "",
      totalFeeCents: 100,
      totalBudgetHours: 0,
      phases: [{ templateId: null, code: "A", name: "A", feeType: "fixed", feeCents: 100, budgetHours: 0, mix: [{ firmRoleId: A.firmRoleId, shareBp: 5000 }] }],
    });
    expect(r.ok).toBe(false);
  });
});

describe("Edit phases", () => {
  it("a fee change recalculates the mix and the phase hours; logs one row per changed phase", async () => {
    const rows = await editRows();
    rows[0].feeCents = 3_000_000; // SD $27,900 → $30,000
    rows[1].feeCents = 7_000_000; // CD $65,100 → $70,000 (hours typed, so they stay)
    const r = await updatePhasesCore(asPm(), { projectId, loadedAt: now(), rows }, TZ);
    expect(r).toEqual({ ok: true, data: { count: 2 } });
    const [sd, cd] = await phases();
    // $6,000 ÷ $185 = 32.43 → 32.5 h; $24,000 ÷ $115 = 208.70 → 208.75 h
    expect((await mixOf(sd.id)).map((m) => m.hours)).toEqual(["32.50", "208.75"]);
    expect(sd.budgetHours).toBe("241.25");
    expect(cd.budgetHours).toBe("434.00");
    const logs = await withFirm(A.firmId, (db) =>
      db.select().from(activityLog).where(and(eq(activityLog.entityId, cd.id), eq(activityLog.action, "updated"))),
    );
    expect(logs[0].changes).toMatchObject({ feeCents: { before: 6_510_000, after: 7_000_000 } });
  });

  it("someone else saved first → refused, nothing changes", async () => {
    const stale = new Date(Date.now() - 60_000).toISOString();
    const rows = await editRows();
    rows[0].name = "Should not save";
    expect(await updatePhasesCore(asPm(), { projectId, loadedAt: stale, rows }, TZ)).toEqual({ ok: false, error: PHASE_MESSAGES.stale });
    expect((await phases())[0].name).toBe("Schematic Design");
  });

  it("row errors: duplicate code, quarter hours, NTE cap; nothing saved", async () => {
    const rows = await editRows();
    rows[1].code = "sd";
    rows[0].budgetHours = 310.3;
    const r = await updatePhasesCore(asPm(), { projectId, loadedAt: now(), rows }, TZ);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("2 phases need attention");
      expect(r.rowErrors?.[1]?.code).toBe(EDIT_MESSAGES.codeTaken);
      expect(r.rowErrors?.[0]?.budgetHours).toBe(EDIT_MESSAGES.hours);
    }
  });

  it("a new mix replaces the old; reorder; % complete only for fixed", async () => {
    const rows = await editRows();
    const [sd, cd] = rows;
    const r = await updatePhasesCore(
      owner(),
      {
        projectId,
        loadedAt: now(),
        rows: [
          { ...cd, feeType: "hourly", feeCents: 0, percentCompleteBp: 5000 },
          { ...sd, mix: [{ firmRoleId: A.firmRoleId, shareBp: 10_000 }] },
        ],
      },
      TZ,
    );
    expect(r.ok).toBe(true);
    const [first, second] = await phases();
    expect([first.code, second.code]).toEqual(["CD", "SD"]);
    expect(first.percentCompleteBp).toBe(0); // hourly: kept as it was
    expect((await mixOf(second.id)).map((m) => [m.shareBp, m.hours])).toEqual([[10_000, "260.75"]]); // $30,000 ÷ $115
    expect(second.budgetHours).toBe("260.75");
  });

  it("archive a phase; a PM on someone else's project can't edit", async () => {
    const rows = await editRows();
    rows[0].archived = true;
    expect(await updatePhasesCore(actorFor(otherPm, "project_manager"), { projectId, loadedAt: now(), rows }, TZ)).toEqual({
      ok: false,
      error: PROJECT_MESSAGES.editForbidden,
    });
    expect((await updatePhasesCore(owner(), { projectId, loadedAt: now(), rows }, TZ)).ok).toBe(true);
    expect((await phases()).map((p) => p.code)).toEqual(["SD"]);
  });
});

describe("Add phase", () => {
  it("from an optional template: its description, additional service, hours from the blended rate", async () => {
    const r = await addPhaseCore(
      asPm(),
      {
        projectId,
        templateId: optionalId,
        code: "AS1",
        name: "Additional Services",
        description: "",
        feeType: "fixed",
        feeCents: 500_000,
        budgetHours: null,
        isAdditionalService: true,
      },
      TZ,
    );
    expect(r.ok).toBe(true);
    const added = (await phases()).at(-1)!;
    expect(added).toMatchObject({ code: "AS1", status: "upcoming", description: "Work beyond the base contract", isAdditionalService: true });
    // Blended bill rate = $185 (only the owner has a role) → $5,000 ÷ $185 = 27.03 → 27 h
    expect(added.budgetHours).toBe("27.00");
    const page = await withFirm(A.firmId, (db) =>
      loadProjectPage(db, { appRole: "owner", active: true, membershipId: A.membershipId }, projectId, { id: A.firmId, timezone: TZ }),
    );
    expect(page!.money!.feeCents).toBe(3_000_000 + 500_000);
    expect(page!.phaseEdit?.optionalTemplates.map((t) => t.code)).toContain("AS");
    // Bill rates only: no cost anywhere in what the page gets.
    expect(JSON.stringify(page!.phaseEdit)).not.toMatch(/cost/i);
  });

  it("a code already on the project is refused", async () => {
    const r = await addPhaseCore(
      owner(),
      { projectId, templateId: null, code: "as1", name: "X", description: "", feeType: "fixed", feeCents: 0, budgetHours: 0, isAdditionalService: false },
      TZ,
    );
    expect(r).toEqual({ ok: false, rowErrors: { 0: { code: EDIT_MESSAGES.codeTaken } } });
  });
});
