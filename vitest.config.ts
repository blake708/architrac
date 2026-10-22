import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Lets tests use the same "@/..." imports as the app.
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    // No unit tests exist yet; the first ones arrive in milestone 0.2.
    passWithNoTests: true,
  },
});
