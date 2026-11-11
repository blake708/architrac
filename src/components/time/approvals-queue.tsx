"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { formatHours } from "@/lib/format";
import { approveCleanLabel } from "@/lib/time/approval";
import { approveMany, approveStep, returnTimesheet } from "@/server/time/approval-actions";
import type { ApprovalsQueue, QueueItem } from "@/server/time/approval-read";
import { DayBars, FlagText, RouteStrip } from "./approval-bits";
import { ConfirmApproveDialog, ReturnDialog } from "./approval-dialogs";

// Time → Approvals → "Waiting on me" (timesheet-approval spec, Layout 2–3).
// One card per week; approve or return each row, or select several.

const COLS = "36px 230px 120px 70px 76px minmax(160px,1fr) 150px 190px";

export function ApprovalsQueueView({ queue, weekHref }: { queue: ApprovalsQueue; weekHref: string }) {
  const router = useRouter();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [returning, setReturning] = useState<QueueItem | null>(null);
  const [confirm, setConfirm] = useState<string[] | null>(null);

  const items = queue.weeks.flatMap((w) => w.items);
  const clean = items.filter((i) => !i.flag).map((i) => i.timesheetId);
  const chosen = items.filter((i) => selected.has(i.timesheetId));

  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  async function approveOne(i: QueueItem) {
    setBusy(i.timesheetId);
    const r = await approveStep({ timesheetId: i.timesheetId });
    setBusy(null);
    if (!r.ok) {
      setErrors((e) => ({ ...e, [i.timesheetId]: r.error }));
      toast(r.error, "error");
      router.refresh();
      return;
    }
    toast(r.message ?? "Approved.");
    toggle(i.timesheetId, false);
    router.refresh();
  }

  async function approveIds(ids: string[]) {
    const r = await approveMany({ timesheetIds: ids });
    toast(r.ok ? (r.message ?? "Approved.") : r.error, r.ok && !r.message?.includes("not approved") ? "neutral" : "error");
    setSelected(new Set());
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4 pb-20">
      <section
        aria-label="Approval route"
        className="flex flex-wrap items-center gap-3.5 rounded-sm border border-line bg-surface px-5 py-4"
      >
        <span className="cap text-2xs font-semibold text-ink-2">Approval route</span>
        <RouteStrip steps={queue.route} />
        <span className="text-[12.5px] text-muted">Rates lock when the last step approves.</span>
        <Button variant="primary" className="ml-auto" disabled={!clean.length} onClick={() => setConfirm(clean)}>
          {approveCleanLabel(clean.length)}
        </Button>
      </section>

      {!items.length && (
        <Card>
          <EmptyState
            title="Nothing waiting on you"
            help="Timesheets that need your review appear here."
            action={
              <Link href={weekHref} className={buttonClasses("secondary")}>
                Go to week overview
              </Link>
            }
          />
        </Card>
      )}

      {queue.weeks.map((w) => {
        const ids = w.items.map((i) => i.timesheetId);
        const all = ids.every((id) => selected.has(id));
        return (
          <section key={w.weekStart} aria-label={w.label} className="rounded-sm border border-line bg-surface">
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
              <h2 className="cap m-0 text-sm font-semibold">{w.label}</h2>
              <span className="num ml-auto text-xs text-ink-3">
                {`${w.ready} ready for you${w.withOthers ? ` · ${w.withOthers} with others` : ""}`}
              </span>
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[1040px]" role="table" aria-label={`Timesheets, ${w.label}`}>
                <div
                  role="row"
                  className="cap grid items-center gap-x-3 border-b border-line-soft bg-surface-2 px-5 py-2 text-2xs font-medium text-muted"
                  style={{ gridTemplateColumns: COLS }}
                >
                  <span role="columnheader">
                    <input
                      type="checkbox"
                      className="size-4 accent-ink"
                      aria-label={`Select all, ${w.label}`}
                      checked={all}
                      onChange={(e) => ids.forEach((id) => toggle(id, e.target.checked))}
                    />
                  </span>
                  <span role="columnheader">Person</span>
                  <span role="columnheader">Mon–Fri</span>
                  <span role="columnheader" className="text-right">
                    Total
                  </span>
                  <span role="columnheader" className="text-right">
                    Billable
                  </span>
                  <span role="columnheader">Step</span>
                  <span role="columnheader">Flag</span>
                  <span role="columnheader">Actions</span>
                </div>
                {w.items.map((i) => (
                  <div key={i.timesheetId} role="row" className="border-b border-line-soft last:border-b-0">
                    <div className="grid items-center gap-x-3 px-5 py-2.5" style={{ gridTemplateColumns: COLS }}>
                      <span role="cell">
                        <input
                          type="checkbox"
                          className="size-4 accent-ink"
                          aria-label={`Select ${i.person.name}`}
                          checked={selected.has(i.timesheetId)}
                          onChange={(e) => toggle(i.timesheetId, e.target.checked)}
                        />
                      </span>
                      <span role="cell" className="min-w-0">
                      <Link
                        href={`/app/time/approvals/${i.timesheetId}`}
                        className="flex items-center gap-2.5 text-ink no-underline hover:underline"
                      >
                        <Avatar name={i.person.name} initials={i.person.initials} src={i.person.avatarUrl} size="sm" />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">{i.person.name}</span>
                          <span className="truncate text-xs text-muted">
                            {[i.person.title, `Target ${formatHours(i.person.capacity)} h`].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                      </Link>
                      </span>
                      <span role="cell">
                        <DayBars hours={i.days} />
                      </span>
                      <span role="cell" className="num text-right text-sm font-semibold">
                        {formatHours(i.total)}
                      </span>
                      <span role="cell" className="num text-right text-sm">{`${i.billablePct}%`}</span>
                      <span role="cell" className="flex flex-col">
                        <span className="text-sm">{i.step?.label}</span>
                        <span className="text-xs text-muted">{i.step?.note}</span>
                      </span>
                      <span role="cell">
                        <FlagText flag={i.flag} />
                      </span>
                      <span role="cell" className="flex items-center gap-1.5">
                        <Button
                          variant="primary"
                          className="h-[30px] px-3 text-sm"
                          disabled={busy === i.timesheetId}
                          aria-label={`Approve ${i.person.name}`}
                          onClick={() => approveOne(i)}
                        >
                          {busy === i.timesheetId ? "Approving…" : "Approve"}
                        </Button>
                        <Button className="h-[30px] px-2.5 text-sm" aria-label={`Return ${i.person.name}`} onClick={() => setReturning(i)}>
                          Return
                        </Button>
                      </span>
                    </div>
                    {errors[i.timesheetId] && <p className="m-0 px-5 pb-2 text-xs text-red">{errors[i.timesheetId]}</p>}
                  </div>
                ))}
              </div>
            </div>
          </section>
        );
      })}

      {chosen.length > 0 && (
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-sm bg-ink px-5 py-3 text-white">
          <span className="text-sm">{`${chosen.length} selected · ${formatHours(chosen.reduce((a, i) => a + i.total, 0))} h`}</span>
          <Button variant="secondary" className="ml-auto" onClick={() => setConfirm(chosen.map((i) => i.timesheetId))}>
            Approve selected
          </Button>
          <Button variant="ghost" className="text-white hover:bg-ink-2" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {returning && (
        <ReturnDialog
          open
          onOpenChange={(o) => !o && setReturning(null)}
          initials={returning.person.initials}
          onConfirm={async (note) => {
            const r = await returnTimesheet({ timesheetId: returning.timesheetId, note });
            if (!r.ok) return r.error;
            toast(r.message ?? "Returned.");
            router.refresh();
            return null;
          }}
        />
      )}
      <ConfirmApproveDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        count={confirm?.length ?? 0}
        onConfirm={() => approveIds(confirm ?? [])}
      />
    </div>
  );
}
