import type { ErrorEvent } from "@sentry/nextjs";

// Shared Sentry settings for the browser, the server and the edge (proxy).
//
// Privacy: error reports must never carry rates, salaries or client data.
// - sendDefaultPii: false keeps IP addresses, cookies and user details out.
// - scrub() also drops request bodies, cookies and headers, in case a form
//   submission or server action is attached to an error.
// No session replay: it would record what people see on screen.

/** production | preview | development (set by the deploy workflows). */
export const appEnv = process.env.NEXT_PUBLIC_APP_ENV ?? "development";

export function scrub(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.query_string;
  }
  return event;
}

export const sentryOptions = {
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Off on laptops (no DSN in .env.local) and during tests.
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment: appEnv,
  sendDefaultPii: false,
  // Sample 10% of requests for performance timings; errors are always sent.
  tracesSampleRate: 0.1,
  beforeSend: scrub,
};
