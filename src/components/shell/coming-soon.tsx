import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

type ComingSoonProps = {
  title: string;
  /** "1" → "Projects arrives in Release 1." */
  release?: string;
  /** "0.6" → "… arrives in milestone 0.6." Use instead of release. */
  milestone?: string;
};

/** Placeholder for a page that's in the menu but not built yet. */
export function ComingSoon({ title, release, milestone }: ComingSoonProps) {
  const when = milestone ? `milestone ${milestone}` : `Release ${release}`;
  return (
    <>
      <PageHeader title={title} />
      <main className="px-4 py-8 md:px-page-x">
        <Card>
          <EmptyState
            title={`${title} arrives in ${when}.`}
            help="This page is in the menu so you can see where it will live."
          />
        </Card>
      </main>
    </>
  );
}
