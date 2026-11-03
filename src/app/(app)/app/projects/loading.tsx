import { PageHeader } from "@/components/ui/page-header";

// While the list loads: the header, grey KPI bars and 8 skeleton rows.
export default function ProjectsLoading() {
  return (
    <main aria-busy="true">
      <PageHeader eyebrow="LOADING…" title="Projects" />
      <div className="flex flex-col gap-5 px-4 pt-6 pb-8 md:px-page-x">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-[88px] rounded-sm border border-line bg-surface p-4">
              <div className="h-3 w-24 rounded-sm bg-line-soft" />
              <div className="mt-3 h-6 w-32 rounded-sm bg-line-soft" />
            </div>
          ))}
        </div>
        <div className="rounded-sm border border-line bg-surface">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex h-[58px] items-center gap-4 border-b border-line-soft px-[18px] last:border-b-0">
              <div className="h-3 w-16 rounded-sm bg-line-soft" />
              <div className="h-3 w-64 rounded-sm bg-line-soft" />
              <div className="h-3 w-24 rounded-sm bg-line-soft" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
