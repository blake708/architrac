"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Table, TableBody, TableCell, TableFoot, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { consultantAmount, formatPercentBp } from "@/lib/calc/invoice";
import { hoursText, money } from "@/lib/calc/invoice-plan";
import { formatDate } from "@/lib/format";
import { parseMoney, parsePercent } from "@/lib/invoices/builder";
import {
  removeLine,
  saveAdjustment,
  saveConsultantLine,
  setPhasePercent,
  toggleEntry,
} from "@/server/invoices/actions";
import type { BuilderView } from "@/server/invoices/view";
import type { useBuilder } from "./use-builder";

// The builder's sections (invoicing spec Layout C.4–C.7).

type Builder = ReturnType<typeof useBuilder>;
type Props = { b: Builder };

export function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  const id = `sec-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="rounded-sm border border-line bg-surface">
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

const pctInputCls = "h-8 w-[84px] text-right font-mono text-[12.5px]";

/** C.4 Fixed-fee phases: type % complete; saved on the phase and the line. */
export function FixedSection({ b }: Props) {
  const { view, run, fieldErrors } = b;
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [local, setLocal] = useState<Record<string, string>>({});
  if (!view.fixed.length) return null;

  function commit(phaseId: string, current: number) {
    const text = typed[phaseId];
    if (text === undefined) return;
    const bp = parsePercent(text);
    if (bp === null) return setLocal((l) => ({ ...l, [phaseId]: "Enter a % from 0 to 100, up to 2 decimals." }));
    setLocal((l) => ({ ...l, [phaseId]: "" }));
    const clear = () => setTyped((t) => Object.fromEntries(Object.entries(t).filter(([k]) => k !== phaseId)));
    if (bp === current) return clear();
    void run(setPhasePercent, { phaseId, percentCompleteBp: bp }, phaseId).then((done) => done && clear());
  }

  const total = view.fixed.reduce((n, f) => n + f.thisInvoiceCents, 0);
  return (
    <Section title="Fixed-fee phases">
      <Table aria-label="Fixed-fee phases">
        <TableHead>
          <TableRow>
            <TableHeader>Phase</TableHeader>
            <TableHeader numeric>Fee</TableHeader>
            <TableHeader numeric>Last billed</TableHeader>
            <TableHeader numeric>% complete</TableHeader>
            <TableHeader numeric>Earned to date</TableHeader>
            <TableHeader numeric>Previously billed</TableHeader>
            <TableHeader numeric>This invoice</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {view.fixed.map((f) => {
            const err = local[f.phaseId] || fieldErrors[`${f.phaseId}:percentCompleteBp`] || f.error;
            return (
              <TableRow key={f.phaseId} data-phase={f.name}>
                <TableCell>
                  {f.name}
                  {err && <div className="mt-1 text-xs text-red">{err}</div>}
                </TableCell>
                <TableCell numeric>{money(f.feeCents)}</TableCell>
                <TableCell numeric>{formatPercentBp(f.lastBilledBp)}</TableCell>
                <TableCell numeric>
                  <input
                    aria-label={`% complete for ${f.name}`}
                    inputMode="decimal"
                    disabled={!view.can.edit}
                    value={typed[f.phaseId] ?? String(f.percentCompleteBp / 100)}
                    onChange={(e) => setTyped((t) => ({ ...t, [f.phaseId]: e.target.value }))}
                    onBlur={() => commit(f.phaseId, f.percentCompleteBp)}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    aria-invalid={err ? true : undefined}
                    className={`${pctInputCls} rounded-sm border border-line-input bg-surface px-2 aria-[invalid=true]:border-red disabled:bg-surface-2`}
                  />
                </TableCell>
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
            <TableCell colSpan={6}>Fixed-fee total</TableCell>
            <TableCell numeric className="font-semibold">
              {money(total)}
            </TableCell>
          </TableRow>
        </TableFoot>
      </Table>
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
  return (
    <div className="border-t border-line-soft px-[18px] py-3.5" data-phase={h.name}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{h.name}</div>
          <div className="text-xs text-muted">
            {h.feeType === "nte" ? `Not to exceed ${money(h.feeCents)} · ${money(h.previouslyBilledCents)} billed before` : "Hourly"}
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
        <div className="num w-[110px] text-right font-semibold">{money(h.netCents)}</div>
      </div>
      {h.groups.length === 0 ? (
        <p className="m-0 mt-2 text-sm text-muted">No approved time to bill through {formatDate(view.settings.periodEnd)}.</p>
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
          <Button variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? "Hide time entries" : `Show time entries (${h.entries.length})`}
          </Button>
          {open && (
            <Table aria-label={`${h.name} time entries`} wrapperClassName="mt-1">
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
                  <TableRow key={e.id} className={e.included ? undefined : "text-faint"}>
                    <TableCell>
                      <input
                        type="checkbox"
                        aria-label={`Bill ${e.person} ${e.hours} h on ${formatDate(e.workDate)}`}
                        checked={e.included}
                        disabled={!view.can.edit}
                        onChange={(ev) => void run(toggleEntry, { entryId: e.id, include: ev.target.checked })}
                      />
                    </TableCell>
                    <TableCell className="num text-[12.5px]">{formatDate(e.workDate)}</TableCell>
                    <TableCell>{e.person}</TableCell>
                    <TableCell>{e.roleName}</TableCell>
                    <TableCell numeric>{Number(e.hours)} h</TableCell>
                    <TableCell numeric>{money(e.rateCents)}</TableCell>
                    <TableCell className="max-w-[260px] truncate text-xs text-muted" title={e.note ?? undefined}>
                      {e.note}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </div>
  );
}

/** C.6 Consultants: their bill to us, plus the project's markup. */
export function ConsultantsSection({ b }: Props) {
  const { view, run, fieldErrors } = b;
  const [form, setForm] = useState<{ lineId?: string; consultantId: string; ref: string; cost: string } | null>(null);
  const [local, setLocal] = useState<string | null>(null);
  if (!view.consultantOptions.length && !view.consultantLines.length) return null;

  const markup = view.consultantOptions.find((c) => c.id === form?.consultantId)?.markupBp ?? 0;
  const cost = form ? parseMoney(form.cost) : null;

  async function save() {
    if (!form) return;
    if (cost === null || cost <= 0) return setLocal("Enter what they billed you (over $0).");
    setLocal(null);
    const done = await run(saveConsultantLine, {
      lineId: form.lineId,
      consultantId: form.consultantId,
      vendorInvoiceRef: form.ref,
      costCents: cost,
    });
    if (done) setForm(null);
  }

  return (
    <Section
      title="Consultants"
      aside={
        view.can.edit &&
        !form &&
        view.consultantOptions.length > 0 && (
          <Button onClick={() => setForm({ consultantId: view.consultantOptions[0].id, ref: "", cost: "" })}>Add consultant line</Button>
        )
      }
    >
      {view.consultantLines.length > 0 && (
        <Table aria-label="Consultant lines">
          <TableHead>
            <TableRow>
              <TableHeader>Consultant</TableHeader>
              <TableHeader>Their invoice</TableHeader>
              <TableHeader numeric>Their bill</TableHeader>
              <TableHeader numeric>Markup</TableHeader>
              <TableHeader numeric>Billed</TableHeader>
              <TableHeader />
            </TableRow>
          </TableHead>
          <TableBody>
            {view.consultantLines.map((l) => (
              <TableRow key={l.id}>
                <TableCell>{l.label}</TableCell>
                <TableCell className="num text-[12.5px]">{l.vendorInvoiceRef}</TableCell>
                <TableCell numeric>{money(l.costCents)}</TableCell>
                <TableCell numeric>{formatPercentBp(l.markupBp)}</TableCell>
                <TableCell numeric className="font-semibold">
                  {money(l.amountCents)}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {view.can.edit && (
                    <>
                      <Button
                        variant="ghost"
                        onClick={() =>
                          setForm({ lineId: l.id, consultantId: l.consultantId, ref: l.vendorInvoiceRef, cost: (l.costCents / 100).toFixed(2) })
                        }
                      >
                        Edit
                      </Button>
                      <Button variant="ghost" aria-label={`Remove ${l.label}`} onClick={() => void run(removeLine, { lineId: l.id })}>
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
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] items-end gap-3 border-t border-line-soft px-[18px] py-4">
          <Select
            label="Consultant"
            value={form.consultantId}
            onChange={(e) => setForm({ ...form, consultantId: e.target.value })}
            error={fieldErrors.consultantId}
          >
            {view.consultantOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
          <Input
            label="Their invoice no."
            value={form.ref}
            onChange={(e) => setForm({ ...form, ref: e.target.value })}
            error={fieldErrors.vendorInvoiceRef}
            maxLength={40}
          />
          <Input
            label="Their bill to you"
            inputMode="decimal"
            value={form.cost}
            onChange={(e) => setForm({ ...form, cost: e.target.value })}
            error={local ?? fieldErrors.costCents}
            hint={cost && cost > 0 ? `+${formatPercentBp(markup)} markup → bills ${money(consultantAmount(cost, markup))}` : undefined}
          />
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => void save()}>
              {form.lineId ? "Save line" : "Add line"}
            </Button>
            <Button variant="ghost" onClick={() => setForm(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {!view.consultantLines.length && !form && (
        <p className="m-0 px-[18px] pb-4 text-sm text-muted">No consultant bills on this invoice.</p>
      )}
    </Section>
  );
}

/** C.7 Adjustments: free lines, may be negative (a retainer credit, decision #12). */
export function AdjustmentsSection({ b }: Props) {
  const { view, run, fieldErrors } = b;
  const [form, setForm] = useState<{ lineId?: string; description: string; amount: string } | null>(null);
  const [local, setLocal] = useState<string | null>(null);

  async function save() {
    if (!form) return;
    const cents = parseMoney(form.amount);
    if (cents === null || cents === 0) return setLocal("Enter an amount other than $0. Use a minus sign for a credit.");
    setLocal(null);
    const done = await run(saveAdjustment, { lineId: form.lineId, description: form.description, amountCents: cents });
    if (done) setForm(null);
  }

  return (
    <Section
      title="Adjustments"
      aside={view.can.edit && !form && <Button onClick={() => setForm({ description: "", amount: "" })}>Add adjustment</Button>}
    >
      {view.adjustments.length > 0 && (
        <Table aria-label="Adjustments">
          <TableBody>
            {view.adjustments.map((a) => (
              <TableRow key={a.id}>
                <TableCell>{a.description}</TableCell>
                <TableCell numeric className={a.amountCents < 0 ? "text-red" : undefined}>
                  {a.amountCents < 0 ? `−${money(-a.amountCents)}` : money(a.amountCents)}
                </TableCell>
                <TableCell className="w-[160px] text-right whitespace-nowrap">
                  {view.can.edit && (
                    <>
                      <Button
                        variant="ghost"
                        onClick={() => setForm({ lineId: a.id, description: a.description, amount: (a.amountCents / 100).toFixed(2) })}
                      >
                        Edit
                      </Button>
                      <Button variant="ghost" aria-label={`Remove ${a.description}`} onClick={() => void run(removeLine, { lineId: a.id })}>
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
        <div className="grid grid-cols-[minmax(220px,2fr)_minmax(140px,1fr)_auto] items-end gap-3 border-t border-line-soft px-[18px] py-4 max-md:grid-cols-1">
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
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => void save()}>
              {form.lineId ? "Save line" : "Add line"}
            </Button>
            <Button variant="ghost" onClick={() => setForm(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {!view.adjustments.length && !form && <p className="m-0 px-[18px] pb-4 text-sm text-muted">No adjustments.</p>}
    </Section>
  );
}
