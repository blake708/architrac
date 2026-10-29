import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

// Sentry reads SENTRY_ORG, SENTRY_PROJECT and SENTRY_AUTH_TOKEN from the
// environment (set in the deploy workflows). Without them, the build still
// works; it just skips uploading source maps.
export default withSentryConfig(nextConfig, {
  silent: !process.env.CI,
  // Upload source maps to Sentry, then delete them so they're not public.
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  widenClientFileUpload: true,
});
