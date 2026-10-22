import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Lets tests use the same "@/..." imports as the app.
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    // Database tests (*.db.test.ts) talk to Neon over the network.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
