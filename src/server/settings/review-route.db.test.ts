import type { Pool } from "@neondatabase/serverless";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { ROUTE_EDIT_MESSAGES } from "@/lib/settings/review-route";
import { FORBIDDEN_MESSAGE, type SettingsActor } from "./common";
import { saveReviewRouteCore } from "./review-route";

// Settings → Time & approvals → "Approval route" against the real database
// (timesheet-approval spec, 1.7 A acceptance tests).

let pool: Pool;
let A: TestFirm;
let B: TestFirm;
let staff: TestMember;
let gone: TestMember;
const users: string[] = [];

const actorFor = (firm: TestFirm, who: { userId: string; membershipId: string }, appRole: AppRole): SettingsActor => ({
  firmId: firm.firmId,
  firmName: "Test Firm",
  clerkOrgId: firm.clerkOrgId,
  userId: who.userId,
  clerkUserId: `clerk_${who.userId}`,
  member: { membershipId: who.membershipId, appRole, active: true },
});

// The owner pool skips row security, so every query names the firm.
const liveSteps = (firm: TestFirm) =>
  asFirm(pool, firm.firmId, async (c) =>
    (
      await c.query<{ kind: string; membership_id: string | null }>(
        "select kind, membership_id from review_steps where firm_id = $1 and archived_at is null order by sort_order",
        [firm.firmId],
      )
    ).rows,
  );

beforeAll(async () => {
  requireDbEnv();
  pool = createOwnerPool();
  A = await createTestFirm(pool, "Route");
  B = await createTestFirm(pool, "Route B");
  staff = await addTestMember(pool, A, { firstName: "Sam", lastName: "Staff", role: "staff" });
  gone = await addTestMember(pool, A, { firstName: "Gil", lastName: "Gone", role: "staff", active: false });
  users.push(staff.userId, gone.userId);
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

describe("approval route settings", () => {
  const owner = () => actorFor(A, A, "owner");

  it("staff can't change the route", async () => {
    expect(await saveReviewRouteCore(actorFor(A, staff, "staff"), { steps: [{ kind: "team_leader", membershipId: null }] })).toEqual({
      ok: false,
      error: FORBIDDEN_MESSAGE,
    });
    expect(await liveSteps(A)).toEqual([{ kind: "principal_in_charge", membership_id: null }]);
  });

  it("refuses an empty route, a repeated kind and a repeated person", async () => {
    expect(await saveReviewRouteCore(owner(), { steps: [] })).toEqual({ ok: false, error: ROUTE_EDIT_MESSAGES.needsStep });
    expect(
      await saveReviewRouteCore(owner(), {
        steps: [
          { kind: "team_leader", membershipId: null },
          { kind: "team_leader", membershipId: null },
        ],
      }),
    ).toEqual({ ok: false, error: ROUTE_EDIT_MESSAGES.duplicateKind });
    expect(
      await saveReviewRouteCore(owner(), {
        steps: [
          { kind: "person", membershipId: staff.membershipId },
          { kind: "person", membershipId: staff.membershipId },
        ],
      }),
    ).toEqual({ ok: false, error: ROUTE_EDIT_MESSAGES.duplicatePerson });
  });

  it("refuses an inactive person and another firm's person", async () => {
    expect(await saveReviewRouteCore(owner(), { steps: [{ kind: "person", membershipId: gone.membershipId }] })).toEqual({
      ok: false,
      error: ROUTE_EDIT_MESSAGES.badPerson,
    });
    expect(await saveReviewRouteCore(owner(), { steps: [{ kind: "person", membershipId: B.membershipId }] })).toEqual({
      ok: false,
      error: ROUTE_EDIT_MESSAGES.badPerson,
    });
  });

  it("saves a new route, keeps the old steps archived, and logs the change", async () => {
    const r = await saveReviewRouteCore(owner(), {
      steps: [
        { kind: "team_leader", membershipId: null },
        { kind: "person", membershipId: staff.membershipId },
        { kind: "principal_in_charge", membershipId: null },
      ],
    });
    expect(r.ok).toBe(true);
    expect(await liveSteps(A)).toEqual([
      { kind: "team_leader", membership_id: null },
      { kind: "person", membership_id: staff.membershipId },
      { kind: "principal_in_charge", membership_id: null },
    ]);
    const counts = await asFirm(pool, A.firmId, async (c) =>
      (
        await c.query<{ archived: string }>(
          "select count(*) filter (where archived_at is not null) as archived from review_steps where firm_id = $1",
          [A.firmId],
        )
      ).rows[0],
    );
    expect(Number(counts.archived)).toBe(1);
    const log = await asFirm(pool, A.firmId, async (c) =>
      (
        await c.query<{ changes: { review_route: { before: string; after: string } } }>(
          "select changes from activity_log where firm_id = $1 and entity_type = 'firm_settings' and changes ? 'review_route'",
          [A.firmId],
        )
      ).rows,
    );
    expect(log).toHaveLength(1);
    expect(log[0].changes.review_route).toEqual({
      before: "Principal in Charge",
      after: "Team leader → Sam Staff → Principal in Charge",
    });
    // Firm B's route is untouched.
    expect(await liveSteps(B)).toEqual([{ kind: "principal_in_charge", membership_id: null }]);
  });

  it("saving the same route again changes nothing", async () => {
    const steps = (await liveSteps(A)).map((s) => ({ kind: s.kind, membershipId: s.membership_id }));
    expect((await saveReviewRouteCore(owner(), { steps })).ok).toBe(true);
    const total = await asFirm(pool, A.firmId, async (c) =>
      (await c.query<{ n: string }>("select count(*) as n from review_steps where firm_id = $1", [A.firmId])).rows[0].n,
    );
    expect(Number(total)).toBe(4);
  });
});
