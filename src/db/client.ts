import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

// Raw database client, connected as the app role (row-level security applies).
// Only src/db/tenant.ts may import this; everything else uses withFirm().
// Uses Neon's WebSocket pool (not the HTTP driver) because withFirm needs
// real transactions.

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
    );
  }
  const pool = new Pool({ connectionString: url });
  return { pool, db: drizzle({ client: pool, schema }) };
}

let instance: ReturnType<typeof createDb> | undefined;

/** The shared client. Created on first use so importing this file never needs env vars. */
export function getDb() {
  instance ??= createDb();
  return instance.db;
}

export type Db = ReturnType<typeof getDb>;

/** Close the connection pool (used by tests and scripts). */
export async function closeDb() {
  if (instance) {
    await instance.pool.end();
    instance = undefined;
  }
}
