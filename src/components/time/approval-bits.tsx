import { Fragment } from "react";
import { type Flag, barsLabel, dayBar } from "@/lib/calc/timesheet-flags";
import { cn } from "@/lib/cn";
import type { ReviewChip } from "@/lib/time/approval";

// Small pieces shared by the Approvals queue and detail page
// (timesheet-approval spec, Layout 2–5).

function Arrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-faint">
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}

/** Submitted → each step → Approved. */
export function RouteStrip({ steps }: { steps: string[] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Approval route">
      <span className="rounded-sm bg-line-soft px-2.5 py-1">Submitted</span>
      {steps.map((s, i) => (
        <Fragment key={i}>
          <Arrow />
          <span className="rounded-sm bg-blue-tint px-2.5 py-1 text-blue-strong">{s}</span>
        </Fragment>
      ))}
      <Arrow />
      <span className="rounded-sm bg-green-tint px-2.5 py-1 text-green">Approved</span>
    </span>
  );
}

/** The sheet's own review as chips (detail page). */
export function ReviewStrip({ chips }: { chips: ReviewChip[] }) {
  const tone = {
    green: "bg-green-tint text-green",
    blue: "bg-blue-tint text-blue-strong",
    neutral: "border border-line bg-surface text-ink-2",
    skipped: "bg-line-soft text-muted",
  } as const;
  return (
    <ul className="m-0 flex list-none flex-wrap items-center gap-2 p-0 text-sm" aria-label="Review">
      {chips.map((c, i) => (
        <li key={i} className={cn("rounded-sm px-2.5 py-1", tone[c.tone])}>
          {c.label}
        </li>
      ))}
    </ul>
  );
}

/** Mon–Fri bars: 10px wide, 0 h grey, over 9 h orange, else blue. */
export function DayBars({ hours }: { hours: number[] }) {
  const tone = { empty: "bg-line", over: "bg-orange", normal: "bg-blue" } as const;
  return (
    <span role="img" aria-label={barsLabel(hours)} className="flex h-[26px] items-end gap-[3px]">
      {hours.map((h, i) => {
        const b = dayBar(h);
        return <span key={i} className={cn("w-2.5 rounded-[1px]", tone[b.tone])} style={{ height: b.height }} />;
      })}
    </span>
  );
}

/** A flag in its colour, or a muted dash when clean. */
export function FlagText({ flag }: { flag: Flag | null }) {
  if (!flag) return <span className="text-muted">—</span>;
  return <span className={cn("text-sm", flag.tone === "red" ? "text-red" : "text-orange-strong")}>{flag.label}</span>;
}
