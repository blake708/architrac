import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { CheckIcon, ChevronRightIcon, LockIcon, WarningIcon } from "@/components/ui/icons";
import { KpiTile } from "@/components/ui/kpi-tile";
import { withFirm } from "@/db/tenant";
import { DUE_CHIP, TIMESHEET_PILL, dueDay, outstandingLine, unbilledNote, utilizationNote, weekOf } from "@/lib/calc/home";
import { OVER_60 } from "@/lib/calc/receivables";
import { cn } from "@/lib/cn";
import { formatHours, formatMoney } from "@/lib/format";
import { dayHeader } from "@/lib/time/display";
import { loadBoard, loadDue, loadFirmHealth, loadOutstanding, loadWaiting, loadYourTime } from "@/server/home/home";
import type { TimeActor } from "@/server/time/write";
import { ProjectBoard } from "./project-board";

// Home widgets (home spec, Layout). Each loads its own data inside its own
// Suspense and error boundary, so they render independently (rule 10).

export async function BoardWidget({ actor, canCreate }: { actor: TimeActor; canCreate: boolean }) {
  const board = await withFirm(actor.firmId, (db) => loadBoard(db, actor));
  return <ProjectBoard board={board} canCreate={canCreate} />;
}

// ---------- Your time ----------

const CHART_PX = 116;
const LABEL_PX = 18;

export async function YourTimeWidget({ actor }: { actor: TimeActor }) {
  const t = await withFirm(actor.firmId, (db) => loadYourTime(db, actor));
  const pill = TIMESHEET_PILL[t.status ?? "draft"];
  const scale = Math.max(10, ...t.bars.map((b) => b.hours));
  const chartLabel = t.bars.map((b) => `${dayHeader(b.date).dow} ${formatHours(b.hours)}`).join(", ");
  return (
    <Card
      title="Your time"
      description={weekOf(t.weekStart)}
      actions={
        <>
          <Badge tone={pill.tone}>{pill.label}</Badge>
          <Link href={`/app/time/week/${t.weekStart}`} className="font-medium">
            Open timesheet
          </Link>
        </>
      }
    >
      {t.banner && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-sm bg-orange-tint px-3 py-2 text-sm text-orange-strong">
          <WarningIcon className="size-4 shrink-0" />
          <span>{t.banner.text}</span>
          <Link href={`/app/time/week/${t.banner.weekStart}`} className="ml-auto font-medium text-orange-strong">
            Open timesheet
          </Link>
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <span className="num text-[26px] font-semibold">{formatHours(t.total)}</span>
        <span className="text-muted">
          {`of ${formatHours(t.capacity)} hours · ${t.billablePct === null ? "—" : `${t.billablePct}%`} billable`}
        </span>
      </div>
      <div
        role="img"
        aria-label={`Hours by day: ${chartLabel}`}
        className="flex items-end gap-2.5 border-b border-line-strong"
        style={{ height: CHART_PX }}
      >
        {t.bars.map((b) => (
          <div key={b.date} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
            <span className="num text-2xs text-ink-2">{formatHours(b.hours)}</span>
            <span
              className={cn("block w-full max-w-9 rounded-t-[2px]", b.hours > 0 ? "bg-blue" : "bg-line")}
              style={{ height: Math.max(2, Math.round((b.hours / scale) * (CHART_PX - LABEL_PX))) }}
            />
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="mt-1.5 flex gap-2.5">
        {t.bars.map((b) => (
          <span key={b.date} className="flex-1 text-center text-2xs text-muted">
            {dayHeader(b.date).dow}
          </span>
        ))}
      </div>
      <p className={cn("m-0 mt-3 text-sm", t.statusLine.returned ? "text-orange-strong" : "text-ink-2")}>{t.statusLine.text}</p>
    </Card>
  );
}

// ---------- Waiting on you ----------

export async function WaitingWidget({ actor }: { actor: TimeActor }) {
  const w = await withFirm(actor.firmId, (db) => loadWaiting(db, actor));
  if (!w) return null;
  const more = w.count - w.items.length;
  return (
    <Card
      title="Waiting on you"
      description={<span className="num">{w.count}</span>}
      actions={
        <Link href="/app/time/approvals" className="font-medium">
          Open approvals
        </Link>
      }
      padded={false}
    >
      {w.items.length === 0 ? (
        <p className="m-0 flex items-center gap-2 px-[var(--spacing-card)] pb-[var(--spacing-card)] text-sm">
          <CheckIcon className="size-4 text-green" />
          No timesheets to approve.
        </p>
      ) : (
        <ul className="m-0 list-none border-t border-line-soft p-0">
          {w.items.map((i) => (
            <li key={i.timesheetId} className="border-b border-line-soft last:border-b-0">
              <Link
                href={`/app/time/approvals/${i.timesheetId}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-[var(--spacing-card)] py-2.5 text-ink no-underline hover:bg-surface-2"
              >
                <Avatar name={i.person.name} initials={i.person.initials} src={i.person.avatarUrl} size="sm" />
                <span className="flex min-w-[140px] flex-1 flex-col">
                  <span className="font-medium">{i.person.name}</span>
                  <span className="text-xs text-muted">{weekOf(i.weekStart)}</span>
                </span>
                <span className="num w-14 text-right text-sm">{`${formatHours(i.total)} h`}</span>
                <span className="num w-20 text-right text-xs text-muted">{`${i.billablePct}% billable`}</span>
                <span className="flex min-w-[150px] flex-col items-start gap-1 text-xs text-ink-2">
                  {i.step?.label}
                  {i.partlyApproved && <Badge tone="blue">Partly approved</Badge>}
                </span>
                <ChevronRightIcon className="size-4 text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {more > 0 && (
        <p className="num m-0 border-t border-line-soft px-[var(--spacing-card)] py-2 text-xs text-muted">{`+${more} more`}</p>
      )}
    </Card>
  );
}

// ---------- Invoices outstanding ----------

export async function OutstandingWidget({ actor }: { actor: TimeActor }) {
  const o = await withFirm(actor.firmId, (db) => loadOutstanding(db, actor));
  if (!o) return null;
  return (
    <Card
      title="Invoices outstanding"
      actions={
        <Link href="/app/invoices" className="font-medium">
          All invoices
        </Link>
      }
    >
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <span className="num text-[26px] font-semibold">{formatMoney(o.totalCents)}</span>
        <span className="text-muted">{o.count === 0 ? "No open invoices." : outstandingLine(o)}</span>
      </div>
      {o.count > 0 && (
        <>
          <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(88px,1fr))] gap-px overflow-hidden rounded-sm border border-line bg-line">
            {o.buckets.map((b) => (
              <div key={b.key} className="bg-surface px-3 py-2">
                <dt className="cap text-2xs text-muted">{b.label}</dt>
                <dd className={cn("num m-0 mt-0.5 text-sm", OVER_60.includes(b.key) && b.cents > 0 && "text-red")}>
                  {formatMoney(b.cents)}
                </dd>
              </div>
            ))}
          </dl>
          <ul className="m-0 mt-3 list-none p-0">
            {o.rows.map((r) => (
              <li key={r.id} className="border-b border-line-soft last:border-b-0">
                <Link
                  href={`/app/invoices/${r.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-ink no-underline hover:bg-surface-2"
                >
                  <span className="num w-20 text-sm">{r.number ?? "—"}</span>
                  <span className="flex min-w-[160px] flex-1 flex-col">
                    <span className="font-medium">{r.projectName}</span>
                    <span className="text-xs text-muted">{r.clientName}</span>
                  </span>
                  <span
                    className={cn(
                      "flex items-center gap-1 text-xs",
                      r.daysPastDue > 0 ? "text-red" : "text-muted",
                    )}
                  >
                    {r.daysPastDue > 0 && <WarningIcon className="size-3.5" />}
                    {r.flag}
                  </span>
                  <span className="num w-24 text-right text-sm">{formatMoney(r.balanceCents)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

// ---------- Firm health ----------

const tileLink = "block text-ink no-underline hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue";

function FirmHealthFrame({ children }: { children: ReactNode }) {
  return (
    <section aria-labelledby="firm-health-title" className="border-t border-line-soft">
      <div className="flex items-center gap-2.5 px-4 pt-3 md:px-page-x">
        <h2 id="firm-health-title" className="m-0 text-2xs font-semibold text-ink-2">
          Firm health
        </h2>
        <span className="inline-flex items-center gap-1 text-xs text-muted">
          <LockIcon className="size-3" />
          Owners and admins only
        </span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">{children}</div>
    </section>
  );
}

export async function FirmHealthWidget({ actor }: { actor: TimeActor }) {
  const h = await withFirm(actor.firmId, (db) => loadFirmHealth(db, actor));
  if (!h) return null;
  const u = h.utilization;
  return (
    <FirmHealthFrame>
      <Link href="/app/invoices" className={tileLink}>
        <KpiTile variant="header" label="Receivables" value={formatMoney(h.receivables.totalCents)} note={outstandingLine(h.receivables)} />
      </Link>
      <Link href="/app/invoices" className={tileLink}>
        <KpiTile variant="header" label="Unbilled work" value={formatMoney(h.unbilled.cents)} note={unbilledNote(h.unbilled.projects)} />
      </Link>
      <Link href="/app/team" className={tileLink}>
        <KpiTile
          variant="header"
          label="Utilization"
          value={u.pct === null ? "—" : `${u.pct}%`}
          tone={u.pct !== null && u.targetPct !== null && u.pct < u.targetPct ? "orange" : "default"}
          note={utilizationNote(u.targetPct)}
        />
      </Link>
      <Link href={`/app/time/approvals/week/${h.notSubmitted.weekStart}`} className={tileLink}>
        <KpiTile
          variant="header"
          label="Not submitted"
          value={String(h.notSubmitted.count)}
          tone={h.notSubmitted.count > 0 ? "orange" : "default"}
          note={`Timesheets · ${weekOf(h.notSubmitted.weekStart)}`}
        />
      </Link>
    </FirmHealthFrame>
  );
}

export function FirmHealthSkeleton() {
  return (
    <div role="status" aria-label="Loading firm health…">
      <FirmHealthFrame>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2 px-4 pt-5 pb-[22px] md:px-page-x">
            <div className={cn(block, "h-3 w-24")} />
            <div className={cn(block, "h-7 w-32")} />
            <div className={cn(block, "h-3 w-40")} />
          </div>
        ))}
      </FirmHealthFrame>
    </div>
  );
}

// ---------- Due this week ----------

export async function DueWidget({ actor }: { actor: TimeActor }) {
  const d = await withFirm(actor.firmId, (db) => loadDue(db, actor));
  return (
    <Card title="Due this week" description={weekOf(d.weekStart)} padded={false}>
      {d.items.length === 0 ? (
        <p className="m-0 flex items-center gap-2 px-[var(--spacing-card)] pb-[var(--spacing-card)] text-sm">
          <CheckIcon className="size-4 text-green" />
          Nothing due this week.
        </p>
      ) : (
        <ul className="m-0 list-none border-t border-line-soft p-0">
          {d.items.map((i) => {
            const day = dueDay(i.date, d.weekStart);
            const chip = DUE_CHIP[i.kind];
            return (
              <li key={i.key} className="border-b border-line-soft last:border-b-0">
                <Link
                  href={i.href}
                  className="flex items-center gap-3.5 px-[var(--spacing-card)] py-3 text-ink no-underline hover:bg-surface-2"
                >
                  <span className="flex w-10 shrink-0 flex-col items-center leading-[1.1]">
                    <span className="cap text-2xs font-semibold text-muted">{day.top}</span>
                    <span className="num text-[19px] font-semibold">{day.day}</span>
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone={chip.tone}>{chip.label}</Badge>
                      <span className="font-medium">{i.title}</span>
                    </span>
                    <span className="truncate text-xs text-muted">{i.detail}</span>
                  </span>
                  {i.flag && (
                    <span className="flex items-center gap-1 text-xs font-semibold whitespace-nowrap text-red">
                      <WarningIcon className="size-3.5" />
                      {i.flag}
                    </span>
                  )}
                  <ChevronRightIcon className="size-4 shrink-0 text-muted" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {d.more > 0 && (
        <p className="num m-0 border-t border-line-soft px-[var(--spacing-card)] py-2 text-xs text-muted">{`+${d.more} more`}</p>
      )}
    </Card>
  );
}

// ---------- Loading (States) ----------

const block = "animate-pulse rounded-sm bg-track";

export function BoardSkeleton() {
  return (
    <div role="status" aria-label="Loading projects…" className="flex flex-col gap-3">
      <div className={cn(block, "h-5 w-32")} />
      <div className="grid auto-cols-[minmax(176px,1fr)] grid-flow-col gap-2.5 overflow-hidden">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex min-h-[150px] flex-col gap-2 rounded-sm bg-line-soft p-2">
            <div className={cn(block, "h-3 w-20")} />
            <div className={cn(block, "h-16 bg-line")} />
            <div className={cn(block, "h-16 bg-line")} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function CardSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={`Loading ${label}…`} className="flex flex-col gap-3 rounded-sm border border-line bg-surface p-[var(--spacing-card)]">
      <div className={cn(block, "h-4 w-36")} />
      <div className={cn(block, "h-8 w-48")} />
      <div className={cn(block, "h-24")} />
    </div>
  );
}
