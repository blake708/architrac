import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentry-options";

// Runs in the browser before the app starts: reports errors from pages.
Sentry.init(sentryOptions);

// Times page-to-page navigation (part of the 10% performance sample).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
