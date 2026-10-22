import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Tenant isolation: all queries go through withFirm() in src/db/tenant.ts.
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/db/client", "**/db/client", "./client"],
              message:
                "Use withFirm() from @/db/tenant. Only tenant.ts may use the raw client.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/db/tenant.ts", "src/db/**/*.test.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  // Must come last: turns off style rules that Prettier handles.
  prettier,
  globalIgnores([
    ".next/**",
    "next-env.d.ts",
    "mockup/**",
    "seed/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);
