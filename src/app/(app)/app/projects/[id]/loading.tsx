// While a project loads: tiles and table rows as grey bars.
export default function ProjectLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-5">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-[88px] rounded-sm border border-line bg-surface p-4">
            <div className="h-3 w-24 rounded-sm bg-line-soft" />
            <div className="mt-3 h-6 w-32 rounded-sm bg-line-soft" />
          </div>
        ))}
      </div>
      <div className="rounded-sm border border-line bg-surface">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex h-12 items-center gap-4 border-b border-line-soft px-[18px] last:border-b-0">
            <div className="h-3 w-40 rounded-sm bg-line-soft" />
            <div className="h-3 w-64 rounded-sm bg-line-soft" />
          </div>
        ))}
      </div>
    </div>
  );
}
