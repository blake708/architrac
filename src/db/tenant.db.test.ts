import { randomUUID } from "node:crypto";
import type { Pool } from "@neondatabase/serverless";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "./client";
import {
  activityLog,
  firmSettings,
  firms,
  invitations,
  memberships,
  teams,
} from "./schema";
import { type TenantDb, withFirm } from "./tenant";
import {
  createOwnerPool,
  createTestFirm,
  removeTestFirm,
  requireDbEnv,
  type TestFirm,
} from "./test-helpers";

// Proves the two firms can't see or change each other's data, for every
// firm-owned table. Runs against the real Neon database in .env.local.

let owner: Pool;
let A: TestFirm;
let B: TestFirm;

beforeAll(async () => {
  requireDbEnv();
  owner = createOwnerPool();
  A = await createTestFirm(owner, "A");
  B = await createTestFirm(owner, "B");
});

afterAll(async () => {
  if (owner) {
    if (A) await removeTestFirm(owner, A);
    if (B) await removeTestFirm(owner, B);
    await owner.end();
  }
  await closeDb();
});

/** Drizzle wraps database errors; the Postgres message is on `cause`. */
async function expectDbError(promise: Promise<unknown>, pattern: RegExp) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, "expected the database to refuse this").not.toBeNull();
  const e = err as { message?: string; cause?: { message?: string } };
  expect(`${e.message} ${e.cause?.message ?? ""}`).toMatch(pattern);
}

type TableCase = {
  table: string;
  /** Row ids (as firm ids) visible to the current firm. */
  visibleFirmIds: (db: TenantDb) => Promise<string[]>;
  /** Try to change Firm B's row; returns the rows actually changed. */
  updateB: (db: TenantDb) => Promise<unknown[]>;
  /** Read the field updateB tried to change, as Firm B. */
  readB: (db: TenantDb) => Promise<unknown>;
  /** Try to create a row that belongs to Firm B. */
  insertForB: (db: TenantDb) => Promise<unknown>;
};

const cases: TableCase[] = [
  {
    table: "firms",
    visibleFirmIds: (db) =>
      db
        .select({ f: firms.id })
        .from(firms)
        .then((r) => r.map((x) => x.f)),
    updateB: (db) =>
      db
        .update(firms)
        .set({ name: "hacked" })
        .where(eq(firms.id, B.firmId))
        .returning(),
    readB: (db) =>
      db
        .select({ v: firms.name })
        .from(firms)
        .where(eq(firms.id, B.firmId))
        .then((r) => r[0]?.v),
    // A firm row other than your own counts as "another firm".
    insertForB: (db) =>
      db.insert(firms).values({
        name: "x",
        slug: `x-${randomUUID()}`,
        clerkOrgId: randomUUID(),
      }),
  },
  {
    table: "firm_settings",
    visibleFirmIds: (db) =>
      db
        .select({ f: firmSettings.firmId })
        .from(firmSettings)
        .then((r) => r.map((x) => x.f)),
    updateB: (db) =>
      db
        .update(firmSettings)
        .set({ invoicePrefix: "hacked" })
        .where(eq(firmSettings.firmId, B.firmId))
        .returning(),
    readB: (db) =>
      db
        .select({ v: firmSettings.invoicePrefix })
        .from(firmSettings)
        .where(eq(firmSettings.firmId, B.firmId))
        .then((r) => r[0]?.v),
    insertForB: (db) => db.insert(firmSettings).values({ firmId: B.firmId }),
  },
  {
    table: "memberships",
    visibleFirmIds: (db) =>
      db
        .select({ f: memberships.firmId })
        .from(memberships)
        .then((r) => r.map((x) => x.f)),
    updateB: (db) =>
      db
        .update(memberships)
        .set({ title: "hacked" })
        .where(eq(memberships.id, B.membershipId))
        .returning(),
    readB: (db) =>
      db
        .select({ v: memberships.title })
        .from(memberships)
        .where(eq(memberships.id, B.membershipId))
        .then((r) => r[0]?.v),
    insertForB: (db) =>
      db.insert(memberships).values({ firmId: B.firmId, userId: A.userId }),
  },
  {
    table: "teams",
    visibleFirmIds: (db) =>
      db
        .select({ f: teams.firmId })
        .from(teams)
        .then((r) => r.map((x) => x.f)),
    updateB: (db) =>
      db
        .update(teams)
        .set({ name: "hacked" })
        .where(eq(teams.id, B.teamId))
        .returning(),
    readB: (db) =>
      db
        .select({ v: teams.name })
        .from(teams)
        .where(eq(teams.id, B.teamId))
        .then((r) => r[0]?.v),
    insertForB: (db) =>
      db.insert(teams).values({ firmId: B.firmId, name: "sneaky" }),
  },
  {
    table: "activity_log",
    visibleFirmIds: (db) =>
      db
        .select({ f: activityLog.firmId })
        .from(activityLog)
        .then((r) => r.map((x) => x.f)),
    updateB: (db) =>
      db
        .update(activityLog)
        .set({ action: "hacked" })
        .where(eq(activityLog.id, B.activityLogId))
        .returning(),
    readB: (db) =>
      db
        .select({ v: activityLog.action })
        .from(activityLog)
        .where(eq(activityLog.id, B.activityLogId))
        .then((r) => r[0]?.v),
    insertForB: (db) =>
      db.insert(activityLog).values({
        firmId: B.firmId,
        entityType: "team",
        entityId: B.teamId,
        action: "created",
      }),
  },
  {
    table: "invitations",
    visibleFirmIds: (db) =>
      db
        .select({ f: invitations.firmId })
        .from(invitations)
        .then((r) => r.map((x) => x.f)),
    updateB: (db) =>
      db
        .update(invitations)
        .set({ title: "hacked" })
        .where(eq(invitations.id, B.invitationId))
        .returning(),
    readB: (db) =>
      db
        .select({ v: invitations.title })
        .from(invitations)
        .where(eq(invitations.id, B.invitationId))
        .then((r) => r[0]?.v),
    insertForB: (db) =>
      db.insert(invitations).values({
        firmId: B.firmId,
        email: `sneaky-${randomUUID()}@example.com`,
        appRole: "owner",
      }),
  },
];

describe("database role", () => {
  it("the app connects as a role that cannot bypass row-level security", async () => {
    const result = await getDb().execute<{
      rolbypassrls: boolean;
      rolsuper: boolean;
    }>(
      sql`select rolbypassrls, rolsuper from pg_roles where rolname = current_user`,
    );
    expect(result.rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
  });

  it("withFirm rejects a firm id that isn't a uuid", async () => {
    await expect(withFirm("not-a-uuid", async () => 1)).rejects.toThrow();
  });
});

describe.each(cases)("$table: firm isolation", (c) => {
  it("Firm A sees its own row and not Firm B's", async () => {
    const ids = await withFirm(A.firmId, c.visibleFirmIds);
    expect(ids).toContain(A.firmId);
    expect(ids).not.toContain(B.firmId);
    expect(new Set(ids)).toEqual(new Set([A.firmId]));
  });

  it("Firm A cannot update Firm B's row", async () => {
    const before = await withFirm(B.firmId, c.readB);
    const changed = await withFirm(A.firmId, c.updateB);
    expect(changed).toHaveLength(0);
    expect(await withFirm(B.firmId, c.readB)).toEqual(before);
    expect(before).not.toBe("hacked");
  });

  it("Firm A cannot create a row for another firm", async () => {
    await expectDbError(withFirm(A.firmId, c.insertForB), /row-level security/);
  });

  it("returns nothing when no firm is selected", async () => {
    const ids = await getDb().transaction((tx) => c.visibleFirmIds(tx));
    expect(ids).toEqual([]);
  });
});

describe("other guards", () => {
  it("a membership can't point at another firm's team", async () => {
    await expectDbError(
      withFirm(A.firmId, (db) =>
        db
          .update(memberships)
          .set({ teamId: B.teamId })
          .where(eq(memberships.id, A.membershipId)),
      ),
      /foreign key/,
    );
  });

  it("the app can't hard-delete rows", async () => {
    await expectDbError(
      withFirm(A.firmId, (db) =>
        db.delete(teams).where(eq(teams.id, A.teamId)),
      ),
      /permission denied/,
    );
  });

  it("Firm A can update its own rows (the rules don't block normal work)", async () => {
    const changed = await withFirm(A.firmId, (db) =>
      db
        .update(teams)
        .set({ sortOrder: 5 })
        .where(eq(teams.id, A.teamId))
        .returning(),
    );
    expect(changed).toHaveLength(1);
  });

  it("firm_id_for_clerk_org finds a firm from its Clerk organization", async () => {
    const result = await getDb().execute<{ id: string | null }>(
      sql`select firm_id_for_clerk_org(${A.clerkOrgId}) as id`,
    );
    expect(result.rows[0].id).toBe(A.firmId);
  });
});
