import { defineConfig } from "drizzle-kit";

// Load .env.local (Next.js does this for the app; drizzle-kit needs it too).
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local yet. Fine for `db:generate`, which doesn't connect.
}

// Migrations run as the database owner. The app itself uses DATABASE_URL.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  dbCredentials: { url: process.env.DATABASE_URL_OWNER ?? "" },
  strict: true,
  verbose: true,
});
