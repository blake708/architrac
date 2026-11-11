"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import type { StatusBadge } from "@/lib/calc/reminders";
import { cn } from "@/lib/cn";
import { formatHours } from "@/lib/format";
import { whenLabel } from "@/lib/time/display";
import {
  approveStep,
  nudgeApprover,
  remindAll,
  returnTimesheet,
  sendReminder,
} from "@/server/time/approval-actions";
import type { OverviewRow, WeekOverview } from "@/server/time/week-overview";
import { DayBars, FlagText } from "./approval-bits";
import { ApproveForDialog, ReturnDialog } from "./approval-dialogs";

// Time → Approvals → Week overview (timesheet-approval spec, Layout 4).
// One card per team; everyone's status for the week and what you can do.

const COLS = "230px 120px 70px 76px minmax(170px,1fr) 150px minmax(200px,auto)";
const weekHref = (w: string) => `/app/time/approvals/week/${w}`;

function StatusPill({ badge }: { badge: StatusBadge }) {
  const tone = {
    neutral: "bg-line-soft text-ink-2",
    orange: "bg-orange-tint text-orange-strong",
    blue: "bg-blue-tint text-blue",
    green: "bg-green-tint text-green",
  }[badge.tone];
  const mark = {
    neutral: "border-ink-3",
    orange: "bg-orange border-orange",
    blue: "bg-blue border-blue",
    green: "bg-green border-green",
  }[badge.tone];
  return (
    <span className={cn("cap inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-2xs leading-4 font-medium whitespace-nowrap", tone)}>
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 border",
          badge.look === "diamond" ? "rotate-45" : "rounded-full",
          badge.look === "hollow" ? "bg-transparent" : "",
          mark,
        )}
      />
      {badge.label}
    </span>
  );
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-4">
      <path d={dir === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
    </svg>
  );
}

export function WeekOverviewView({ overview: o, timezone }: { overview: WeekOverview; timezone: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [returning, setReturning] = useState<OverviewRow | null>(null);
  const [standIn, setStandIn] = useState<OverviewRow | null>(null);

  async function run(key: string, fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    setBusy(key);
    const r = await fn();
    setBusy(null);
    toast(r.ok ? (r.message ?? "Done.") : (r.error ?? "Couldn't save. Try again."), r.ok ? "neutral" : "error");
    router.refresh();
  }

  const iconLink = cn(buttonClasses("secondary"), "w-[var(--height-control)] px-0");
  const small = "h-[30px] px-2.5 text-sm";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={weekHref(o.prevWeek)} aria-label="Previous week" className={iconLink}>
          <Chevron dir="left" />
        </Link>
        {o.weekStart === o.defaultWeek ? (
          <button type="button" aria-pressed="true" className={cn(buttonClasses("secondary"), "cursor-default")}>
            Last week
          </button>
        ) : (
          <Link href={weekHref(o.defaultWeek)} className={buttonClasses("secondary")}>
            Last week
          </Link>
        )}
        {o.nextWeek ? (
          <Link href={weekHref(o.nextWeek)} aria-label="Next week" className={iconLink}>
            <Chevron dir="right" />
          </Link>
        ) : (
          <button type="button" disabled aria-label="Next week" className={iconLink}>
            <Chevron dir="right" />
          </button>
        )}
        <span className="num ml-2 text-xs text-ink-3 uppercase">{o.meta}</span>
      </div>

      {!o.cards.length && (
        <Card>
          <EmptyState title="No one to show for this week." />
        </Card>
      )}

      {o.cards.map((c) => (
        <section key={c.teamId ?? "none"} aria-label={c.name} className="rounded-sm border border-line bg-surface">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
            <h2 className="m-0 text-sm font-semibold">{c.name}</h2>
            {c.leader && (
              <span className="inline-flex items-center gap-2 text-sm text-ink-2">
                <Avatar name={c.leader.name} initials={c.leader.initials} src={c.leader.avatarUrl} size="sm" />
                {`Team leader · ${c.leader.name}`}
              </span>
            )}
            <span className="num ml-auto text-xs text-ink-3">{c.summary}</span>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[1040px]" role="table" aria-label={`${c.name}, ${o.meta}`}>
              <div
                role="row"
                className="cap grid items-center gap-x-3 border-b border-line-soft bg-surface-2 px-5 py-2 text-2xs font-medium text-muted"
                style={{ gridTemplateColumns: COLS }}
              >
                <span role="columnheader">Person</span>
                <span role="columnheader">Mon–Fri</span>
                <span role="columnheader" className="text-right">
                  Total
                </span>
                <span role="columnheader" className="text-right">
                  Billable
                </span>
                <span role="columnheader">Status</span>
                <span role="columnheader">Flag</span>
                <span role="columnheader">Actions</span>
              </div>
              {c.rows.map((r) => (
                <div
                  key={r.membershipId}
                  role="row"
                  aria-label={r.person.name}
                  className="grid items-center gap-x-3 border-b border-line-soft px-5 py-2.5 last:border-b-0"
                  style={{ gridTemplateColumns: COLS }}
                >
                  <span role="cell" className="flex min-w-0 items-center gap-2.5">
                    <Avatar name={r.person.name} initials={r.person.initials} src={r.person.avatarUrl} size="sm" />
                    <span className="flex min-w-0 flex-col">
                      {r.timesheetId ? (
                        <Link href={`/app/time/approvals/${r.timesheetId}`} className="truncate font-medium text-ink no-underline hover:underline">
                          {r.person.name}
                        </Link>
                      ) : (
                        <span className="truncate font-medium">{r.person.name}</span>
                      )}
                      <span className="truncate text-xs text-muted">
                        {[r.person.title, `Target ${formatHours(r.person.capacity)} h`].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </span>
                  <span role="cell">
                    <DayBars hours={r.days} />
                  </span>
                  <span role="cell" className="num text-right text-sm font-semibold">
                    {formatHours(r.total)}
                  </span>
                  <span role="cell" className="num text-right text-sm">{`${r.billablePct}%`}</span>
                  <span role="cell">
                    <StatusPill badge={r.badge} />
                  </span>
                  <span role="cell">
                    <FlagText flag={r.flag} />
                  </span>
                  <span role="cell" className="flex flex-wrap items-center gap-1.5">
                    {r.canApprove && r.timesheetId && (
                      <>
                        <Button
                          variant="primary"
                          className={small}
                          aria-label={`Approve ${r.person.name}`}
                          disabled={busy === r.membershipId}
                          onClick={() => run(r.membershipId, () => approveStep({ timesheetId: r.timesheetId }))}
                        >
                          Approve
                        </Button>
                        <Button className={small} aria-label={`Return ${r.person.name}`} onClick={() => setReturning(r)}>
                          Return
                        </Button>
                      </>
                    )}
                    {r.approveFor && (
                      <Button className={small} onClick={() => setStandIn(r)}>
                        {`Approve for ${r.approveFor}`}
                      </Button>
                    )}
                    {r.remind?.allowed &&
                      (r.remind.sentAt ? (
                        <Button className={small} disabled>
                          {`Reminder sent ${whenLabel(r.remind.sentAt, timezone).split(", ").pop()}`}
                        </Button>
                      ) : (
                        <Button
                          className={small}
                          aria-label={`Send reminder to ${r.person.name}`}
                          disabled={busy === r.membershipId}
                          onClick={() => run(r.membershipId, () => sendReminder({ membershipId: r.membershipId, weekStart: o.weekStart }))}
                        >
                          Send reminder
                        </Button>
                      ))}
                    {r.nudge &&
                      (r.nudge.sentAt ? (
                        <Button className={small} disabled>
                          {`Nudged ${whenLabel(r.nudge.sentAt, timezone).split(", ").pop()}`}
                        </Button>
                      ) : (
                        <Button
                          className={small}
                          disabled={busy === r.membershipId}
                          onClick={() => run(r.membershipId, () => nudgeApprover({ membershipIds: r.nudge!.membershipIds }))}
                        >
                          {`Nudge ${r.nudge.label}`}
                        </Button>
                      ))}
                  </span>
                </div>
              ))}
            </div>
          </div>
          {c.missing > 0 && c.rows.some((r) => r.remind?.allowed) && (
            <div className="flex border-t border-line-soft px-5 py-3">
              <Button
                disabled={!c.remindable || busy === `all-${c.teamId}`}
                onClick={() => run(`all-${c.teamId}`, () => remindAll({ weekStart: o.weekStart, teamId: c.teamId }))}
              >
                {`Remind all not submitted (${c.remindable})`}
              </Button>
            </div>
          )}
        </section>
      ))}

      {returning?.timesheetId && (
        <ReturnDialog
          open
          onOpenChange={(open) => !open && setReturning(null)}
          initials={returning.person.name}
          onConfirm={async (note) => {
            const r = await returnTimesheet({ timesheetId: returning.timesheetId, note });
            if (!r.ok) return r.error;
            toast(r.message ?? "Returned.");
            router.refresh();
            return null;
          }}
        />
      )}
      {standIn?.timesheetId && standIn.approveFor && (
        <ApproveForDialog
          open
          onOpenChange={(open) => !open && setStandIn(null)}
          names={standIn.approveFor}
          onConfirm={async (note) => {
            const r = await approveStep({ timesheetId: standIn.timesheetId, onBehalf: true, note: note || undefined });
            if (!r.ok) return r.error;
            toast(r.message ?? "Approved.");
            router.refresh();
            return null;
          }}
        />
      )}
    </div>
  );
}
