"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { ProgressBar } from "@/components/ui/progress-bar";
import {
  Table,
  TableBody,
  TableCell,
  TableFoot,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPercentBp, nteStanding } from "@/lib/calc/invoice";
import { feeTotals, nteTotals } from "@/lib/calc/invoice-sections";
import { hoursText, money } from "@/lib/calc/invoice-plan";
import { formatDate } from "@/lib/format";
import { parseMoney, parsePercent } from "@/lib/invoices/builder";
import {
  removeLine,
  saveAdjustment,
  setConsultantPercent,
  setPhasePercent,
  toggleEntry,
} from "@/server/invoices/actions";
import type { BuilderView } from "@/server/invoices/view";
import type { useBuilder } from "./use-builder";

// The builder's sections (invoicing spec Layout C.4–C.7), grouped like the
// PDF (rule 17): Fee, Not-to-exceed and Hourly for the base contract, the
// same for additional services, then Consultants. Adjustments sit with the
// totals (AdjustmentsPanel).

type Builder = ReturnType<typeof useBuilder>;
type Props = { b: Builder };
/** additional: the additional-services copy of a section (rule 17). */
type GroupProps = Props & { additional: boolean; title: string };

export function Section({
  title,
  children,
  aside,
}: {
  title: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  const id = `sec-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <section
      aria-labelledby={id}
      className="rounded-sm border border-line bg-surface"
    >
      <div className="flex flex-wrap items-center gap-3 px-[18px] pt-4 pb-3">
        <h2 id={id} className="m-0 flex-1 text-sm font-semibold">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

const pctInputCls =
  "h-8 w-[84px] rounded-sm border border-line-input bg-surface px-2 text-right font-mono text-[12.5px] aria-[invalid=true]:border-red disabled:bg-surface-2";

/**
 * A "% complete" box: shows the saved %, saves on Enter or leaving it.
 * Shared by fixed-fee phases and consultants.
 */
function usePercentInputs(
  b: Builder,
  save: (id: string, bp: number) => Promise<boolean>,
) {
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [local, setLocal] = useState<Record<string, string>>({});
  const clear = (id: string) =>
    setTyped((t) =>
      Object.fromEntries(Object.entries(t).filter(([k]) => k !== id)),
    );

  function commit(id: string, current: number) {
    const text = typed[id];
    if (text === undefined) return;
    const bp = parsePercent(text);
    if (bp === null)
      return setLocal((l) => ({
        ...l,
        [id]: "Enter a % from 0 to 100, up to 2 decimals.",
      }));
    setLocal((l) => ({ ...l, [id]: "" }));
    if (bp === current) return clear(id);
    void save(id, bp).then((done) => done && clear(id));
  }

  return (
    id: string,
    name: string,
    current: number,
    serverError: string | null,
  ) => {
    const err =
      local[id] || b.fieldErrors[`${id}:percentCompleteBp`] || serverError;
    return {
      err,
      input: (
        <input
          aria-label={`% complete for ${name}`}
          inputMode="decimal"
          disabled={!b.view.can.edit}
          value={typed[id] ?? String(current / 100)}
          onChange={(e) => setTyped((t) => ({ ...t, [id]: e.target.value }))}
          onBlur={() => commit(id, current)}
          onKeyDown={(e) =>
            e.key === "Enter" && (e.target as HTMLInputElement).blur()
          }
          aria-invalid={err ? true : undefined}
          className={pctInputCls}
        />
      ),
    };
  };
}

/**
 * C.4 Fixed-fee phases: type % complete; saved on the phase and the line.
 * WIP (time this period at bill rates) and hours against budget help pick
 * the % (Blake, 2026-11-11).
 */
export function FixedSection({ b, additional, title }: GroupProps) {
  const { view, run } = b;
  const pct = usePercentInputs(b, (phaseId, bp) =>
    run(setPhasePercent, { phaseId, percentCompleteBp: bp }, phaseId),
  );
  const rows = view.fixed.filter((f) => f.additional === additional);
  if (!rows.length) return null;

  const total = feeTotals(
    rows.map((f) => ({
      name: f.name,
      feeCents: f.feeCents,
      percentCompleteBp: f.percentCompleteBp,
      earnedCents: f.earnedToDateCents,
      previousCents: f.previouslyBilledCents,
      thisCents: f.thisInvoiceCents,
    })),
  );
  const wipTotal = rows.reduce((n, f) => n + f.wipCents, 0);
  return (
    <Section title={title}>
      <Table aria-label={title}>
        <TableHead>
          <TableRow>
            <TableHeader>Phase</TableHeader>
            <TableHeader numeric>Fee</TableHeader>
            <TableHeader
              numeric
              title="Time on the phase this period, at bill rates"
            >
              WIP
            </TableHeader>
            <TableHeader
              numeric
              title="Hours used to date against the phase budget"
            >
              Hours
            </TableHeader>
            <TableHeader numeric>Last billed</TableHeader>
            <TableHeader numeric>% complete</TableHeader>
            <TableHeader numeric>Earned to date</TableHeader>
            <TableHeader numeric>Previously billed</TableHeader>
            <TableHeader numeric>This invoice</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((f) => {
            const { err, input } = pct(
              f.phaseId,
              f.name,
              f.percentCompleteBp,
              f.error,
            );
            return (
              <TableRow key={f.phaseId} data-phase={f.name}>
                <TableCell>
                  {f.name}
                  {err && <div className="mt-1 text-xs text-red">{err}</div>}
                </TableCell>
                <TableCell numeric>{money(f.feeCents)}</TableCell>
                <TableCell numeric data-col="wip">
                  {f.wipCents ? money(f.wipCents) : "—"}
                  {f.wipHundredths > 0 && (
                    <div className="text-2xs text-muted">
                      {hoursText(f.wipHundredths)} h
                    </div>
                  )}
                </TableCell>
                <TableCell numeric data-col="hours">
                  {hoursText(f.usedHundredths)} / {Number(f.budgetHours)} h
                  {f.suggestBp !== null && (
                    <div className="text-2xs text-muted">
                      suggests {formatPercentBp(f.suggestBp)}
                    </div>
                  )}
                </TableCell>
                <TableCell numeric>{formatPercentBp(f.lastBilledBp)}</TableCell>
                <TableCell numeric>{input}</TableCell>
                <TableCell numeric>{money(f.earnedToDateCents)}</TableCell>
                <TableCell numeric>{money(f.previouslyBilledCents)}</TableCell>
                <TableCell numeric className="font-semibold">
                  {f.thisInvoiceCents ? money(f.thisInvoiceCents) : "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
        <TableFoot>
          <TableRow>
            <TableCell>Total</TableCell>
            <TableCell numeric>{money(total.feeCents)}</TableCell>
            <TableCell numeric>{wipTotal ? money(wipTotal) : "—"}</TableCell>
            <TableCell colSpan={2} />
            <TableCell numeric data-col="overall-pct">
              {formatPercentBp(total.percentCompleteBp)}
            </TableCell>
            <TableCell numeric>{money(total.earnedCents)}</TableCell>
            <TableCell numeric>{money(total.previousCents)}</TableCell>
            <TableCell numeric className="font-semibold">
              {money(total.thisCents)}
            </TableCell>
          </TableRow>
        </TableFoot>
      </Table>
      <p className="m-0 px-[18px] py-2.5 text-xs text-muted">
        WIP is time on the phase{" "}
        {view.settings.wipFrom
          ? `from ${formatDate(view.settings.wipFrom)} (after the last invoice)`
          : "to date (no invoice sent yet)"}{" "}
        through {formatDate(view.settings.periodEnd)}, at bill rates, including
        time not yet approved. Hours are all time on the phase through the same
        date, against the phase budget.
      </p>
    </Section>
  );
}

/** C.5 Not-to-exceed phases: limit, billed and remaining, with role lines and time entries. */
export function NteSection({ b, additional, title }: GroupProps) {
  const rows = b.view.hourly.filter((h) => h.feeType === "nte" && h.additional === additional);
  if (!rows.length) return null;
  const total = nteTotals(
    rows.map((h) => ({
      name: h.name,
      limitCents: h.feeCents,
      previousCents: h.previouslyBilledCents,
      thisCents: h.netCents,
      ...nteStanding({ capCents: h.feeCents, previouslyBilledCents: h.previouslyBilledCents, thisInvoiceCents: h.netCents }),
      lines: [],
    })),
  );
  return (
    <Section title={title}>
      <div className="flex flex-col">
        {rows.map((h) => (
          <HourlyPhase key={h.phaseId} b={b} h={h} />
        ))}
      </div>
      <dl
        aria-label={`${title} total`}
        className="m-0 grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-3 border-t border-line px-[18px] py-3 text-sm font-semibold"
      >
        <NteFigure label="Total limit" cents={total.limitCents} />
        <NteFigure label="Previously billed" cents={total.previousCents} />
        <NteFigure label="This invoice" cents={total.thisCents} />
        <NteFigure label="Billed to date" cents={total.billedToDateCents} />
        <NteFigure label="Remaining" cents={total.remainingCents} />
      </dl>
    </Section>
  );
}

/** C.5 Hourly phases: role lines and time entries to tick. */
export function HourlySection({ b, additional, title }: GroupProps) {
  const rows = b.view.hourly.filter((h) => h.feeType === "hourly" && h.additional === additional);
  if (!rows.length) return null;
  return (
    <Section title={title}>
      <div className="flex flex-col">
        {rows.map((h) => (
          <HourlyPhase key={h.phaseId} b={b} h={h} />
        ))}
      </div>
      <div className="flex justify-between border-t border-line px-[18px] py-3 text-sm font-semibold">
        <span>Total</span>
        <span className="num">{money(rows.reduce((n, h) => n + h.netCents, 0))}</span>
      </div>
    </Section>
  );
}

function NteFigure({ label, cents }: { label: string; cents: number }) {
  return (
    <div>
      <dt className="cap text-2xs font-semibold text-muted">{label}</dt>
      <dd className="num m-0 mt-0.5">{money(cents)}</dd>
    </div>
  );
}

/** One NTE phase's standing: limit, billed before, billed to date, remaining. */
function NteStanding({ h }: { h: BuilderView["hourly"][number] }) {
  const st = nteStanding({ capCents: h.feeCents, previouslyBilledCents: h.previouslyBilledCents, thisInvoiceCents: h.netCents });
  const item = (label: string, cents: number) => (
    <span>
      {label} <span className="num text-ink">{money(cents)}</span>
    </span>
  );
  return (
    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" data-nte-standing>
      {item("Limit", h.feeCents)}
      {item("Previously billed", h.previouslyBilledCents)}
      {item("Billed to date", st.billedToDateCents)}
      {item("Remaining", st.remainingCents)}
    </div>
  );
}

function HourlyPhase({ b, h }: Props & { h: BuilderView["hourly"][number] }) {
  const { view, run } = b;
  const [open, setOpen] = useState(false);
  /** Ticks shown straight away while their save runs; the server's answer replaces them. */
  const [ticking, setTicking] = useState<Record<string, boolean>>({});
  function toggle(entryId: string, include: boolean) {
    setTicking((t) => ({ ...t, [entryId]: include }));
    void run(toggleEntry, { entryId, include }).finally(() =>
      setTicking((t) => Object.fromEntries(Object.entries(t).filter(([k]) => k !== entryId))),
    );
  }
  return (
    <div
      className="border-t border-line-soft px-[18px] py-3.5"
      data-phase={h.name}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{h.name}</div>
          {h.feeType === "nte" && <NteStanding h={h} />}
        </div>
        {h.feeType === "nte" && h.feeCents > 0 && (
          <ProgressBar
            className="w-[200px]"
            value={h.previouslyBilledCents + h.netCents}
            max={h.feeCents}
            label={`${h.name} limit used`}
            showPercent
          />
        )}
        <div className="num w-[110px] text-right font-semibold">
          {money(h.netCents)}
        </div>
      </div>
      {h.groups.length === 0 ? (
        <p className="m-0 mt-2 text-sm text-muted">
          No approved time to bill through {formatDate(view.settings.periodEnd)}
          .
        </p>
      ) : (
        <Table aria-label={`${h.name} lines`} wrapperClassName="mt-2">
          <TableHead>
            <TableRow>
              <TableHeader>Role</TableHeader>
              <TableHeader numeric>Hours</TableHeader>
              <TableHeader numeric>Rate</TableHeader>
              <TableHeader numeric>Amount</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {h.groups.map((g) => (
              <TableRow key={`${g.roleName}-${g.rateCents}`}>
                <TableCell>{g.roleName}</TableCell>
                <TableCell numeric>{hoursText(g.hoursHundredths)} h</TableCell>
                <TableCell numeric>{money(g.rateCents)}/h</TableCell>
                <TableCell numeric>{money(g.amountCents)}</TableCell>
              </TableRow>
            ))}
            {h.writeDownCents > 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-red">
                  Not-to-exceed limit reached: written down
                </TableCell>
                <TableCell numeric className="text-red">
                  −{money(h.writeDownCents)}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
      {h.entries.length > 0 && (
        <div className="mt-2">
          <Button onClick={() => setOpen(true)}>
            Show time entries ({h.entries.length})
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent
              className="max-w-[920px]"
              title={`${h.name} · time entries`}
              description={
                view.can.edit
                  ? "Untick an entry to leave it off this invoice. It stays off when you recalculate, until you tick it again."
                  : undefined
              }
              footer={
                <>
                  <span className="mr-auto self-center text-sm text-muted">
                    {money(h.netCents)} this invoice
                  </span>
                  <Button variant="primary" onClick={() => setOpen(false)}>
                    Done
                  </Button>
                </>
              }
            >
              <Table aria-label={`${h.name} time entries`}>
                <TableHead>
                  <TableRow>
                    <TableHeader>Bill</TableHeader>
                    <TableHeader>Date</TableHeader>
                    <TableHeader>Person</TableHeader>
                    <TableHeader>Role</TableHeader>
                    <TableHeader numeric>Hours</TableHeader>
                    <TableHeader numeric>Rate</TableHeader>
                    <TableHeader>Note</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {h.entries.map((e) => (
                    <TableRow
                      key={e.id}
                      className={e.included ? undefined : "text-faint"}
                    >
                      <TableCell>
                        <input
                          type="checkbox"
                          aria-label={`Bill ${e.person} ${e.hours} h on ${formatDate(e.workDate)}`}
                          checked={ticking[e.id] ?? e.included}
                          disabled={!view.can.edit}
                          onChange={(ev) => toggle(e.id, ev.target.checked)}
                        />
                      </TableCell>
                      <TableCell className="num text-[12.5px]">
                        {formatDate(e.workDate)}
                      </TableCell>
                      <TableCell>{e.person}</TableCell>
                      <TableCell>{e.roleName}</TableCell>
                      <TableCell numeric>{Number(e.hours)} h</TableCell>
                      <TableCell numeric>{money(e.rateCents)}</TableCell>
                      <TableCell
                        className="max-w-[260px] truncate text-xs text-muted"
                        title={e.note ?? undefined}
                      >
                        {e.note}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </div>
  );
}

/**
 * C.6 Consultants: billed by % complete of their fee plus markup, like a
 * fixed-fee phase (decision #31). When consultant invoices are tracked
 * (vendor bills, Release 2), add a "Billed to us" column here.
 */
export function ConsultantsSection({ b }: Props) {
  const { view, run } = b;
  const pct = usePercentInputs(b, (consultantId, bp) =>
    run(
      setConsultantPercent,
      { consultantId, percentCompleteBp: bp },
      consultantId,
    ),
  );
  if (!view.consultants.length) return null;
  const total = feeTotals(
    view.consultants.map((c) => ({
      name: c.label,
      feeCents: c.clientFeeCents,
      percentCompleteBp: c.percentCompleteBp,
      earnedCents: c.earnedToDateCents,
      previousCents: c.previouslyBilledCents,
      thisCents: c.thisInvoiceCents,
    })),
  );
  return (
    <Section title="Consultants">
      <Table aria-label="Consultants">
        <TableHead>
          <TableRow>
            <TableHeader>Consultant</TableHeader>
            <TableHeader numeric>Their fee</TableHeader>
            <TableHeader numeric>Markup</TableHeader>
            <TableHeader numeric>Fee to client</TableHeader>
            <TableHeader numeric>Last billed</TableHeader>
            <TableHeader numeric>% complete</TableHeader>
            <TableHeader numeric>Earned to date</TableHeader>
            <TableHeader numeric>Previously billed</TableHeader>
            <TableHeader numeric>This invoice</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {view.consultants.map((c) => {
            const { err, input } = pct(
              c.consultantId,
              c.label,
              c.percentCompleteBp,
              c.error,
            );
            return (
              <TableRow key={c.consultantId} data-consultant={c.label}>
                <TableCell>
                  {c.label}
                  {err && <div className="mt-1 text-xs text-red">{err}</div>}
                </TableCell>
                <TableCell numeric>{money(c.feeCents)}</TableCell>
                <TableCell numeric>{formatPercentBp(c.markupBp)}</TableCell>
                <TableCell numeric>{money(c.clientFeeCents)}</TableCell>
                <TableCell numeric>{formatPercentBp(c.lastBilledBp)}</TableCell>
                <TableCell numeric>{input}</TableCell>
                <TableCell numeric>{money(c.earnedToDateCents)}</TableCell>
                <TableCell numeric>{money(c.previouslyBilledCents)}</TableCell>
                <TableCell numeric className="font-semibold">
                  {c.thisInvoiceCents ? money(c.thisInvoiceCents) : "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
        <TableFoot>
          <TableRow>
            <TableCell colSpan={3}>Total</TableCell>
            <TableCell numeric>{money(total.feeCents)}</TableCell>
            <TableCell />
            <TableCell numeric data-col="overall-pct">
              {formatPercentBp(total.percentCompleteBp)}
            </TableCell>
            <TableCell numeric>{money(total.earnedCents)}</TableCell>
            <TableCell numeric>{money(total.previousCents)}</TableCell>
            <TableCell numeric className="font-semibold">
              {money(total.thisCents)}
            </TableCell>
          </TableRow>
        </TableFoot>
      </Table>
    </Section>
  );
}

/**
 * C.7 Adjustments, in the totals panel like the PDF: Subtotal, then each
 * adjustment (free lines, may be negative: a retainer credit, decision
 * #12), then the total below. No adjustments → no subtotal. They're added,
 * edited and removed in a dialog opened from here.
 */
export function AdjustmentLines({ b }: Props) {
  const { view } = b;
  const [open, setOpen] = useState(false);
  const row = "flex justify-between gap-3 py-1.5";
  return (
    <div aria-label="Adjustments" role="group">
      {view.adjustments.length > 0 && (
        <>
          <div className={row}>
            <span className="text-muted">Subtotal</span>
            <span className="num" data-testid="invoice-subtotal">
              {money(view.totals.servicesSubtotalCents)}
            </span>
          </div>
          <ul className="m-0 list-none p-0">
            {view.adjustments.map((a) => (
              <li key={a.id} className={row} data-adjustment>
                <span className="min-w-0">{a.description}</span>
                <span className={a.amountCents < 0 ? "num text-red" : "num"}>
                  {signedMoney(a.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {view.can.edit && (
        <>
          <div className="pt-1 pb-2">
            <Button onClick={() => setOpen(true)}>
              {view.adjustments.length > 0 ? "Edit adjustments" : "Add adjustment"}
            </Button>
          </div>
          <AdjustmentsDialog b={b} open={open} onOpenChange={setOpen} />
        </>
      )}
    </div>
  );
}

const signedMoney = (cents: number) =>
  cents < 0 ? `−${money(-cents)}` : money(cents);

type AdjustmentForm = { lineId?: string; description: string; amount: string };
const BLANK: AdjustmentForm = { description: "", amount: "" };

/** Every adjustment with Edit / Remove, and a form to add or change one. */
function AdjustmentsDialog({
  b,
  open,
  onOpenChange,
}: Props & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { view, run, fieldErrors } = b;
  const [form, setForm] = useState<AdjustmentForm>(BLANK);
  const [local, setLocal] = useState<string | null>(null);

  function close(next: boolean) {
    if (!next) {
      setForm(BLANK);
      setLocal(null);
    }
    onOpenChange(next);
  }

  async function save() {
    const cents = parseMoney(form.amount);
    if (cents === null || cents === 0)
      return setLocal(
        "Enter an amount other than $0. Use a minus sign for a credit.",
      );
    setLocal(null);
    const done = await run(saveAdjustment, {
      lineId: form.lineId,
      description: form.description,
      amountCents: cents,
    });
    if (done) setForm(BLANK);
  }

  const editing = form.lineId !== undefined;
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="max-w-[560px]"
        title="Adjustments"
        description="Lines added after the subtotal, like a retainer credit. Use a minus sign for a credit."
        footer={
          <>
            <span className="mr-auto self-center text-sm text-muted">
              Total this invoice{" "}
              <span className="num font-semibold text-ink">
                {money(view.totals.totalCents)}
              </span>
            </span>
            <Button variant="primary" onClick={() => close(false)}>
              Done
            </Button>
          </>
        }
      >
        {view.adjustments.length > 0 && (
          <ul className="m-0 mb-4 list-none rounded-sm border border-line p-0">
            {view.adjustments.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center gap-3 border-b border-line-soft px-3 py-2 last:border-b-0"
              >
                <span className="min-w-0 flex-1">{a.description}</span>
                <span className={a.amountCents < 0 ? "num text-red" : "num"}>
                  {signedMoney(a.amountCents)}
                </span>
                <span className="flex gap-1.5">
                  <Button
                    aria-label={`Edit ${a.description}`}
                    onClick={() => {
                      setLocal(null);
                      setForm({
                        lineId: a.id,
                        description: a.description,
                        amount: (a.amountCents / 100).toFixed(2),
                      });
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    aria-label={`Remove ${a.description}`}
                    onClick={() => {
                      if (form.lineId === a.id) setForm(BLANK);
                      void run(removeLine, { lineId: a.id });
                    }}
                  >
                    Remove
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-col gap-3"
          aria-label={editing ? "Edit adjustment" : "New adjustment"}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="cap text-2xs font-semibold text-muted">
            {editing ? "Edit adjustment" : "New adjustment"}
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
            <Input
              label="Description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              error={fieldErrors.description}
              maxLength={200}
              placeholder="Retainer applied"
            />
            <Input
              label="Amount"
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              error={local ?? fieldErrors.amountCents}
              placeholder="-1,860.00"
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit">{editing ? "Save line" : "Add line"}</Button>
            {editing && (
              <Button variant="ghost" onClick={() => setForm(BLANK)}>
                Cancel edit
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
