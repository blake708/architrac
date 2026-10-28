import { progressStatus } from "@/lib/calc/progress";
import type { ProgressTone } from "@/lib/calc/progress";
import { cn } from "@/lib/cn";

const fills: Record<ProgressTone, string> = {
  normal: "bg-blue",
  warning: "bg-orange",
  over: "bg-red",
};

const percentText: Record<ProgressTone, string> = {
  normal: "text-ink-2",
  warning: "text-orange",
  over: "text-red",
};

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

/** 6px bar: blue normally, orange at 90%+, red over 100%. */
export function ProgressBar({
  value,
  max,
  label,
  showPercent,
  className,
}: ProgressBarProps) {
  const { percent, fillPercent, tone } = progressStatus(value, max);
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <span
        role="img"
        aria-label={`${label}: ${percent}%`}
        data-tone={tone}
        className="block h-1.5 min-w-12 flex-1 overflow-hidden rounded-[1px] bg-line-soft"
      >
        <span
          className={cn("block h-full", fills[tone])}
          style={{ width: `${fillPercent}%` }}
        />
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
