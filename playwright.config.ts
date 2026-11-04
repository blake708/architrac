import { defineConfig, devices } from "@playwright/test";

// Signed-in tests need the Clerk keys and the database owner URL.
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: signed-in tests will explain what's missing.
}

const PORT = 3000;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: "**/support/**",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Locally every browser shares one dev server; more than 4 at once makes
  // it slow enough for tests to time out. CI sets its own.
  workers: process.env.CI ? undefined : 4,
  reporter: process.env.CI ? "github" : "list",
  // Creates throwaway test people and firms in the Clerk development instance
  // and dev database, and removes them afterwards (tests/e2e/support).
  globalSetup: "./tests/e2e/support/global-setup.ts",
  globalTeardown: "./tests/e2e/support/global-teardown.ts",
  // Signing in and first page compiles in dev mode are slow.
  timeout: 60_000,
  use: {
    baseURL,
    // In CI keep a full trace of any failure (screens, network, clicks).
    trace: process.env.CI ? "retain-on-failure" : "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Starts the app before the tests run (or reuses one already running).
  webServer: {
    command: "pnpm dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
