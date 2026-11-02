import type { UtilizationView } from "@/lib/calc/utilization";
import { cn } from "@/lib/cn";

/**
 * Utilization · 4 wks (team spec, rule 5): a 110px bar with a tick at the
 * target and "88% / 85%". Below target: orange hatched fill and orange text.
 * Missing (staff looking at someone else) or no target: "—".
 */
export function UtilizationCell({ value }: { value?: UtilizationView }) {
  if (!value || value.kind === "none") {
    return <span className="text-muted">—</span>;
  }
  return (
    <span className="inline-flex items-center gap-2.5" data-testid="utilization">
      <span
        aria-hidden="true"
        className="relative block h-2 w-[110px] shrink-0 rounded-sm bg-line-soft"
      >
        <span
          className={cn("absolute inset-y-0 left-0 rounded-sm", !value.below && "bg-blue")}
          style={{
            width: `${value.fill}%`,
            ...(value.below && {
              background:
                "repeating-linear-gradient(135deg,#C2410C 0 1.5px,#F6CDB9 1.5px 5px)",
            }),
          }}
        />
        <span
          className="absolute -top-1 -bottom-1 w-0.5 bg-ink"
          style={{ left: `calc(${Math.min(value.targetPct, 100)}% - 1px)` }}
        />
      </span>
      <span
        className={cn("num text-[12.5px] whitespace-nowrap", value.below ? "text-orange-strong" : "text-ink")}
        data-below={value.below}
      >
        {value.pct}% / {value.targetPct}%
      </span>
    </span>
  );
}
