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
