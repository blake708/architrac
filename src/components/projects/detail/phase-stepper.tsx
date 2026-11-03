import { CheckIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { stepperNote } from "@/lib/calc/project-detail";
import type { PhaseRow } from "@/server/projects/page";

const BAR = { current: "#2F5BAA", complete: "#A9BDE3", closed: "#A9BDE3", upcoming: "#E3E3E3" } as const;

/** One step per phase (project-detail spec, Layout 2). */
export function PhaseStepper({ phases }: { phases: PhaseRow[] }) {
  if (phases.length === 0) return null;
  const firstCurrent = phases.find((p) => p.status === "current")?.id;
  return (
    <div className="overflow-x-auto border-b border-line bg-surface px-4 pt-1 pb-4 md:px-page-x">
      <ol
        aria-label="Project phases"
        className="m-0 grid list-none gap-2 p-0"
        style={{ gridTemplateColumns: `repeat(${phases.length}, minmax(120px, 1fr))` }}
      >
        {phases.map((p) => {
          const done = p.status === "complete" || p.status === "closed";
          return (
            <li key={p.id} aria-current={p.id === firstCurrent ? "step" : undefined} data-phase={p.code}>
              <span aria-hidden="true" className="block h-1.5 rounded-[1px]" style={{ background: BAR[p.status] }} />
              <span className={cn("cap mt-2 flex items-center gap-1 text-2xs", p.status === "current" ? "font-semibold text-ink" : "text-ink-2")}>
                {done && <CheckIcon className="size-3.5 text-green" aria-label="Complete" />}
                {p.name}
              </span>
              <span className="block text-xs text-muted">{stepperNote(p)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
