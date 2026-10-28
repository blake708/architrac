"use client";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";

// Shown inside the shell when a page breaks. The code ("digest") matches the
// error in the server logs, so it can be looked up.
export default function AppError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const digest =
    error instanceof Error &&
    "digest" in error &&
    typeof error.digest === "string"
      ? error.digest
      : "none";

  return (
    <PageHeader
      title="Something went wrong"
      description={
        <>
          Try again. If it keeps happening, send Blake this code:{" "}
          <span className="num">{digest}</span>.
        </>
      }
      actions={
        <Button variant="primary" onClick={() => retry()}>
          Try again
        </Button>
      }
    />
  );
}
