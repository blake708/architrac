import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { HeaderKpis, KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader } from "@/components/ui/page-header";
import { headerTabBarClasses, tabClasses, tabCountClasses, tabRowClasses } from "@/components/ui/tab-styles";
import { addDays, weekTotals } from "@/lib/calc/timesheet";
import { cn } from "@/lib/cn";
import { formatHours } from "@/lib/format";
import type { TimesheetView } from "@/server/time/week";

// Top of the Time page (timesheet spec, Layout 1–3): subheading and title,
// the KPI tiles, and the tabs (links to their routes). The week arrows sit in
// the timesheet's status bar (WeekNav below).

const weekHref = (w: string) => `/app/time/week/${w}`;

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-4 shrink-0">
      <path d={dir === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
    </svg>
  );
}

/** Previous week · This week · Next week (timesheet spec, Layout 4). */
export function WeekNav({ view }: { view: TimesheetView }) {
  const isCurrent = view.weekStart === view.currentWeekStart;
  const canNext = view.weekStart < view.lastWeekStart;
  const iconBtn = cn(buttonClasses("secondary"), "w-[var(--height-control)] px-0");
  return (
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
}

export function TimeHeader({
  view,
  tab,
  historyCount,
  approvalsCount = null,
  notSubmitted = null,
}: {
  view: TimesheetView;
  tab: "mine" | "approvals" | "history";
  historyCount: number;
  /** Sheets waiting on me; null = no Approvals tab (timesheet-approval spec, Who can see it). */
  approvalsCount?: number | null;
  /** KPI "Not submitted" for the last due week (Approvals pages only). */
  notSubmitted?: { count: number; weekLabel: string } | null;
}) {
  const t = weekTotals(view.rows, view.targetHours);
  const short = Math.max(0, view.targetHours - t.weekTotal);
  const tabs = [
    { key: "mine", label: "My timesheet", href: weekHref(view.weekStart), count: null },
    ...(approvalsCount !== null
      ? [{ key: "approvals", label: "Approvals", href: "/app/time/approvals", count: approvalsCount } as const]
      : []),
    { key: "history", label: "History", href: "/app/time/history", count: historyCount },
  ] as const;

  return (
    <>
      <PageHeader
        eyebrow={approvalsCount !== null ? "TIMESHEETS · APPROVALS · HISTORY" : "TIMESHEETS · HISTORY"}
        title="Time"
      >
        <HeaderKpis label="This week">
          <KpiTile
            variant="header"
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
            variant="header"
            label="Billable"
            value={`${t.billablePct}%`}
            note={`${formatHours(t.billable)} billable hours${view.targetUtilizationPct !== null ? ` · target ${view.targetUtilizationPct}%` : ""}`}
          />
          {approvalsCount !== null && <KpiTile variant="header" label="Ready for you" value={String(approvalsCount)} note="Timesheets waiting on you" />}
          {notSubmitted && (
            <KpiTile
              variant="header"
              label="Not submitted"
              value={String(notSubmitted.count)}
              tone={notSubmitted.count > 0 ? "orange" : "default"}
              note={notSubmitted.weekLabel}
            />
          )}
        </HeaderKpis>
        <nav aria-label="Time sections" className={headerTabBarClasses}>
          <ul className={tabRowClasses}>
            {tabs.map((x) => (
              <li key={x.key}>
                <Link
                  href={x.href}
                  aria-current={tab === x.key ? "page" : undefined}
                  className={tabClasses(tab === x.key)}
                >
                  {x.label}
                  {x.count !== null && <span className={tabCountClasses}>{x.count}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </PageHeader>
    </>
  );
}
