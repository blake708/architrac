import Link from "next/link";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { TimesheetStatus } from "@/lib/calc/timesheet";
import { formatHours } from "@/lib/format";
import { weekRange } from "@/lib/time/display";

// Time → History (timesheet spec, Layout 8). Each row links to its week.

const SCALE_HOURS = 45;
const STATUS: Record<TimesheetStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  submitted: { label: "With team leader", tone: "blue" },
  leader_approved: { label: "With principal", tone: "blue" },
  approved: { label: "Approved", tone: "green" },
  rejected: { label: "Returned", tone: "orange" },
};

type Week = { weekStart: string; status: TimesheetStatus; total: number; billable: number };

export function TimeHistory({ weeks, hasMore, nextShow }: { weeks: Week[]; hasMore: boolean; nextShow: number }) {
  return (
    <Card title="Your past timesheets" padded={false}>
      {weeks.length === 0 ? (
        <p className="m-0 px-5 py-8 text-center text-sm text-muted">No past timesheets yet.</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {weeks.map((w) => {
            const bill = Math.min(100, (w.billable / SCALE_HOURS) * 100);
            const all = Math.min(100, (w.total / SCALE_HOURS) * 100);
            const s = STATUS[w.status];
            return (
              <li key={w.weekStart} className="border-b border-line-soft last:border-b-0">
                <Link
                  href={`/app/time/week/${w.weekStart}`}
                  className="grid grid-cols-[150px_1fr_80px_120px] items-center gap-4 px-5 py-3 text-ink no-underline hover:bg-surface-2"
                >
                  <span className="text-sm font-medium">{weekRange(w.weekStart)}</span>
                  <span
                    role="img"
                    aria-label={`${formatHours(w.total)} hours, ${formatHours(w.billable)} billable`}
                    className="relative block h-2 overflow-hidden rounded-[1px] bg-line-soft"
                  >
                    <span className="absolute inset-y-0 left-0 bg-blue" style={{ width: `${bill}%` }} />
                    <span className="absolute inset-y-0 bg-[#A9BDE3]" style={{ left: `${bill}%`, width: `${Math.max(0, all - bill)}%` }} />
                  </span>
                  <span className="num text-right text-sm font-semibold">{formatHours(w.total)} h</span>
                  <span>
                    <Badge tone={s.tone} dot>
                      {s.label}
                    </Badge>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {hasMore && (
        <div className="border-t border-line-soft px-5 py-3">
          <Link href={`/app/time/history?show=${nextShow}`} className="text-sm font-medium text-ink">
            Load older
          </Link>
        </div>
      )}
    </Card>
  );
}
