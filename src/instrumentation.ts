import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentry-options";

// Next.js runs register() once when the server starts. It turns on Sentry
// for server code (pages, server actions, route handlers) and the proxy.
export function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" ||
    process.env.NEXT_RUNTIME === "edge"
  ) {
    Sentry.init(sentryOptions);
  }
}

// Sends errors thrown while rendering or handling a request to Sentry.
export const onRequestError = Sentry.captureRequestError;
