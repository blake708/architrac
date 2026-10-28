import { createClerkClient } from "@clerk/backend";
import { Pool } from "@neondatabase/serverless";
import { E2E_EMAILS, E2E_PREFIX } from "./people";

// Removes everything the browser tests made, from Clerk and from the dev
// database. Runs before the tests (in case a previous run was interrupted)
// and after them.

export function clerkAdmin() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey?.startsWith("sk_test_")) {
    // Never run against a production Clerk instance.
    throw new Error(
      "Browser tests need a Clerk DEVELOPMENT secret key (sk_test_…) in .env.local.",
    );
  }
  return createClerkClient({ secretKey });
}

export function ownerPool() {
  const url = process.env.DATABASE_URL_OWNER;
  if (!url)
    throw new Error("Browser tests need DATABASE_URL_OWNER in .env.local.");
  return new Pool({ connectionString: url });
}

export async function cleanE2eData() {
  const clerk = clerkAdmin();

  // Clerk: test organizations (including firms made by the create-firm test)
  // and test users.
  const orgs = await clerk.organizations.getOrganizationList({
    query: E2E_PREFIX.trim(),
    limit: 100,
  });
  for (const org of orgs.data) {
    if (org.name.startsWith(E2E_PREFIX)) {
      await clerk.organizations.deleteOrganization(org.id);
    }
  }
  const users = await clerk.users.getUserList({
    emailAddress: E2E_EMAILS,
    limit: 100,
  });
  for (const u of users.data) await clerk.users.deleteUser(u.id);

  // Database. Tests may hard-delete; the app itself never does.
  const pool = ownerPool();
  try {
    const firms = await pool.query<{ id: string }>(
      "select id from firms where name like $1",
      [`${E2E_PREFIX}%`],
    );
    for (const { id } of firms.rows) {
      const c = await pool.connect();
      try {
        await c.query("begin");
        await c.query("select set_config('app.firm_id', $1, true)", [id]);
        await c.query(
          "update teams set leader_membership_id = null where firm_id = $1",
          [id],
        );
        for (const table of [
          "activity_log",
          "invitations",
          "memberships",
          "teams",
          "firm_settings",
        ]) {
          await c.query(`delete from ${table} where firm_id = $1`, [id]);
        }
        await c.query("commit");
      } finally {
        c.release();
      }
      await pool.query("delete from firms where id = $1", [id]);
    }
    await pool.query("delete from users where email = any($1::text[])", [
      E2E_EMAILS,
    ]);
  } finally {
    await pool.end();
  }
}
