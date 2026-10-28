import { sql } from "drizzle-orm";
import { z } from "zod";
import { type Db, getDb } from "./client";

/** The database handle passed to withFirm callbacks. Every query on it is limited to one firm. */
export type TenantDb = Parameters<Parameters<Db["transaction"]>[0]>[0];

const firmIdSchema = z.uuid();

/**
 * Run `fn` inside a transaction that can only see and change one firm's rows.
 *
 * It sets `app.firm_id` for this transaction only (the `true` argument), and the
 * row-level security policies compare every row's firm_id against it. When the
 * transaction ends the setting disappears, so a pooled connection can't carry
 * one firm's access into the next request.
 *
 * @example
 *   const teams = await withFirm(firmId, (db) => db.select().from(teamsTable));
 */
export async function withFirm<T>(
  firmId: string,
  fn: (db: TenantDb) => Promise<T>,
): Promise<T> {
  const id = firmIdSchema.parse(firmId);
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.firm_id', ${id}, true)`);
    return fn(tx);
  });
}

/**
 * Run `fn` in a transaction with NO firm selected. Only for the `users` table,
 * which isn't owned by a firm (a person can belong to several).
 *
 * Safe by design: every firm-owned table returns nothing here and refuses
 * writes, because row-level security fails closed when no firm is set.
 */
export async function withoutFirm<T>(
  fn: (db: TenantDb) => Promise<T>,
): Promise<T> {
  return getDb().transaction(fn);
}

/**
 * Turn a Clerk organization id into our firm id (or null if there's no firm
 * for it, or it's archived). The one lookup that runs before the firm is known;
 * it uses a database function that returns only the id.
 */
export async function findFirmIdByClerkOrg(
  clerkOrgId: string,
): Promise<string | null> {
  const result = await getDb().execute<{ id: string | null }>(
    sql`select firm_id_for_clerk_org(${clerkOrgId}) as id`,
  );
  return result.rows[0]?.id ?? null;
}
