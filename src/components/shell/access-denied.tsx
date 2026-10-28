import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";

/**
 * Shown inside the shell when the person's role can't open a page.
 * The page decides this on the server and renders this instead of its data.
 */
export function AccessDenied({ firmName }: { firmName: string }) {
  return (
    <PageHeader
      title="You don't have access to this page"
      description={`Ask an owner or admin of ${firmName} if you need it.`}
      actions={
        <Link href="/app" className={buttonClasses("secondary")}>
          Go to Home
        </Link>
      }
    />
  );
}
