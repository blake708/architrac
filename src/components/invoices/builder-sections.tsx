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
import { formatPercentBp } from "@/lib/calc/invoice";
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

// The builder's sections (invoicing spec Layout C.4–C.7).

type Builder = ReturnType<typeof useBuilder>;
type Props = { b: Builder };

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
export function FixedSection({ b }: Props) {
  const { view, run } = b;
  const pct = usePercentInputs(b, (phaseId, bp) =>
    run(setPhasePercent, { phaseId, percentCompleteBp: bp }, phaseId),
  );
  if (!view.fixed.length) return null;

  const total = view.fixed.reduce((n, f) => n + f.thisInvoiceCents, 0);
  const wipTotal = view.fixed.reduce((n, f) => n + f.wipCents, 0);
  return (
    <Section title="Fixed-fee phases">
      <Table aria-label="Fixed-fee phases">
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
          {view.fixed.map((f) => {
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
            <TableCell colSpan={2}>Fixed-fee total</TableCell>
            <TableCell numeric>{wipTotal ? money(wipTotal) : "—"}</TableCell>
            <TableCell colSpan={5} />
            <TableCell numeric className="font-semibold">
              {money(total)}
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
        time not yet approved. Hours are all time to date against the phase
        budget.
      </p>
    </Section>
  );
}

/** C.5 Hourly and not-to-exceed phases: role lines, time entries to tick, cap meter. */
export function HourlySection({ b }: Props) {
  const { view } = b;
  if (!view.hourly.length) return null;
  return (
    <Section title="Hourly & not-to-exceed phases">
      <div className="flex flex-col">
        {view.hourly.map((h) => (
          <HourlyPhase key={h.phaseId} b={b} h={h} />
        ))}
      </div>
    </Section>
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
          <div className="text-xs text-muted">
            {h.feeType === "nte"
              ? `Not to exceed ${money(h.feeCents)} · ${money(h.previouslyBilledCents)} billed before`
              : "Hourly"}
          </div>
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
          <Button variant="ghost" onClick={() => setOpen(true)}>
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
  const total = view.consultants.reduce((n, c) => n + c.thisInvoiceCents, 0);
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
            <TableCell colSpan={8}>Consultants total</TableCell>
            <TableCell numeric className="font-semibold">
              {money(total)}
            </TableCell>
          </TableRow>
        </TableFoot>
      </Table>
    </Section>
  );
}

/** C.7 Adjustments: free lines, may be negative (a retainer credit, decision #12). */
export function AdjustmentsSection({ b }: Props) {
  const { view, run, fieldErrors } = b;
  const [form, setForm] = useState<{
    lineId?: string;
    description: string;
    amount: string;
  } | null>(null);
  const [local, setLocal] = useState<string | null>(null);

  async function save() {
    if (!form) return;
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
    if (done) setForm(null);
  }

  return (
    <Section
      title="Adjustments"
      aside={
        view.can.edit &&
        !form && (
          <Button onClick={() => setForm({ description: "", amount: "" })}>
            Add adjustment
          </Button>
        )
      }
    >
      {view.adjustments.length > 0 && (
        <Table aria-label="Adjustments">
          <TableBody>
            {view.adjustments.map((a) => (
              <TableRow key={a.id}>
                <TableCell>{a.description}</TableCell>
                <TableCell
                  numeric
                  className={a.amountCents < 0 ? "text-red" : undefined}
                >
                  {a.amountCents < 0
                    ? `−${money(-a.amountCents)}`
                    : money(a.amountCents)}
                </TableCell>
                <TableCell className="w-[160px] text-right whitespace-nowrap">
                  {view.can.edit && (
                    <>
                      <Button
                        variant="ghost"
                        onClick={() =>
                          setForm({
                            lineId: a.id,
                            description: a.description,
                            amount: (a.amountCents / 100).toFixed(2),
                          })
                        }
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        aria-label={`Remove ${a.description}`}
                        onClick={() => void run(removeLine, { lineId: a.id })}
                      >
                        Remove
                      </Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {form && (
        <div className="grid grid-cols-[minmax(220px,2fr)_minmax(140px,1fr)_auto] items-start gap-3 border-t border-line-soft px-[18px] py-4 max-md:grid-cols-1">
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
            hint="Use a minus sign for a credit, like -1,860."
          />
          {/* Line the buttons up with the boxes, below the field labels. */}
          <div className="flex gap-2 md:pt-[22px]">
            <Button variant="primary" onClick={() => void save()}>
              {form.lineId ? "Save line" : "Add line"}
            </Button>
            <Button variant="ghost" onClick={() => setForm(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {!view.adjustments.length && !form && (
        <p className="m-0 px-[18px] pb-4 text-sm text-muted">No adjustments.</p>
      )}
    </Section>
  );
}
