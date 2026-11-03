import { cn } from "@/lib/cn";
import { HEALTH_LABELS, type Health, type PhaseStatus } from "@/lib/calc/projects";
import { HEALTH_SHAPES } from "@/lib/projects/form";

/** One 24×6 segment per phase. Decorative: the phase text carries the meaning. */
export function PhaseSteps({ steps }: { steps: PhaseStatus[] }) {
  return (
    <span aria-hidden="true" className="flex gap-0.5">
      {steps.map((s, i) => (
        <span
          key={`${i}-${s}`}
          className="block h-1.5 w-6 rounded-[1px]"
          style={{
            background: s === "current" ? "#2F5BAA" : s === "upcoming" ? "#E3E3E3" : "#A9BDE3",
          }}
        />
      ))}
    </span>
  );
}

const HEALTH_TONE: Record<Health, string> = {
  on_track: "bg-green-tint text-green",
  at_risk: "bg-orange-tint text-orange-strong",
  over_budget: "bg-red-tint text-red",
  on_hold: "bg-line-soft text-ink-2",
  closed: "bg-line-soft text-ink-2",
  pursuit: "bg-line-soft text-ink-2",
};
const DOT: Record<Health, string> = {
  on_track: "bg-green",
  at_risk: "bg-orange",
  over_budget: "bg-red",
  on_hold: "bg-ink-3",
  closed: "bg-ink-3",
  pursuit: "bg-ink-3",
};

/** Health with a shape, so it doesn't rely on colour alone. */
export function HealthBadge({ health }: { health: Health }) {
  const shape = HEALTH_SHAPES[health];
  return (
    <span
      className={cn(
        "cap inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-2xs leading-4 font-medium whitespace-nowrap",
        HEALTH_TONE[health],
      )}
    >
      {shape !== "none" && (
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 shrink-0",
            DOT[health],
            shape === "circle" && "rounded-full",
            shape === "diamond" && "rotate-45",
          )}
        />
      )}
      {HEALTH_LABELS[health]}
    </span>
  );
}
