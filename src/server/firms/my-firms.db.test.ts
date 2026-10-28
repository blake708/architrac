import type { Pool } from "@neondatabase/serverless";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import {
  createOwnerPool,
  createTestFirm,
  removeTestFirm,
  requireDbEnv,
  type TestFirm,
} from "@/db/test-helpers";
import { listMyFirmsCore } from "./my-firms";

// The firm switcher's list, against the real database with Clerk faked.

let owner: Pool;
let alpha: TestFirm;
let beta: TestFirm;
let gamma: TestFirm;

/** Give Alpha's user a membership in another firm. */
async function addMembership(firm: TestFirm, userId: string, active: boolean) {
  const c = await owner.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.firm_id', $1, true)", [firm.firmId]);
    await c.query(
      "insert into memberships (firm_id, user_id, app_role, active) values ($1, $2, 'staff', $3)",
      [firm.firmId, userId, active],
    );
    await c.query("commit");
  } finally {
    c.release();
  }
}

beforeAll(async () => {
  requireDbEnv();
  owner = createOwnerPool();
  // Names start "Test <label> …", so Alpha sorts before Beta.
  beta = await createTestFirm(owner, "Beta");
  alpha = await createTestFirm(owner, "Alpha");
  gamma = await createTestFirm(owner, "Gamma");
  await addMembership(beta, alpha.userId, true);
  await addMembership(gamma, alpha.userId, false);
});

afterAll(async () => {
  if (owner) {
    // Alpha last: its user also has memberships in Beta and Gamma.
    for (const f of [beta, gamma, alpha]) if (f) await removeTestFirm(owner, f);
    await owner.end();
  }
  await closeDb();
});

describe("listMyFirmsCore", () => {
  it("lists firms with an active membership, sorted by name, marking the current one", async () => {
    const list = await listMyFirmsCore(alpha.userId, beta.firmId, {
      listClerkOrgIds: async () => [
        beta.clerkOrgId,
        gamma.clerkOrgId,
        alpha.clerkOrgId,
        "org_test_has_no_firm",
      ],
    });
    expect(list.map((f) => [f.clerkOrgId, f.current])).toEqual([
      [alpha.clerkOrgId, false],
      [beta.clerkOrgId, true],
    ]);
  });

  it("never lists a firm the person isn't a member of, even if Clerk says so", async () => {
    const list = await listMyFirmsCore(beta.userId, beta.firmId, {
      listClerkOrgIds: async () => [alpha.clerkOrgId, beta.clerkOrgId],
    });
    expect(list.map((f) => f.clerkOrgId)).toEqual([beta.clerkOrgId]);
  });
});
