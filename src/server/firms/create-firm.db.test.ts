import { randomUUID } from "node:crypto";
import type { Pool } from "@neondatabase/serverless";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb } from "@/db/client";
import {
  createOwnerPool,
  createTestFirm,
  removeFirmById,
  removeTestFirm,
  removeUserByClerkId,
  requireDbEnv,
  type TestFirm,
} from "@/db/test-helpers";
import { CREATE_FAILED_MESSAGE, createFirmCore } from "./create-firm";

// createFirm against the real database, with Clerk replaced by fakes.
// App-shell spec acceptance tests 3 and 5.

let owner: Pool;
let existing: TestFirm;
const madeFirmIds: string[] = [];
const madeClerkUserIds: string[] = [];

beforeAll(async () => {
  requireDbEnv();
  owner = createOwnerPool();
  existing = await createTestFirm(owner, "Existing");
});

afterAll(async () => {
  if (owner) {
    for (const id of madeFirmIds) await removeFirmById(owner, id);
    for (const id of madeClerkUserIds) await removeUserByClerkId(owner, id);
    if (existing) await removeTestFirm(owner, existing);
    await owner.end();
  }
  await closeDb();
});

function fakeClerk(orgId: string) {
  const clerkUserId = `user_test_${randomUUID().slice(0, 8)}`;
  madeClerkUserIds.push(clerkUserId);
  return {
    clerkUserId,
    deps: {
      loadUser: async () => ({
        clerkUserId,
        email: `${clerkUserId}@example.com`,
        firstName: "Blake",
        lastName: "Middleton",
        avatarUrl: null,
      }),
      createOrg: vi.fn(async () => orgId),
      deleteOrg: vi.fn(async () => {}),
    },
  };
}

/** Read rows as the owner, with the firm selected so RLS lets us see them. */
async function readAsFirm<T extends object>(
  firmId: string,
  query: string,
  params: unknown[],
): Promise<T[]> {
  const c = await owner.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.firm_id', $1, true)", [firmId]);
    const r = await c.query<T>(query, params);
    await c.query("commit");
    return r.rows;
  } finally {
    c.release();
  }
}

describe("createFirm (database)", () => {
  it("creates the firm, its settings, the owner membership and a log entry", async () => {
    const orgId = `org_test_${randomUUID().slice(0, 8)}`;
    const { clerkUserId, deps } = fakeClerk(orgId);
    const name = `The Middleton Group ${randomUUID().slice(0, 6)}`;

    const result = await createFirmCore(
      { name, timezone: "America/New_York", fiscalYearStartMonth: "1" },
      deps,
      new Date("2026-10-27T12:00:00Z"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { firmId } = result.data;
    madeFirmIds.push(firmId);
    expect(result.data.clerkOrgId).toBe(orgId);

    const [firm] = await readAsFirm<{
      name: string;
      clerk_org_id: string;
      timezone: string;
      fiscal_year_start_month: number;
    }>(firmId, "select * from firms where id = $1", [firmId]);
    expect(firm).toMatchObject({
      name,
      clerk_org_id: orgId,
      timezone: "America/New_York",
      fiscal_year_start_month: 1,
    });

    const [settings] = await readAsFirm<{
      overhead_rate_bp: number;
      modules_enabled: string[];
      invoice_prefix: string;
      default_payment_terms_days: number;
    }>(firmId, "select * from firm_settings where firm_id = $1", [firmId]);
    expect(settings).toMatchObject({
      overhead_rate_bp: 6000,
      modules_enabled: [],
      invoice_prefix: "2026-",
      default_payment_terms_days: 30,
    });

    const members = await readAsFirm<{
      app_role: string;
      title: string;
      active: boolean;
      target_utilization_bp: number;
      clerk_user_id: string;
      initials: string;
    }>(
      firmId,
      `select m.*, u.clerk_user_id, u.initials from memberships m
       join users u on u.id = m.user_id where m.firm_id = $1`,
      [firmId],
    );
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({
      app_role: "owner",
      title: "Principal",
      active: true,
      target_utilization_bp: 8000,
      clerk_user_id: clerkUserId,
      initials: "BM",
    });

    const log = await readAsFirm<{ entity_type: string; action: string }>(
      firmId,
      "select entity_type, action from activity_log where firm_id = $1",
      [firmId],
    );
    expect(log).toEqual([{ entity_type: "firm", action: "created" }]);
    expect(deps.deleteOrg).not.toHaveBeenCalled();
  });

  it("gives a second firm with the same name a different slug", async () => {
    const name = `Same Name ${randomUUID().slice(0, 6)}`;
    const slugs: string[] = [];
    for (let i = 0; i < 2; i++) {
      const { deps } = fakeClerk(`org_test_${randomUUID().slice(0, 8)}`);
      const result = await createFirmCore(
        { name, timezone: "America/Chicago", fiscalYearStartMonth: "7" },
        deps,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      madeFirmIds.push(result.data.firmId);
      const [row] = await readAsFirm<{ slug: string }>(
        result.data.firmId,
        "select slug from firms where id = $1",
        [result.data.firmId],
      );
      slugs.push(row.slug);
    }
    expect(slugs[0]).not.toBe(slugs[1]);
    expect(slugs[1].startsWith(slugs[0] + "-")).toBe(true);
  });

  it("deletes the Clerk org and saves nothing when the database step fails", async () => {
    // Reusing an existing firm's Clerk org id makes the insert fail
    // (clerk_org_id must be unique), standing in for any database error.
    const { deps } = fakeClerk(existing.clerkOrgId);
    const name = `Should Not Exist ${randomUUID().slice(0, 6)}`;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await createFirmCore(
      { name, timezone: "America/New_York", fiscalYearStartMonth: "1" },
      deps,
    );
    errSpy.mockRestore();

    expect(result).toEqual({ ok: false, error: CREATE_FAILED_MESSAGE });
    expect(deps.deleteOrg).toHaveBeenCalledWith(existing.clerkOrgId);

    // The owner role sees every firm (firms isn't FORCEd), so this checks all of them.
    const rows = await owner.query("select id from firms where name = $1", [
      name,
    ]);
    expect(rows.rows).toHaveLength(0);
  });
});
