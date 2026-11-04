import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { cn } from "@/lib/cn";
import { progressStatus } from "@/lib/calc/progress";
import { fmtHours } from "@/lib/calc/project-detail";
import type { PhaseStatus } from "@/lib/calc/projects";
import { PHASE_STATUS } from "../project-bits";

// Shared by the Project snapshot (owner/admin) and the Hours vs budget card
// (PMs), so both look like the mockup's snapshot table.

export const th = "cap border-y border-line bg-surface-2 px-2.5 py-[9px] text-left text-2xs font-medium text-muted first:pl-[18px] last:pr-[18px]";
export const td = "border-b border-line-soft px-2.5 py-[11px] align-middle first:pl-[18px] last:pr-[18px]";
export const num = "num text-right text-[12.5px]";

const PCT_TONE = { normal: "text-ink-2", warning: "text-orange", over: "text-red" } as const;

/** Chevron + phase name (the toggle) with its status badge underneath. */
export function PhaseNameCell({ name, status, open }: { name: string; status: PhaseStatus; open: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={cn("shrink-0 text-muted transition-transform duration-[120ms]", open && "rotate-90")}
      >
        <path d="M9 6l6 6-6 6" />
      </svg>
      <span className="flex flex-col items-start gap-1">
        {/* The row's click handler toggles; this button gives keyboard and screen-reader access. */}
        <button type="button" aria-expanded={open} className="cursor-pointer border-0 bg-transparent p-0 text-left font-semibold">
          {name}
        </button>
        <Badge tone={PHASE_STATUS[status].tone} dot>
          {PHASE_STATUS[status].label}
        </Badge>
      </span>
    </span>
  );
}

/** Bar, then "58 / 62 h" on the left and "94%" on the right. Hourly phases: hours only. */
export function HoursCell({ name, used, budget, hourly }: { name: string; used: number; budget: number; hourly: boolean }) {
  if (hourly)
    return (
      <span className="flex flex-col gap-[5px]">
        <span className="num text-xs text-ink-2">{fmtHours(used)} h</span>
        <span className="cap text-2xs font-medium text-muted">Hourly</span>
      </span>
    );
  const s = progressStatus(used, budget);
  const over = Math.max(0, used - budget);
  return (
    <span className="flex flex-col gap-[5px]">
      <ProgressBar
        value={used}
        max={budget}
        label={`${name}: ${fmtHours(used)} of ${fmtHours(budget)} budgeted hours${over ? `, ${fmtHours(over)} over` : ""}`}
      />
      <span className={cn("num flex justify-between text-xs", over > 0 ? "text-red" : "text-ink-2")}>
        <span>
          {fmtHours(used)} / {fmtHours(budget)} h
        </span>
        <span className={over > 0 ? "text-red" : PCT_TONE[s.tone]}>{budget > 0 ? `${s.percent}%` : ""}</span>
      </span>
    </span>
  );
}

/** A value with a small note under it (Billed, Profit, Projected). */
export function Stacked({ value, note, className }: { value: ReactNode; note?: ReactNode; className?: string }) {
  return (
    <span className="flex flex-col items-end gap-0.5">
      <span className={className}>{value}</span>
      {note && <span className="font-sans text-[11.5px] text-muted">{note}</span>}
    </span>
  );
}

/** Footer: the bar legend, then an explanation on the right. */
export function LegendFooter({ children }: { children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-4 border-t border-line-soft px-[18px] pt-3 pb-3.5 text-xs text-ink-3">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="h-2 w-4 bg-blue" />
        Hours used
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="h-2 w-4"
          style={{ background: "repeating-linear-gradient(135deg, var(--color-red) 0 1.5px, var(--color-red-tint) 1.5px 5px)" }}
        />
        Over budget
      </span>
      {children && <span className="flex-[1_1_420px] text-right text-muted">{children}</span>}
    </div>
  );
}
