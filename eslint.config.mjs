import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
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
