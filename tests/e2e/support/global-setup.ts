import { randomBytes } from "node:crypto";
import { clerkSetup } from "@clerk/testing/playwright";
import { cleanE2eData, clerkAdmin, ownerPool } from "./clean";
import { FIRMS, type FirmKey, PEOPLE } from "./people";

// Runs once before the browser tests:
// 1. clerkSetup() fetches a Clerk "testing token" so sign-in isn't blocked
//    by bot protection.
// 2. Removes anything left from an earlier run.
// 3. Creates the test people and firms (support/people.ts) in Clerk and in
//    the dev database, with the roles the tests need.
//
// Clerk's webhook doesn't reach a laptop, so the database rows are written
// here directly instead of waiting for it.

/** Who creates each test firm in Clerk: Olive, unless the firm says otherwise. */
function creatorOf(firm: FirmKey): string {
  const f = FIRMS[firm] as { createdBy?: string };
  return f.createdBy ?? "owner";
}

export default async function globalSetup() {
  await clerkSetup();
  await cleanE2eData();

  const clerk = clerkAdmin();
  const pool = ownerPool();

  try {
    // People
    const clerkUserIds: Record<string, string> = {};
    const userIds: Record<string, string> = {};
    for (const [key, p] of Object.entries(PEOPLE)) {
      const u = await clerk.users.createUser({
        emailAddress: [p.email],
        firstName: p.firstName,
        lastName: p.lastName,
        skipPasswordRequirement: true,
      });
      clerkUserIds[key] = u.id;
      const row = await pool.query<{ id: string }>(
        `insert into users (clerk_user_id, email, first_name, last_name, initials)
         values ($1, $2, $3, $4, $5) returning id`,
        [
          u.id,
          p.email,
          p.firstName,
          p.lastName,
          p.firstName[0] + p.lastName[0],
        ],
      );
      userIds[key] = row.rows[0].id;
    }

    // Firms: a Clerk organization, then our firm and settings rows.
    const firmIds = {} as Record<FirmKey, string>;
    const orgIds = {} as Record<FirmKey, string>;
    for (const [key, f] of Object.entries(FIRMS) as [
      FirmKey,
      (typeof FIRMS)[FirmKey],
    ][]) {
      const org = await clerk.organizations.createOrganization({
        name: f.name,
        createdBy: clerkUserIds[creatorOf(key)],
      });
      orgIds[key] = org.id;
      const slug = `e2e-${key}-${randomBytes(3).toString("hex")}`;
      const firm = await pool.query<{ id: string }>(
        "insert into firms (name, slug, clerk_org_id) values ($1, $2, $3) returning id",
        [f.name, slug, org.id],
      );
      firmIds[key] = firm.rows[0].id;
      await asFirm(pool, firmIds[key], (c) =>
        c.query(
          "insert into firm_settings (firm_id, modules_enabled) values ($1, $2::text[])",
          [firmIds[key], f.modules],
        ),
      );
    }

    // Memberships, in Clerk and in our database.
    for (const [key, p] of Object.entries(PEOPLE)) {
      for (const m of p.memberships as {
        firm: FirmKey;
        role: string;
        active?: boolean;
      }[]) {
        // Whoever created the org is already its Clerk admin.
        if (key !== creatorOf(m.firm)) {
          await clerk.organizations.createOrganizationMembership({
            organizationId: orgIds[m.firm],
            userId: clerkUserIds[key],
            role:
              m.role === "owner" || m.role === "admin"
                ? "org:admin"
                : "org:member",
          });
        }
        await asFirm(pool, firmIds[m.firm], (c) =>
          c.query(
            `insert into memberships (firm_id, user_id, app_role, active) values ($1, $2, $3, $4)
             on conflict (firm_id, user_id) do update set app_role = excluded.app_role, active = excluded.active`,
            [firmIds[m.firm], userIds[key], m.role, m.active ?? true],
          ),
        );
      }
    }
  } finally {
    await pool.end();
  }
}

async function asFirm<T>(
  pool: ReturnType<typeof ownerPool>,
  firmId: string,
  fn: (c: import("@neondatabase/serverless").PoolClient) => Promise<T>,
) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.firm_id', $1, true)", [firmId]);
    const result = await fn(c);
    await c.query("commit");
    return result;
  } catch (err) {
    await c.query("rollback");
    throw err;
  } finally {
    c.release();
  }
}
