import { progressStatus } from "@/lib/calc/progress";
import type { ProgressTone } from "@/lib/calc/progress";
import { cn } from "@/lib/cn";

// The fill is always blue. Approaching budget shows only in the percent text;
// over budget adds a red hatched overrun after the fill.
const percentText: Record<ProgressTone, string> = {
  normal: "text-ink-2",
  warning: "text-orange",
  over: "text-red",
};

const hatch =
  "repeating-linear-gradient(135deg, var(--color-red) 0 1.5px, var(--color-red-tint) 1.5px 5px)";

type ProgressBarProps = {
  /** Amount used, e.g. hours logged. */
  value: number;
  /** Budget, e.g. hours budgeted. */
  max: number;
  /** What the bar measures, read by screen readers: "Hours used". */
  label: string;
  /** Show the percent to the right of the bar. */
  showPercent?: boolean;
  className?: string;
};

/** 10px blue bar; orange percent at 90%+; hatched red overrun past 100%. */
export function ProgressBar({
  value,
  max,
  label,
  showPercent,
  className,
}: ProgressBarProps) {
  const { percent, fillWidth, overWidth, tone } = progressStatus(value, max);
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <span
        role="img"
        aria-label={`${label}: ${percent}%`}
        data-tone={tone}
        className="flex h-2.5 min-w-12 flex-1 overflow-hidden rounded-[1px] bg-line-soft"
      >
        <span
          className="block h-full bg-blue"
          style={{ width: `${fillWidth}%` }}
        />
        {overWidth > 0 && (
          <span
            data-part="over"
            className="block h-full"
            style={{ width: `${overWidth}%`, background: hatch }}
          />
        )}
      </span>
      {showPercent && (
        <span
          aria-hidden="true"
          className={cn(
            "num w-10 shrink-0 text-right text-xs",
            percentText[tone],
          )}
        >
          {percent}%
        </span>
      )}
    </span>
  );
}
