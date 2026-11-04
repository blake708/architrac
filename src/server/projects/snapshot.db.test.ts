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
import { type AppRole, ForbiddenError } from "@/lib/auth/permissions";
import { loadProjectSnapshot } from "./snapshot";

// The Project snapshot loader against the real database: owner/admin only,
// planned cost per hour from the phase's roles, else the firm average.
// (Time and invoices arrive in 1.6 and 1.8; the math is in snapshot.test.ts.)

let pool: Pool;
let A: TestFirm;
let B: TestFirm;
let pm: TestMember;
let staff: TestMember;
const users: string[] = [];
let cdId: string;

const load = (who: { membershipId: string }, appRole: AppRole, firm = A, id = A.projectId) =>
  withFirm(firm.firmId, (db) =>
    loadProjectSnapshot(db, { appRole, active: true, membershipId: who.membershipId }, id, { id: firm.firmId, timezone: "America/New_York" }),
  );

beforeAll(async () => {
  requireDbEnv();
  pool = createOwnerPool();
  A = await createTestFirm(pool, "Snapshot");
  B = await createTestFirm(pool, "Snapshot B");
  pm = await addTestMember(pool, A, { firstName: "Jo", lastName: "Rivera", role: "project_manager" });
  staff = await addTestMember(pool, A, { firstName: "Kat", lastName: "Lee", role: "staff" });
  users.push(pm.userId, staff.userId);
  // The helper's SD phase ($10,000) has one role: Designer, 87 h, cost $44.
  // Add CD ($5,000, 50 h) with no roles, and a Principal ($95 cost) held by the owner.
  cdId = await asFirm(pool, A.firmId, async (c) => {
    await c.query("update project_phases set budget_hours = 87 where id = $1", [A.projectPhaseId]);
    const r = await c.query<{ id: string }>("insert into firm_roles (firm_id, name, sort_order) values ($1, 'Principal', 0) returning id", [A.firmId]);
    await c.query(
      "insert into rates (firm_id, firm_role_id, bill_rate_cents, cost_rate_cents, effective_from) values ($1, $2, 18500, 9500, '2026-01-01')",
      [A.firmId, r.rows[0].id],
    );
    await c.query("update memberships set firm_role_id = $1 where id = $2", [r.rows[0].id, A.membershipId]);
    await c.query("update memberships set firm_role_id = $1 where id in ($2, $3)", [A.firmRoleId, pm.membershipId, staff.membershipId]);
    const cd = await c.query<{ id: string }>(
      "insert into project_phases (firm_id, project_id, code, name, sort_order, fee_type, fee_cents, budget_hours, status) values ($1, $2, 'CD', 'Construction Documents', 2, 'fixed', 500000, 50, 'upcoming') returning id",
      [A.firmId, A.projectId],
    );
    return cd.rows[0].id;
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

describe("who may load it", () => {
  it("refuses a PM and staff", async () => {
    await expect(load(pm, "project_manager")).rejects.toThrow(ForbiddenError);
    await expect(load(staff, "staff")).rejects.toThrow(ForbiddenError);
  });

  it("another firm's project is not found", async () => {
    expect(await load(B, "owner", B, A.projectId)).toBeNull();
  });

  it("sends results, never the rates behind them", async () => {
    const s = await load(A, "admin");
    expect(JSON.stringify(s)).not.toMatch(/plannedRate|[Rr]ateCents|billCents|"costRate/);
  });
});

describe("planned cost per hour", () => {
  it("SD uses its roles; CD (no roles) uses the firm average, marked estimated", async () => {
    const s = (await load(A, "owner"))!;
    expect(s.overheadBp).toBe(6000);
    expect(s.phases.map((p) => p.code)).toEqual(["SD", "CD"]);
    const [sd, cd] = s.off.phases;
    // SD: $10,000 − 87 h × $44 = $6,172 (62%).
    expect([sd.projectedCents, sd.projectedNote]).toEqual([617_200, "62% margin"]);
    expect(sd.detailNote).toBe("87 budget hours left. At the planned rate that's about $3,828 more labor before this phase is billed in full.");
    // Firm average: 1 Principal at $95 + 2 Designers at $44 = $61 an hour.
    // CD: $5,000 − 50 h × $61 = $1,950 (39%).
    expect([cd.projectedCents, cd.projectedNote]).toEqual([195_000, "39% margin"]);
    expect(cd.detailNote).toBe("No time logged yet. Budget: 50 h at a planned $61 / h (estimated).");
    // With 60% overhead: SD 1,000,000 − 87 × 7,040 = 387,520.
    expect(s.on.phases[0].projectedCents).toBe(387_520);
    expect(s.on.total.projectedCents).toBe(387_520 + (500_000 - 50 * 9760));
    expect(cdId).toBeTruthy();
  });
});
