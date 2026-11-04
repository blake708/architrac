"use client";

import { useRouter } from "next/navigation";
import { Fragment, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DrawerContent } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/field";
import { ChevronDownIcon, ChevronUpIcon, PlusIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { completeWarnings, defaultLocks, mixHours, phaseEditProblems, redistribute } from "@/lib/calc/phase-edit";
import { feeTypeSummary, fmtHours } from "@/lib/calc/project-detail";
import { type FeeType, type PhaseStatus, hoursFromFee } from "@/lib/calc/projects";
import { formatMoney, formatMoneySigned } from "@/lib/format";
import { FEE_TYPE_LABELS, moneyExact, moneyInput, parseMoney } from "@/lib/projects/form";
import { addPhase, updatePhases } from "@/server/projects/actions";
import type { PhaseRow, ProjectPage } from "@/server/projects/page";
import { PHASE_STATUS } from "../project-bits";
import { type MixDraft, RoleMixEditor, fromDrafts, mixReady, toDrafts } from "../role-mix-panel";

// Phases & fees (project-detail spec; Blake, 2026-11-03): each phase is
// edited on its own in a side panel (details, then roles). Clicking a
// phase's hours shows budget vs actual hours by role. ↑/↓ save right away.

const th = "cap border-b border-line px-2.5 py-2 text-left text-2xs font-medium whitespace-nowrap text-muted first:pl-[18px] last:pr-[18px]";
const td = "border-b border-line-soft px-2.5 py-2.5 first:pl-[18px] last:pr-[18px]";
const STATUSES: PhaseStatus[] = ["upcoming", "current", "complete", "closed"];

const hoursNum = (t: string) => {
  const v = t.trim().replace(/,/g, "");
  if (v === "") return 0;
  return /^\d+(\.\d+)?$/.test(v) ? Number(v) : Number.NaN;
};
const pctNum = (t: string) => {
  const v = t.trim().replace(/%$/, "");
  if (v === "") return 0;
  return /^\d+(\.\d{1,2})?$/.test(v) ? Math.round(Number(v) * 100) : Number.NaN;
};

/** A saved phase exactly as Save phases expects it (nothing changed). */
function payloadOf(x: PhaseRow) {
  const m = x.money!;
  return {
    id: x.id,
    code: x.code,
    name: x.name,
    description: x.description ?? "",
    feeType: m.feeType,
    feeCents: m.feeCents,
    budgetHours: m.budgetHours,
    budgetHoursManual: m.budgetHoursManual,
    percentCompleteBp: m.percentCompleteBp,
    status: x.status,
    startDate: x.startDate ?? "",
    endDate: x.endDate ?? "",
    isAdditionalService: m.isAdditionalService,
    archived: false,
  };
}

export function PhasesEditor({ p }: { p: ProjectPage }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const rows = p.phases.filter((x) => x.money);
  const edit = p.phaseEdit;
  const [editing, setEditing] = useState<PhaseRow | null>(null);
  const [hoursFor, setHoursFor] = useState<PhaseRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [redistributing, setRedistributing] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const canEdit = p.canEdit && !!edit;

  /** Save all phases (unchanged ones as they are), so order and the stale check stay right. */
  async function saveAll(list: ReturnType<typeof payloadOf>[] | (ReturnType<typeof payloadOf> & { mix?: unknown })[]) {
    return updatePhases({ projectId: p.id, loadedAt: edit!.loadedAt, rows: list });
  }

  function move(i: number, by: -1 | 1) {
    const list = rows.map(payloadOf);
    [list[i], list[i + by]] = [list[i + by], list[i]];
    startTransition(async () => {
      const r = await saveAll(list);
      if (!r.ok) return setBanner(r.error ?? "Couldn't move the phase.");
      setBanner(null);
      router.refresh();
    });
  }

  const total = p.money?.feeCents ?? 0;
  const billed = rows.reduce((n, x) => n + x.money!.billedCents, 0);
  const pct = (fee: number) => (total > 0 ? `${Math.round((fee * 100) / total)}%` : "—");

  return (
    <section aria-label="Architectural fee by phase" className="rounded-sm border border-line bg-surface">
      <header className="flex flex-wrap items-start gap-3 px-[var(--spacing-card)] pt-4 pb-3">
        <div>
          <h2 className="m-0 text-sm font-semibold">Architectural fee by phase</h2>
          <p className="m-0 mt-0.5 text-xs text-muted">{feeTypeSummary(rows.map((x) => x.money!.feeType))}</p>
        </div>
        {canEdit && (
          <span className="ml-auto flex flex-wrap gap-2">
            <Button onClick={() => setRedistributing(true)} disabled={rows.length === 0}>
              Redistribute fee
            </Button>
            <Button variant="primary" icon={<PlusIcon />} onClick={() => setAdding(true)}>
              Add phase
            </Button>
          </span>
        )}
      </header>
      {banner && (
        <div role="alert" className="mx-[var(--spacing-card)] mb-3 flex items-center gap-3 rounded-sm bg-red-tint px-3 py-2 text-sm text-red">
          {banner}
          <Button className="ml-auto" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="px-[var(--spacing-card)] pb-6 text-center">
          <p className="m-0 font-semibold">No phases yet</p>
          <p className="m-0 mt-1 text-sm text-muted">Add the phases this project is billed by.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] border-collapse text-sm">
            <thead className="bg-surface-2">
              <tr>
                <th scope="col" className={th}>Phase</th>
                <th scope="col" className={th}>Fee type</th>
                <th scope="col" className={cn(th, "text-right")}>Fee</th>
                <th scope="col" className={cn(th, "text-right")}>% of total</th>
                <th scope="col" className={cn(th, "text-right")}>Budget hours</th>
                <th scope="col" className={cn(th, "text-right")}>Hours used / budget</th>
                <th scope="col" className={cn(th, "text-right")}>% complete</th>
                <th scope="col" className={cn(th, "text-right")}>Billed</th>
                <th scope="col" className={cn(th, "text-right")}>Left to bill</th>
                <th scope="col" className={th}>Status</th>
                {canEdit && <th scope="col" className={th}><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((x, i) => {
                const m = x.money!;
                const left = m.feeCents - m.billedCents;
                const cell = td;
                return (
                  <Fragment key={x.id}>
                    <tr data-phase={x.code}>
                      <td className={cell}>
                        <span className="num mr-2 text-xs text-ink-3">{x.code}</span>
                        {x.name}
                        {m.isAdditionalService && <span className="ml-2 text-xs text-muted">Additional service</span>}
                      </td>
                      <td className={cell}>{m.feeType === "nte" ? "NTE" : FEE_TYPE_LABELS[m.feeType]}</td>
                      <td className={cn(cell, "num text-right")}>
                        {formatMoney(m.feeCents)}
                        {m.feeType === "hourly" && m.feeCents === 0 && <span className="text-muted"> (estimate)</span>}
                      </td>
                      <td className={cn(cell, "num text-right")}>{pct(m.feeCents)}</td>
                      <td className={cn(cell, "num text-right")}>{fmtHours(m.budgetHours)}</td>
                      <td className={cn(cell, "num text-right")}>
                        <button
                          type="button"
                          onClick={() => setHoursFor(x)}
                          aria-label={`Hours for ${x.name}`}
                          className={cn(
                            "num cursor-pointer border-0 bg-transparent p-0 text-right underline decoration-line-input underline-offset-4 hover:decoration-blue",
                            m.usedHours > m.budgetHours ? "text-red" : "text-blue",
                          )}
                        >
                          {fmtHours(m.usedHours)} / {fmtHours(m.budgetHours)} h
                        </button>
                      </td>
                      <td className={cn(cell, "num text-right")}>{m.feeType === "fixed" ? `${m.percentCompleteBp / 100}%` : "—"}</td>
                      <td className={cn(cell, "num text-right")}>{formatMoney(m.billedCents)}</td>
                      <td className={cn(cell, "num text-right", left < 0 && "text-red")}>{formatMoneySigned(left)}</td>
                      <td className={cell}>
                        <Badge tone={PHASE_STATUS[x.status].tone} dot>
                          {PHASE_STATUS[x.status].label}
                        </Badge>
                      </td>
                      {canEdit && (
                        <td className={cn(cell, "text-right whitespace-nowrap")}>
                          <Button variant="ghost" onClick={() => setEditing(x)} aria-label={`Edit ${x.name}`}>
                            Edit
                          </Button>
                          <button
                            type="button"
                            aria-label={`Move ${x.name} up`}
                            disabled={i === 0 || pending}
                            onClick={() => move(i, -1)}
                            className="cursor-pointer border-0 bg-transparent p-1 align-middle disabled:cursor-default disabled:opacity-30"
                          >
                            <ChevronUpIcon className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Move ${x.name} down`}
                            disabled={i === rows.length - 1 || pending}
                            onClick={() => move(i, 1)}
                            className="cursor-pointer border-0 bg-transparent p-1 align-middle disabled:cursor-default disabled:opacity-30"
                          >
                            <ChevronDownIcon className="size-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="px-2.5 py-2.5 pl-[18px]" colSpan={2}>
                  Total
                </td>
                <td className="num px-2.5 py-2.5 text-right" data-testid="phase-fee-total">
                  {formatMoney(total)}
                </td>
                <td className="num px-2.5 py-2.5 text-right">{total > 0 ? "100%" : "—"}</td>
                <td className="num px-2.5 py-2.5 text-right" data-testid="phase-hours-total">
                  {fmtHours(rows.reduce((n, x) => n + x.money!.budgetHours, 0))}
                </td>
                <td className="num px-2.5 py-2.5 text-right">{fmtHours(rows.reduce((n, x) => n + x.money!.usedHours, 0))} h</td>
                <td />
                <td className="num px-2.5 py-2.5 text-right">{formatMoney(billed)}</td>
                <td className="num px-2.5 py-2.5 text-right">{formatMoneySigned(total - billed)}</td>
                <td />
                {canEdit && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {hoursFor && (
        <PhaseHoursPanel
          phase={hoursFor}
          onClose={() => setHoursFor(null)}
          onEdit={
            canEdit
              ? () => {
                  setEditing(hoursFor);
                  setHoursFor(null);
                }
              : undefined
          }
        />
      )}
      {editing && edit && (
        <PhasePanel
          phase={editing}
          all={rows}
          edit={edit}
          onClose={() => setEditing(null)}
          save={saveAll}
          onSaved={(msg) => {
            setEditing(null);
            toast(msg);
            router.refresh();
          }}
        />
      )}
      {adding && edit && (
        <AddPhaseDialog
          projectId={p.id}
          totalCents={total}
          templates={edit.optionalTemplates}
          blended={edit.blendedBillRateCents}
          onClose={() => setAdding(false)}
          onSaved={(code) => {
            setAdding(false);
            toast(`${code} added`);
            router.refresh();
          }}
        />
      )}
      {redistributing && edit && (
        <RedistributeDialog
          rows={rows}
          shareByCode={edit.templateShareByCode}
          pending={pending}
          onClose={() => setRedistributing(false)}
          onApply={(fees, hours) => {
            setRedistributing(false);
            startTransition(async () => {
              const r = await saveAll(
                rows.map((x) => ({
                  ...payloadOf(x),
                  feeCents: fees[x.id],
                  ...(hours ? { budgetHours: hours[x.id], budgetHoursManual: true } : {}),
                })),
              );
              if (!r.ok) return setBanner(r.error ?? "Couldn't redistribute the fee.");
              toast("Fee redistributed");
              router.refresh();
            });
          }}
        />
      )}
    </section>
  );
}

/** Budget vs hours used, by role (Blake, 2026-11-03). Hours used arrive with timesheets (1.6). */
function PhaseHoursPanel({ phase, onClose, onEdit }: { phase: PhaseRow; onClose: () => void; onEdit?: () => void }) {
  const m = phase.money!;
  // Roles in the mix first (with their budget), then any other role that logged time.
  const rows = [
    ...m.roles.map((r) => ({
      key: r.firmRoleId,
      role: r.roleName,
      shareBp: r.shareBp as number | null,
      budget: r.hours as number | null,
      used: m.usedByRole.find((u) => u.firmRoleId === r.firmRoleId)?.hours ?? 0,
    })),
    ...m.usedByRole
      .filter((u) => !m.roles.some((r) => r.firmRoleId === u.firmRoleId))
      .map((u) => ({ key: u.firmRoleId ?? "none", role: u.roleName, shareBp: null, budget: null, used: u.hours })),
  ];
  const left = (budget: number | null, used: number) => (budget === null ? "—" : fmtHours(Math.round((budget - used) * 100) / 100));
  const cellR = "num border-b border-line-soft py-2 text-right";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DrawerContent
        title={`Hours · ${phase.code} ${phase.name}`}
        description={`${fmtHours(m.usedHours)} of ${fmtHours(m.budgetHours)} budgeted hours used`}
        className="max-w-[600px]!"
        footer={
          <>
            <Button onClick={onClose}>Close</Button>
            {onEdit && (
              <Button variant="primary" onClick={onEdit}>
                Edit phase
              </Button>
            )}
          </>
        }
      >
        {rows.length === 0 ? (
          <p className="m-0 text-sm text-muted">
            {m.feeType === "hourly"
              ? "Hourly phase: no role budget. Hours by role show here once time is logged."
              : "No roles set for this phase. Add them with Edit phase to see a budget for each role."}
          </p>
        ) : (
          <table className="w-full border-collapse text-sm" aria-label="Hours by role">
            <thead>
              <tr className="cap text-left text-2xs text-muted">
                <th scope="col" className="border-b border-line py-2 font-medium">Role</th>
                <th scope="col" className="border-b border-line py-2 text-right font-medium">Share</th>
                <th scope="col" className="border-b border-line py-2 text-right font-medium">Budget</th>
                <th scope="col" className="border-b border-line py-2 text-right font-medium">Used</th>
                <th scope="col" className="border-b border-line py-2 text-right font-medium">Remaining</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const over = r.budget !== null && r.used > r.budget;
                return (
                  <tr key={r.key} data-role={r.role}>
                    <td className="border-b border-line-soft py-2">{r.role}</td>
                    <td className={cellR}>{r.shareBp === null ? "—" : `${r.shareBp / 100}%`}</td>
                    <td className={cellR}>{r.budget === null ? "—" : fmtHours(r.budget)}</td>
                    <td className={cn(cellR, over && "text-red")}>{fmtHours(r.used)}</td>
                    <td className={cn(cellR, over && "text-red")}>{left(r.budget, r.used)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="py-2">Total</td>
                <td />
                <td className="num py-2 text-right">{fmtHours(m.budgetHours)}</td>
                <td className="num py-2 text-right">{fmtHours(m.usedHours)}</td>
                <td className={cn("num py-2 text-right", m.usedHours > m.budgetHours && "text-red")}>
                  {fmtHours(Math.round((m.budgetHours - m.usedHours) * 100) / 100)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
        {m.roles.length > 0 && Math.abs(m.roles.reduce((n, r) => n + r.hours, 0) - m.budgetHours) > 0.001 && (
          <p className="m-0 mt-3 text-xs text-muted">The phase&apos;s budget hours were typed in, so they differ from the roles&apos; total.</p>
        )}
      </DrawerContent>
    </Dialog>
  );
}

/** One phase: details first, then its roles. */
function PhasePanel({
  phase,
  all,
  edit,
  onClose,
  save,
  onSaved,
}: {
  phase: PhaseRow;
  all: PhaseRow[];
  edit: NonNullable<ProjectPage["phaseEdit"]>;
  onClose: () => void;
  save: (rows: (ReturnType<typeof payloadOf> & { mix?: unknown })[]) => ReturnType<typeof updatePhases>;
  onSaved: (message: string) => void;
}) {
  const m = phase.money!;
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState({
    code: phase.code,
    name: phase.name,
    description: phase.description ?? "",
    feeType: m.feeType,
    fee: moneyInput(m.feeCents),
    hours: String(m.budgetHours),
    budgetHoursManual: m.budgetHoursManual,
    pct: String(m.percentCompleteBp / 100),
    status: phase.status,
    startDate: phase.startDate ?? "",
    endDate: phase.endDate ?? "",
    isAdditionalService: m.isAdditionalService,
  });
  const [mix, setMix] = useState<MixDraft[]>(() => toDrafts(m.roles.map((r) => ({ firmRoleId: r.firmRoleId, shareBp: r.shareBp }))));
  const [mixTouched, setMixTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const set = (patch: Partial<typeof v>) => {
    setV((x) => ({ ...x, ...patch }));
    setErrors({});
  };

  const rateOf = (id: string) => edit.roles.find((r) => r.id === id)?.billCents ?? 0;
  const feeCents = parseMoney(v.fee);
  const hourly = v.feeType === "hourly";
  // Hours: typed, else from the roles, else (if the fee changed) the blended rate, else as saved.
  const autoHours = (() => {
    const fee = feeCents ?? 0;
    if (hourly) return hoursNum(v.hours);
    if (mix.length && (mixTouched || fee !== m.feeCents))
      return mixHours(fee, mix.map((r) => ({ roleId: r.firmRoleId, shareBp: r.shareBp, rateCents: rateOf(r.firmRoleId) }))).total;
    if (!mix.length && (mixTouched || fee !== m.feeCents)) return hoursFromFee(fee, edit.blendedBillRateCents) ?? m.budgetHours;
    return m.budgetHours;
  })();
  const budgetHours = v.budgetHoursManual || hourly ? hoursNum(v.hours) : autoHours;
  const otherFees = all.filter((x) => x.id !== phase.id).reduce((n, x) => n + x.money!.feeCents, 0);
  const editRow = {
    id: phase.id,
    code: v.code,
    name: v.name,
    feeType: v.feeType,
    feeCents: feeCents ?? -1,
    budgetHours: Number.isFinite(budgetHours) ? budgetHours : -1,
    percentCompleteBp: Number.isFinite(pctNum(v.pct)) ? pctNum(v.pct) : -1,
    status: v.status,
    startDate: v.startDate || null,
    endDate: v.endDate || null,
  };
  const warning = completeWarnings([editRow])[0];

  function submit(archived: boolean) {
    const others = all.filter((x) => x.id !== phase.id);
    if (!archived) {
      // Same checks as the server, with this phase among the others.
      const list = [...others.map((x) => ({ ...payloadOf(x), feeCents: x.money!.feeCents })), editRow];
      const problems = phaseEditProblems(list as Parameters<typeof phaseEditProblems>[0], new Map(), formatMoney)[list.length - 1];
      if (problems) return setErrors(problems);
      if (!mixReady(mix)) return setFormError("Role shares must add up to 100%, or remove the roles.");
    }
    setFormError(null);
    startTransition(async () => {
      const mine = {
        ...payloadOf(phase),
        code: v.code,
        name: v.name,
        description: v.description,
        feeType: v.feeType,
        feeCents: feeCents ?? 0,
        budgetHours,
        budgetHoursManual: v.budgetHoursManual && !hourly,
        percentCompleteBp: pctNum(v.pct),
        status: v.status,
        startDate: v.startDate,
        endDate: v.endDate,
        isAdditionalService: v.isAdditionalService,
        archived,
        ...(mixTouched ? { mix: hourly ? [] : fromDrafts(mix) } : {}),
      };
      const r = await save(all.map((x) => (x.id === phase.id ? mine : payloadOf(x))));
      setConfirmArchive(false);
      if (!r.ok) {
        const i = all.findIndex((x) => x.id === phase.id);
        setErrors(r.rowErrors?.[i] ?? {});
        setFormError(r.error ?? "Couldn't save.");
        return;
      }
      onSaved(archived ? `${phase.code} archived` : `${v.code.trim()} saved`);
    });
  }

  const e = (k: string) => errors[k];
  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DrawerContent
          title={`Edit ${phase.code} · ${phase.name}`}
          description={feeCents !== null ? `Project fee becomes ${moneyExact(otherFees + feeCents)}` : undefined}
          className="max-w-[720px]!"
          footer={
            <>
              <Button variant="danger" className="mr-auto" onClick={() => setConfirmArchive(true)}>
                Archive phase
              </Button>
              {formError && (
                <span role="alert" className="text-sm text-red">
                  {formError}
                </span>
              )}
              <Button onClick={onClose}>Cancel</Button>
              <Button variant="primary" disabled={pending} onClick={() => submit(false)}>
                {pending ? "Saving…" : "Save phase"}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-8">
            <section aria-label="Phase details" className="flex flex-col gap-4">
              <h3 className="cap m-0 text-xs font-semibold text-ink-2">Phase details</h3>
              <div className="grid grid-cols-[110px_1fr] gap-4">
                <Input label="Code *" value={v.code} maxLength={12} error={e("code")} onChange={(x) => set({ code: x.target.value })} />
                <Input label="Name *" value={v.name} maxLength={80} error={e("name")} onChange={(x) => set({ name: x.target.value })} />
              </div>
              <Textarea label="Description" value={v.description} maxLength={500} rows={2} onChange={(x) => set({ description: x.target.value })} />
              <div className="grid grid-cols-2 gap-4">
                <Select label="Fee type" value={v.feeType} error={e("feeType")} onChange={(x) => set({ feeType: x.target.value as FeeType })}>
                  {(Object.keys(FEE_TYPE_LABELS) as FeeType[]).map((t) => (
                    <option key={t} value={t}>
                      {FEE_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
                <Input
                  label="Fee"
                  value={v.fee}
                  inputMode="decimal"
                  error={feeCents === null ? "Enter a fee of $0 or more" : e("feeCents")}
                  onChange={(x) => set({ fee: x.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Input
                    label="Budget hours"
                    value={v.budgetHoursManual || hourly ? v.hours : String(budgetHours)}
                    inputMode="decimal"
                    error={e("budgetHours")}
                    hint={hourly ? "Typed in for hourly phases" : v.budgetHoursManual ? "Typed in" : mix.length ? "From the roles" : "From the fee at the blended rate"}
                    onChange={(x) => set({ hours: x.target.value, budgetHoursManual: !hourly })}
                  />
                  {v.budgetHoursManual && !hourly && (
                    <button type="button" onClick={() => set({ budgetHoursManual: false })} className="mt-1 cursor-pointer border-0 bg-transparent p-0 text-xs text-blue underline">
                      Work it out from the fee
                    </button>
                  )}
                </div>
                {v.feeType === "fixed" ? (
                  <Input label="% complete" value={v.pct} inputMode="decimal" error={e("percentCompleteBp")} onChange={(x) => set({ pct: x.target.value })} />
                ) : (
                  <div />
                )}
              </div>
              <div className="grid grid-cols-3 gap-4">
                <Select label="Status" value={v.status} onChange={(x) => set({ status: x.target.value as PhaseStatus })}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {PHASE_STATUS[s].label}
                    </option>
                  ))}
                </Select>
                <Input label="Start" type="date" value={v.startDate} onChange={(x) => set({ startDate: x.target.value })} />
                <Input label="End" type="date" value={v.endDate} error={e("endDate")} onChange={(x) => set({ endDate: x.target.value })} />
              </div>
              {warning && (
                <div className="flex items-center gap-3 rounded-sm bg-orange-tint px-3 py-2 text-sm text-orange-strong">
                  {warning.text}
                  <Button className="ml-auto" onClick={() => set({ pct: "100" })}>
                    Set to 100%
                  </Button>
                </div>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={v.isAdditionalService} onChange={(x) => set({ isAdditionalService: x.target.checked })} className="size-4 accent-ink" />
                Additional service
              </label>
              {e("archived") && <p className="m-0 text-sm text-red">{e("archived")}</p>}
            </section>
            <section aria-label="Roles" className="flex flex-col gap-3 border-t border-line-soft pt-6">
              <h3 className="cap m-0 text-xs font-semibold text-ink-2">Roles</h3>
              {hourly ? (
                <p className="m-0 text-sm text-muted">Hourly phases are billed by the hour, so they have no role split.</p>
              ) : (
                <RoleMixEditor
                  rows={mix}
                  onChange={(rows) => {
                    setMix(rows);
                    setMixTouched(true);
                  }}
                  feeCents={feeCents ?? 0}
                  roles={edit.roles}
                />
              )}
            </section>
          </div>
        </DrawerContent>
      </Dialog>
      <Dialog open={confirmArchive} onOpenChange={(o) => !o && setConfirmArchive(false)}>
        <DialogContent
          title={`Archive ${phase.code}?`}
          description={`${phase.name} comes off this project and its fee leaves the total. Phases with time or invoices can't be archived; set them to Closed instead.`}
          footer={
            <>
              <Button onClick={() => setConfirmArchive(false)}>Cancel</Button>
              <Button variant="danger" disabled={pending} onClick={() => submit(true)}>
                Archive
              </Button>
            </>
          }
        />
      </Dialog>
    </>
  );
}

function AddPhaseDialog({
  projectId,
  totalCents,
  templates,
  blended,
  onClose,
  onSaved,
}: {
  projectId: string;
  totalCents: number;
  templates: NonNullable<ProjectPage["phaseEdit"]>["optionalTemplates"];
  blended: number | null;
  onClose: () => void;
  onSaved: (code: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState({
    templateId: "",
    code: "",
    name: "",
    description: "",
    feeType: "fixed" as FeeType,
    fee: "0",
    hours: "",
    isAdditionalService: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }));
  const fee = parseMoney(v.fee);

  function save() {
    const hours = v.hours.trim() === "" ? null : hoursNum(v.hours);
    if (fee === null) return setErrors({ feeCents: "Enter a fee of $0 or more" });
    if (hours !== null && !(Number.isFinite(hours) && Number.isInteger(hours * 4))) return setErrors({ budgetHours: "Use quarter hours" });
    startTransition(async () => {
      const r = await addPhase({
        projectId,
        templateId: v.templateId || null,
        code: v.code,
        name: v.name,
        description: v.description,
        feeType: v.feeType,
        feeCents: fee,
        budgetHours: hours,
        isAdditionalService: v.isAdditionalService,
      });
      if (!r.ok) return setErrors({ ...(r.rowErrors?.[0] ?? {}), ...(r.error ? { form: r.error } : {}) });
      onSaved(v.code.trim());
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Add phase"
        description={fee !== null ? `Total fee becomes ${moneyExact(totalCents + fee)}` : undefined}
        footer={
          <>
            {errors.form && <span role="alert" className="mr-auto text-sm text-red">{errors.form}</span>}
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={pending} onClick={save}>
              Add phase
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Select
            label="Start from"
            value={v.templateId}
            onChange={(e) => {
              const t = templates.find((x) => x.id === e.target.value);
              set(
                t
                  ? { templateId: t.id, code: t.code, name: t.name, description: t.description ?? "", feeType: t.feeType, isAdditionalService: true }
                  : { templateId: "", isAdditionalService: false },
              );
            }}
          >
            <option value="">Blank phase</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.code} · {t.name}
              </option>
            ))}
          </Select>
          <div className="grid grid-cols-[120px_1fr] gap-4">
            <Input label="Code *" value={v.code} maxLength={12} error={errors.code} onChange={(e) => set({ code: e.target.value })} />
            <Input label="Name *" value={v.name} maxLength={80} error={errors.name} onChange={(e) => set({ name: e.target.value })} />
          </div>
          <Input label="Description" value={v.description} maxLength={500} onChange={(e) => set({ description: e.target.value })} />
          <div className="grid grid-cols-3 gap-4">
            <Select label="Fee type" value={v.feeType} onChange={(e) => set({ feeType: e.target.value as FeeType })}>
              {(Object.keys(FEE_TYPE_LABELS) as FeeType[]).map((t) => (
                <option key={t} value={t}>
                  {FEE_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
            <Input label="Fee" value={v.fee} inputMode="decimal" error={errors.feeCents} onChange={(e) => set({ fee: e.target.value })} />
            <Input
              label="Budget hours"
              value={v.hours}
              inputMode="decimal"
              placeholder={
                v.feeType !== "hourly" && blended && fee !== null ? String(hoursFromFee(fee, blended) ?? 0) : "0"
              }
              hint="Blank = from the fee"
              error={errors.budgetHours}
              onChange={(e) => set({ hours: e.target.value })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={v.isAdditionalService} onChange={(e) => set({ isAdditionalService: e.target.checked })} className="size-4 accent-ink" />
            Additional service
          </label>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RedistributeDialog({
  rows,
  shareByCode,
  pending,
  onClose,
  onApply,
}: {
  rows: PhaseRow[];
  shareByCode: Record<string, number>;
  pending: boolean;
  onClose: () => void;
  onApply: (fees: Record<string, number>, hours: Record<string, number> | null) => void;
}) {
  const phases = rows.map((x) => ({
    id: x.id,
    code: x.code,
    feeCents: x.money!.feeCents,
    budgetHours: x.money!.budgetHours,
    billedCents: x.money!.billedCents,
    status: x.status,
    templateShareBp: shareByCode[x.code.toLowerCase()] ?? 0,
  }));
  const current = phases.reduce((n, x) => n + x.feeCents, 0);
  const [totalText, setTotalText] = useState(moneyInput(current));
  const [hoursText, setHoursText] = useState("");
  const [locked, setLocked] = useState(() => defaultLocks(phases));
  const total = parseMoney(totalText);
  const hours = hoursText.trim() === "" ? null : hoursNum(hoursText);
  const result = total === null ? null : redistribute(phases, total, locked, hours !== null && Number.isFinite(hours) ? hours : null);
  const error =
    total === null
      ? "Enter a total fee"
      : result && !result.ok
        ? result.error === "below_locked"
          ? `New total is less than the ${formatMoney(result.lockedCents)} in locked phases`
          : `${result.code} can't drop below the ${formatMoney(result.billedCents)} already billed`
        : null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Redistribute fee"
        description="Spread a new total over the unlocked phases, in proportion to their current fees."
        className="max-w-[600px]!"
        footer={
          <>
            {error && <span role="alert" className="mr-auto text-sm text-red">{error}</span>}
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!result?.ok || pending} onClick={() => result?.ok && onApply(result.fees, result.hours)}>
              Apply
            </Button>
          </>
        }
      >
        <div className="mb-4 grid grid-cols-2 gap-4">
          <Input label="New total fee" value={totalText} inputMode="decimal" onChange={(e) => setTotalText(e.target.value)} />
          <Input label="New total hours (optional)" value={hoursText} inputMode="decimal" onChange={(e) => setHoursText(e.target.value)} />
        </div>
        <table className="w-full border-collapse text-sm" aria-label="Preview">
          <thead>
            <tr className="cap text-left text-2xs text-muted">
              <th scope="col" className="border-b border-line py-2 font-medium">Lock</th>
              <th scope="col" className="border-b border-line py-2 font-medium">Phase</th>
              <th scope="col" className="border-b border-line py-2 text-right font-medium">Fee</th>
              {hours !== null && <th scope="col" className="border-b border-line py-2 text-right font-medium">Hours</th>}
            </tr>
          </thead>
          <tbody>
            {phases.map((x) => {
              const next = result?.ok ? result.fees[x.id] : x.feeCents;
              return (
                <tr key={x.id} data-phase={x.code}>
                  <td className="border-b border-line-soft py-1.5">
                    <input
                      type="checkbox"
                      aria-label={`Lock ${x.code}`}
                      checked={locked.has(x.id)}
                      onChange={(e) =>
                        setLocked((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.add(x.id);
                          else n.delete(x.id);
                          return n;
                        })
                      }
                      className="size-4 accent-ink"
                    />
                  </td>
                  <td className="border-b border-line-soft py-1.5">{x.code}</td>
                  <td className="num border-b border-line-soft py-1.5 text-right" data-testid={`preview-${x.code}`}>
                    {next === x.feeCents ? formatMoney(x.feeCents) : `${formatMoney(x.feeCents)} → ${formatMoney(next)}`}
                  </td>
                  {hours !== null && (
                    <td className="num border-b border-line-soft py-1.5 text-right">
                      {result?.ok && result.hours ? `${fmtHours(x.budgetHours)} → ${fmtHours(result.hours[x.id])}` : fmtHours(x.budgetHours)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </DialogContent>
    </Dialog>
  );
}
