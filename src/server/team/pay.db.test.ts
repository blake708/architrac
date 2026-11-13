import type { Pool } from "@neondatabase/serverless";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { activityLog, membershipPay } from "@/db/schema";
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
import { PAY_MESSAGES, payEarliestMessage } from "@/lib/team/pay";
import type { SettingsActor } from "@/server/settings/common";
import { savePayCore } from "./pay";
import { loadTeam } from "./view";

// Pay in the Team drawer (ADR 0008): owner/admin only, effective-dated, and
// the person's cost on the Team page comes from it.

let pool: Pool;
let F: TestFirm;
let kl: TestMember; // staff designer, 40 h
let jr: TestMember; // PM
const users: string[] = [];
const TODAY = "2026-11-13";

beforeAll(async () => {
  requireDbEnv();
  pool = createOwnerPool();
  F = await createTestFirm(pool, "Pay");
  kl = await addTestMember(pool, F, { firstName: "Kim", lastName: "Lee", role: "staff" });
  jr = await addTestMember(pool, F, { firstName: "Jamie", lastName: "Reyes", role: "project_manager" });
  users.push(kl.userId, jr.userId);
  // Designer: $115 bill / $44 cost (test firm default).
  await asFirm(pool, F.firmId, (c) =>
    c.query("update memberships set firm_role_id = $1, weekly_capacity_hours = 40 where id = $2", [F.firmRoleId, kl.membershipId]),
  );
});

afterAll(async () => {
  if (pool) {
    if (F) await removeTestFirm(pool, F);
    await removeTestUsers(pool, users);
    await pool.end();
  }
  await closeDb();
});

function actorFor(who: { userId: string; membershipId: string }, appRole: AppRole): SettingsActor {
  return {
    firmId: F.firmId,
    firmName: "Test Pay firm",
    clerkOrgId: F.clerkOrgId,
    userId: who.userId,
    clerkUserId: `clerk_${who.userId}`,
    member: { membershipId: who.membershipId, appRole, active: true },
  };
}
const owner = () => actorFor(F, "owner");
const klRow = async (appRole: AppRole, who: { membershipId: string } = F) => {
  const v = await withFirm(F.firmId, (db) =>
    loadTeam(db, { membershipId: who.membershipId, appRole, active: true }, { today: TODAY, weekStartsOn: 1 }),
  );
  return v.people.find((p) => p.id === kl.membershipId)!;
};
const payRows = () =>
  withFirm(F.firmId, (db) =>
    db.select().from(membershipPay).where(eq(membershipPay.membershipId, kl.membershipId)).orderBy(asc(membershipPay.effectiveFrom)),
  );
const salary = (over: Record<string, unknown> = {}) => ({
  membershipId: kl.membershipId,
  payType: "salary",
  amountCents: 7_020_000,
  burdenBp: 2500,
  effectiveFrom: "2026-01-01",
  ...over,
});

describe("pay", () => {
  it("before any pay: the role's cost rate", async () => {
    expect((await klRow("owner")).rate).toEqual({ billCents: 11500, costCents: 4400 });
    expect((await klRow("owner")).pay).toEqual([]);
  });

  it("PMs and staff can't save pay, and never receive it", async () => {
    expect(await savePayCore(actorFor(jr, "project_manager"), salary())).toEqual({ ok: false, error: PAY_MESSAGES.forbidden });
    expect(await savePayCore(actorFor(kl, "staff"), salary())).toEqual({ ok: false, error: PAY_MESSAGES.forbidden });
    expect(await payRows()).toHaveLength(0);
  });

  it("an owner saves a salary; cost becomes salary ÷ (40 × 52) × 1.25", async () => {
    expect(await savePayCore(owner(), salary())).toEqual({ ok: true, data: { membershipId: kl.membershipId } });
    const row = await klRow("owner");
    // $70,200 / 2,080 = $33.75 × 1.25 = $42.19. Bill stays the role's.
    expect(row.rate).toEqual({ billCents: 11500, costCents: 4219 });
    expect(row.pay).toEqual([
      { payType: "salary", amountCents: 7_020_000, burdenBp: 2500, effectiveFrom: "2026-01-01", effectiveTo: null, hourlyCostCents: 4219 },
    ]);
  });

  it("the server strips pay and cost for PMs and staff", async () => {
    for (const [role, who] of [["project_manager", jr], ["staff", kl]] as const) {
      const row = await klRow(role, who);
      expect(row.pay).toBeUndefined();
      expect(row.rate).toBeUndefined();
      expect(JSON.stringify(row)).not.toMatch(/amountCents|burdenBp|hourlyCost|costCents/);
    }
  });

  it("same start date updates in place; a later date starts a new period", async () => {
    expect((await savePayCore(owner(), salary({ burdenBp: 3000 }))).ok).toBe(true);
    expect(await payRows()).toMatchObject([{ effectiveFrom: "2026-01-01", effectiveTo: null, burdenBp: 3000 }]);

    // A switch to hourly from Nov 1.
    expect((await savePayCore(owner(), salary({ payType: "hourly", amountCents: 3000, burdenBp: 1000, effectiveFrom: "2026-11-01" }))).ok).toBe(true);
    expect(await payRows()).toMatchObject([
      { effectiveFrom: "2026-01-01", effectiveTo: "2026-10-31", payType: "salary" },
      { effectiveFrom: "2026-11-01", effectiveTo: null, payType: "hourly", amountCents: 3000 },
    ]);
    expect((await klRow("owner")).rate?.costCents).toBe(3300);
  });

  it("a start date before the current pay is refused", async () => {
    expect(await savePayCore(owner(), salary({ effectiveFrom: "2026-10-01" }))).toEqual({
      ok: false,
      fieldErrors: { effectiveFrom: payEarliestMessage("2026-11-01") },
    });
  });

  it("bad input is refused", async () => {
    const r = await savePayCore(owner(), salary({ burdenBp: 25_000, amountCents: -1 }));
    expect(r.ok).toBe(false);
    expect(!r.ok && Object.keys(r.fieldErrors ?? {}).sort()).toEqual(["amountCents", "burdenBp"]);
    // Someone from another firm (or made up) isn't found.
    expect(await savePayCore(owner(), salary({ membershipId: crypto.randomUUID(), effectiveFrom: "2026-12-01" }))).toEqual({
      ok: false,
      error: PAY_MESSAGES.notFound,
    });
  });

  it("the activity log says pay changed, never how much", async () => {
    const logs = await withFirm(F.firmId, (db) =>
      db.select().from(activityLog).where(and(eq(activityLog.entityType, "membership_pay"))),
    );
    expect(logs.length).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(logs.map((l) => l.changes))).not.toMatch(/7020000|3000\b|amount|burden/);
    expect(logs.every((l) => (l.changes as { membership_id: string }).membership_id === kl.membershipId)).toBe(true);
  });
});
