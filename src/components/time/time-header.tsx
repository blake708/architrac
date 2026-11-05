import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader } from "@/components/ui/page-header";
import { addDays, weekTotals } from "@/lib/calc/timesheet";
import { cn } from "@/lib/cn";
import { formatHours } from "@/lib/format";
import { weekMetaLine } from "@/lib/time/display";
import type { TimesheetView } from "@/server/time/week";

// Top of the Time page (timesheet spec, Layout 1–3): week line and week
// navigation, the KPI tiles, and the tabs (links to their routes).

const weekHref = (w: string) => `/app/time/week/${w}`;

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-4 shrink-0">
      <path d={dir === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
    </svg>
  );
}

export function TimeHeader({
  view,
  tab,
  historyCount,
}: {
  view: TimesheetView;
  tab: "mine" | "history";
  historyCount: number;
}) {
  const isCurrent = view.weekStart === view.currentWeekStart;
  const canNext = view.weekStart < view.lastWeekStart;
  const iconBtn = cn(buttonClasses("secondary"), "w-[var(--height-control)] px-0");
  const nav = (
    <nav aria-label="Weeks" className="flex flex-wrap items-center gap-2">
      <Link href={weekHref(addDays(view.weekStart, -7))} aria-label="Previous week" className={iconBtn}>
        <Chevron dir="left" />
      </Link>
      {isCurrent ? (
        <button type="button" aria-pressed="true" className={cn(buttonClasses("secondary"), "cursor-default")}>
          This week
        </button>
      ) : (
        <Link href={weekHref(view.currentWeekStart)} className={buttonClasses("secondary")}>
          This week
        </Link>
      )}
      {canNext ? (
        <Link href={weekHref(addDays(view.weekStart, 7))} aria-label="Next week" className={iconBtn}>
          <Chevron dir="right" />
        </Link>
      ) : (
        <button type="button" aria-label="Next week" disabled className={iconBtn}>
          <Chevron dir="right" />
        </button>
      )}
    </nav>
  );

  const t = weekTotals(view.rows, view.targetHours);
  const short = Math.max(0, view.targetHours - t.weekTotal);
  const tabs = [
    { key: "mine", label: "My timesheet", href: weekHref(view.weekStart), count: null },
    { key: "history", label: "History", href: "/app/time/history", count: historyCount },
  ] as const;

  return (
    <>
      <PageHeader
        eyebrow={<span className="uppercase">{weekMetaLine(view.weekStart, view.dueLabel)}</span>}
        title="Time"
        actions={tab === "mine" ? nav : undefined}
      />
      <div className="flex flex-col gap-5 px-4 pt-6 md:px-page-x">
        <section aria-label="This week" className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
          <KpiTile
            label="This week"
            value={`${formatHours(t.weekTotal)} h`}
            note={
              short > 0 ? (
                <span className="text-orange-strong">{`${formatHours(short)} h short of ${formatHours(view.targetHours)}`}</span>
              ) : (
                "Target met"
              )
            }
          />
          <KpiTile
            label="Billable"
            value={`${t.billablePct}%`}
            note={`${formatHours(t.billable)} billable hours${view.targetUtilizationPct !== null ? ` · target ${view.targetUtilizationPct}%` : ""}`}
          />
        </section>
        <nav aria-label="Time sections" className="border-b border-line">
          <ul className="m-0 flex list-none gap-6 overflow-x-auto overflow-y-hidden p-0">
            {tabs.map((x) => (
              <li key={x.key}>
                <Link
                  href={x.href}
                  aria-current={tab === x.key ? "page" : undefined}
                  className={cn(
                    "block border-b-2 px-1 pt-3 pb-2.5 text-base whitespace-nowrap no-underline",
                    tab === x.key ? "border-ink font-semibold text-ink" : "border-transparent text-ink-3 hover:text-ink",
                  )}
                >
                  {x.label}
                  {x.count !== null && <span className="num ml-2 text-2xs font-medium text-muted">{x.count}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </>
  );
}
