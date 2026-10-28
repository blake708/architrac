import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "@neondatabase/serverless";

// Helpers for database tests only. They connect as the OWNER role so they can
// set up and remove test data. The code under test always uses the app role.

export function requireDbEnv() {
  const missing = ["DATABASE_URL", "DATABASE_URL_OWNER"].filter(
    (k) => !process.env[k],
  );
  if (missing.length > 0) {
    throw new Error(
      `Database tests need ${missing.join(" and ")} in .env.local. See docs/GETTING_STARTED.md (milestone 0.2).`,
    );
  }
}

export function createOwnerPool() {
  return new Pool({ connectionString: process.env.DATABASE_URL_OWNER });
}

/** Run SQL as the owner with one firm selected (works whether or not the owner bypasses RLS). */
export async function asFirm<T>(
  pool: Pool,
  firmId: string,
  fn: (c: PoolClient) => Promise<T>,
) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.firm_id', $1, true)", [firmId]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export type TestFirm = {
  label: string;
  firmId: string;
  clerkOrgId: string;
  userId: string;
  membershipId: string;
  teamId: string;
  activityLogId: string;
  invitationId: string;
};

/** Create a firm with one user, membership, team, firm_settings row and activity_log row. */
export async function createTestFirm(
  pool: Pool,
  label: string,
): Promise<TestFirm> {
  const suffix = randomUUID().slice(0, 8);
  const clerkOrgId = `org_test_${suffix}`;

  const firm = await pool.query<{ id: string }>(
    "insert into firms (name, slug, clerk_org_id) values ($1, $2, $3) returning id",
    [
      `Test ${label} ${suffix}`,
      `test-${label.toLowerCase()}-${suffix}`,
      clerkOrgId,
    ],
  );
  const firmId = firm.rows[0].id;

  const user = await pool.query<{ id: string }>(
    "insert into users (clerk_user_id, email, first_name, last_name) values ($1, $2, $3, 'Test') returning id",
    [`user_test_${suffix}`, `test-${suffix}@example.com`, label],
  );
  const userId = user.rows[0].id;

  return asFirm(pool, firmId, async (c) => {
    await c.query(
      "insert into firm_settings (firm_id, invoice_prefix) values ($1, $2)",
      [firmId, `${label}-`],
    );
    const team = await c.query<{ id: string }>(
      "insert into teams (firm_id, name) values ($1, $2) returning id",
      [firmId, `${label} team`],
    );
    const teamId = team.rows[0].id;
    const membership = await c.query<{ id: string }>(
      "insert into memberships (firm_id, user_id, app_role, title, team_id) values ($1, $2, 'owner', $3, $4) returning id",
      [firmId, userId, `${label} principal`, teamId],
    );
    const membershipId = membership.rows[0].id;
    await c.query("update teams set leader_membership_id = $1 where id = $2", [
      membershipId,
      teamId,
    ]);
    const log = await c.query<{ id: string }>(
      "insert into activity_log (firm_id, actor_user_id, entity_type, entity_id, action) values ($1, $2, 'team', $3, 'created') returning id",
      [firmId, userId, teamId],
    );
    const invite = await c.query<{ id: string }>(
      "insert into invitations (firm_id, email, app_role, title, invited_by) values ($1, $2, 'staff', 'Designer', $3) returning id",
      [firmId, `invitee-${suffix}@example.com`, userId],
    );
    return {
      invitationId: invite.rows[0].id,
      label,
      firmId,
      clerkOrgId,
      userId,
      membershipId,
      teamId,
      activityLogId: log.rows[0].id,
    };
  });
}

/** Remove a test firm and everything in it. Only tests hard-delete; the app role can't. */
export async function removeTestFirm(pool: Pool, firm: TestFirm) {
  await asFirm(pool, firm.firmId, async (c) => {
    await c.query(
      "update teams set leader_membership_id = null where firm_id = $1",
      [firm.firmId],
    );
    await c.query("delete from activity_log where firm_id = $1", [firm.firmId]);
    await c.query("delete from invitations where firm_id = $1", [firm.firmId]);
    await c.query("delete from memberships where firm_id = $1", [firm.firmId]);
    await c.query("delete from teams where firm_id = $1", [firm.firmId]);
    await c.query("delete from firm_settings where firm_id = $1", [
      firm.firmId,
    ]);
  });
  await pool.query("delete from firms where id = $1", [firm.firmId]);
  await pool.query("delete from users where id = $1", [firm.userId]);
}

/** Remove a firm made by the code under test (e.g. createFirm), and its rows. */
export async function removeFirmById(pool: Pool, firmId: string) {
  await asFirm(pool, firmId, async (c) => {
    await c.query("delete from activity_log where firm_id = $1", [firmId]);
    await c.query("delete from invitations where firm_id = $1", [firmId]);
    await c.query("delete from memberships where firm_id = $1", [firmId]);
    await c.query("delete from firm_settings where firm_id = $1", [firmId]);
  });
  await pool.query("delete from firms where id = $1", [firmId]);
}

/** Remove a user row by Clerk id. Remove their memberships first. */
export async function removeUserByClerkId(pool: Pool, clerkUserId: string) {
  await pool.query("delete from users where clerk_user_id = $1", [clerkUserId]);
}

export type TestMember = {
  userId: string;
  clerkUserId: string;
  email: string;
  membershipId: string;
};

/**
 * Add a person to a test firm. Remove with removeTestUsers after the firm's
 * memberships are gone (removeTestFirm does that).
 */
export async function addTestMember(
  pool: Pool,
  firm: TestFirm,
  p: {
    firstName: string;
    lastName: string;
    role: "owner" | "admin" | "project_manager" | "staff";
    active?: boolean;
    title?: string;
  },
): Promise<TestMember> {
  const suffix = randomUUID().slice(0, 8);
  const clerkUserId = `user_test_${suffix}`;
  const email = `${p.firstName.toLowerCase()}-${suffix}@example.com`;
  const user = await pool.query<{ id: string }>(
    "insert into users (clerk_user_id, email, first_name, last_name, initials) values ($1, $2, $3, $4, $5) returning id",
    [clerkUserId, email, p.firstName, p.lastName, p.firstName[0] + p.lastName[0]],
  );
  const userId = user.rows[0].id;
  const membershipId = await asFirm(pool, firm.firmId, async (c) => {
    const m = await c.query<{ id: string }>(
      "insert into memberships (firm_id, user_id, app_role, active, title) values ($1, $2, $3, $4, $5) returning id",
      [firm.firmId, userId, p.role, p.active ?? true, p.title ?? null],
    );
    return m.rows[0].id;
  });
  return { userId, clerkUserId, email, membershipId };
}

/** Remove user rows made by addTestMember (or by the code under test). */
export async function removeTestUsers(pool: Pool, userIds: string[]) {
  await pool.query("delete from users where id = any($1::uuid[])", [userIds]);
}
