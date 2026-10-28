import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";

// "Page not found" inside the shell, so the rail and header stay.
export default function AppNotFound() {
  return (
    <PageHeader
      title="Page not found"
      description="This page doesn't exist or was moved."
      actions={
        <Link href="/app" className={buttonClasses("secondary")}>
          Go to Home
        </Link>
      }
    />
  );
}
