import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  // Declare your Neon services here
  auth: false,
  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault) {
      // Default branch: no overrides, uses project defaults
      return {};
    }
    if (branch.name === "dev") {
      // The long-lived local development branch: never expires.
      // (An earlier dev branch was auto-deleted by the 7-day rule below.)
      return {};
    }
    if (!branch.exists) {
      // New throwaway branches: auto-expire
      // Run `neon checkout <name>` to create a new branch with these settings
      return { ttl: "7d" };
    }
    // Existing branch: no changes
    return {};
  },
});
