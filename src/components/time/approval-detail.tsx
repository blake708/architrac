"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { rowTotal } from "@/lib/calc/timesheet";
import { cn } from "@/lib/cn";
import { formatHours } from "@/lib/format";
import { dayHeader } from "@/lib/time/display";
import { approveStep, reopenTimesheet, returnTimesheet } from "@/server/time/approval-actions";
import type { ApprovalDetail } from "@/server/time/approval-read";
import type { ViewRow } from "@/server/time/week";
import { ReviewStrip } from "./approval-bits";
import { ApproveForDialog, ReturnDialog } from "./approval-dialogs";

// Time → Approvals → one timesheet (timesheet-approval spec, Layout 5).
// Read-only grid; Approve / Approve for … / Return / Reopen as allowed.

function rowName(r: ViewRow) {
  const head =
    r.rowType === "project"
      ? `${r.projectNumber ?? ""} ${r.projectName ?? "Project"}`.trim()
      : r.rowType === "overhead"
        ? "Overhead"
        : (r.categoryName ?? "Leave");
  const sub = [r.rowType === "project" ? r.phaseName : r.categoryName, r.activityName].filter(Boolean).join(" · ");
  return { head, sub };
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-4">
      <path d={dir === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
    </svg>
  );
}

export function ApprovalDetailView({ detail: d }: { detail: ApprovalDetail }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"return" | "reopen" | "for" | null>(null);
  const showRates = !!d.rates;
  const go = (id: string | null) => (id ? `/app/time/approvals/${id}` : "/app/time/approvals");

  async function approve() {
    setBusy(true);
    setError(null);
    const r = await approveStep({ timesheetId: d.timesheetId });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      toast(r.error, "error");
      router.refresh();
      return;
    }
    toast(r.message ?? "Approved.");
    router.push(go(d.nextId));
    router.refresh();
  }

  const iconLink = cn(buttonClasses("secondary"), "w-[var(--height-control)] px-0");
  const actions = (
    <>
      {d.prevId ? (
        <Link href={go(d.prevId)} aria-label="Previous in queue" className={iconLink}>
          <Chevron dir="left" />
        </Link>
      ) : (
        <button type="button" disabled aria-label="Previous in queue" className={iconLink}>
          <Chevron dir="left" />
        </button>
      )}
      {d.nextId ? (
        <Link href={go(d.nextId)} aria-label="Next in queue" className={iconLink}>
          <Chevron dir="right" />
        </Link>
      ) : (
        <button type="button" disabled aria-label="Next in queue" className={iconLink}>
          <Chevron dir="right" />
        </button>
      )}
      {d.canReturn && <Button onClick={() => setDialog("return")}>Return</Button>}
      {d.canReopen && <Button onClick={() => setDialog("reopen")}>Reopen</Button>}
      {d.approveFor && <Button onClick={() => setDialog("for")}>{`Approve for ${d.approveFor.replace(" and ", ", ")}`}</Button>}
      {d.canApprove && (
        <Button variant="primary" onClick={approve} disabled={busy}>
          {busy ? "Approving…" : "Approve"}
        </Button>
      )}
    </>
  );

  return (
    <main>
      <PageHeader eyebrow={<span className="uppercase">{d.meta}</span>} title={d.person.name} actions={actions} />
      <div className="flex flex-col gap-4 px-4 pt-5 pb-8 md:px-page-x">
        <Link href="/app/time/approvals" className="text-sm text-ink-3">
          ← Approvals
        </Link>
        {error && <p className="m-0 text-sm text-red">{error}</p>}
        {d.status === "approved" && <p className="m-0 text-sm text-green">Approved. Rates are locked.</p>}
        {d.status === "rejected" && d.rejectionNote && (
          <p className="m-0 text-sm text-orange-strong">{`Returned: "${d.rejectionNote}"`}</p>
        )}
        {d.chips.length > 0 && <ReviewStrip chips={d.chips} />}

        <Card padded={false} title="Timesheet">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead className="bg-surface-2">
                <tr>
                  <th scope="col" className="cap border-b border-line px-4 py-2 text-left text-2xs font-medium text-muted">
                    Row
                  </th>
                  {d.dates.map((date) => {
                    const h = dayHeader(date);
                    return (
                      <th key={date} scope="col" className="cap border-b border-line px-2 py-2 text-right text-2xs font-medium text-muted">
                        {h.dow} <span className="font-normal">{h.date}</span>
                      </th>
                    );
                  })}
                  <th scope="col" className="cap border-b border-line px-2 py-2 text-right text-2xs font-medium text-muted">
                    Total
                  </th>
                  {showRates && (
                    <>
                      <th scope="col" className="cap w-[90px] border-b border-line px-2 py-2 text-right text-2xs font-medium text-muted">
                        Bill rate
                      </th>
                      <th scope="col" className="cap w-[90px] border-b border-line px-4 py-2 text-right text-2xs font-medium text-muted">
                        Cost rate
                      </th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => {
                  const n = rowName(r);
                  const notes = r.notes.flatMap((t, i) => (t ? [{ day: dayHeader(d.dates[i]).dow, t }] : []));
                  const rate = d.rates?.[r.id];
                  return (
                    <tr key={r.id} className="border-b border-line-soft align-top">
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{n.head}</div>
                        {n.sub && <div className="text-xs text-muted">{n.sub}</div>}
                        {!r.billable && <div className="text-xs text-muted">Non-billable</div>}
                        {notes.length > 0 && (
                          <ul className="m-0 mt-1.5 list-none p-0 text-xs text-ink-2">
                            {notes.map((x) => (
                              <li key={x.day}>{`${x.day}: ${x.t}`}</li>
                            ))}
                          </ul>
                        )}
                      </td>
                      {r.hours.map((h, i) => (
                        <td key={i} className={cn("num px-2 py-2.5 text-right", h ? "" : "text-faint")}>
                          {h ? formatHours(h) : "–"}
                        </td>
                      ))}
                      <td className="num px-2 py-2.5 text-right font-semibold">{formatHours(rowTotal(r))}</td>
                      {rate && (
                        <>
                          <td className={cn("num px-2 py-2.5 text-right", rate.missing && "text-red")}>
                            {rate.missing ? "No rate" : rate.bill}
                          </td>
                          <td className={cn("num px-4 py-2.5 text-right", rate.missing && "text-red")}>
                            {rate.missing ? "No rate" : rate.cost}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Summary">
          <div className="flex flex-col gap-4">
            <p className="num m-0 text-sm">
              {`${formatHours(d.total)} h · ${formatHours(d.billable)} billable · ${d.billablePct}% billable`}
            </p>
            <div
              role="img"
              aria-label={`${d.billablePct}% billable`}
              className="relative h-2 overflow-hidden rounded-[1px] bg-line-soft"
            >
              <span className="absolute inset-y-0 left-0 bg-blue" style={{ width: `${d.billablePct}%` }} />
            </div>
            <div>
              <h3 className="cap m-0 mb-1.5 text-2xs font-semibold text-ink-2">Flags</h3>
              {d.flags.length ? (
                <ul className="m-0 list-none p-0 text-sm">
                  {d.flags.map((f) => (
                    <li key={f.kind} className={f.tone === "red" ? "text-red" : "text-orange-strong"}>
                      {f.label}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="m-0 text-sm text-muted">No flags</p>
              )}
            </div>
            <div>
              <h3 className="cap m-0 mb-1.5 text-2xs font-semibold text-ink-2">History</h3>
              <ul className="m-0 list-none p-0 text-sm" data-testid="approval-history">
                {d.history.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      </div>

      <ReturnDialog
        open={dialog === "return" || dialog === "reopen"}
        reopen={dialog === "reopen"}
        onOpenChange={(o) => !o && setDialog(null)}
        initials={d.person.initials}
        onConfirm={async (note) => {
          const r = dialog === "reopen"
            ? await reopenTimesheet({ timesheetId: d.timesheetId, note })
            : await returnTimesheet({ timesheetId: d.timesheetId, note });
          if (!r.ok) return r.error;
          toast(r.message ?? "Returned.");
          router.push("/app/time/approvals");
          router.refresh();
          return null;
        }}
      />
      {d.approveFor && (
        <ApproveForDialog
          open={dialog === "for"}
          onOpenChange={(o) => !o && setDialog(null)}
          names={d.approveFor}
          onConfirm={async (note) => {
            const r = await approveStep({ timesheetId: d.timesheetId, onBehalf: true, note: note || undefined });
            if (!r.ok) return r.error;
            toast(r.message ?? "Approved.");
            router.refresh();
            return null;
          }}
        />
      )}
    </main>
  );
}
