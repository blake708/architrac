"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import "./globals.css";

// Last-resort error page, shown only when the root layout itself crashes.
// It replaces the whole page, so it brings its own <html> and <body>.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="antialiased">
        <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-canvas px-4 text-ink">
          <h1 className="m-0 text-xl font-medium">Something went wrong</h1>
          <p className="m-0 text-ink-2">
            We&apos;ve been notified. Try again, or come back in a few minutes.
          </p>
          <button type="button" onClick={reset} className="text-blue underline">
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
