"use client";

import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/field";
import { ChevronDownIcon, ChevronUpIcon, PlusIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import {
  type EditRow,
  completeWarnings,
  defaultLocks,
  mixHours,
  phaseEditProblems,
  redistribute,
} from "@/lib/calc/phase-edit";
import { feeTypeSummary, fmtHours } from "@/lib/calc/project-detail";
import { type FeeType, type PhaseStatus, hoursFromFee } from "@/lib/calc/projects";
import { formatMoney, formatMoneySigned } from "@/lib/format";
import { FEE_TYPE_LABELS, moneyExact, moneyInput, parseMoney } from "@/lib/projects/form";
import { addPhase, updatePhases } from "@/server/projects/actions";
import type { PhaseRow, ProjectPage } from "@/server/projects/page";
import { PHASE_STATUS } from "../project-bits";
import { type MixRow, RoleMixPanel } from "../role-mix-panel";

const th = "cap border-b border-line px-2.5 py-2 text-left text-2xs font-medium whitespace-nowrap text-muted first:pl-[18px] last:pr-[18px]";
const td = "border-b border-line-soft px-2.5 py-2.5 first:pl-[18px] last:pr-[18px]";
const input = "h-8 rounded-sm border border-line-input bg-surface px-2 aria-[invalid=true]:border-red";
const STATUSES: PhaseStatus[] = ["upcoming", "current", "complete", "closed"];

/** One row while editing. Text boxes keep what's typed; numbers are parsed. */
type Draft = {
  key: string;
  id: string | null;
  code: string;
  name: string;
  description: string;
  feeType: FeeType;
  fee: string;
  hours: string;
  budgetHoursManual: boolean;
  pct: string;
  status: PhaseStatus;
  startDate: string;
  endDate: string;
  isAdditionalService: boolean;
  /** Undefined = unchanged. */
  mix: MixRow[] | undefined;
  savedMix: MixRow[];
  savedFeeCents: number;
  savedHours: number;
  archived: boolean;
};

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

function draftOf(p: PhaseRow): Draft {
  const m = p.money!;
  return {
    key: p.id,
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description ?? "",
    feeType: m.feeType,
    fee: moneyInput(m.feeCents),
    hours: String(m.budgetHours),
    budgetHoursManual: m.budgetHoursManual,
    pct: String(m.percentCompleteBp / 100),
    status: p.status,
    startDate: p.startDate ?? "",
    endDate: p.endDate ?? "",
    isAdditionalService: m.isAdditionalService,
    mix: undefined,
    savedMix: m.roles.map((r) => ({ firmRoleId: r.firmRoleId, shareBp: r.shareBp })),
    savedFeeCents: m.feeCents,
    savedHours: m.budgetHours,
    archived: false,
  };
}

/** Phases & fees table with Edit phases, Add phase and Redistribute (project-detail spec). */
export function PhasesEditor({ p }: { p: ProjectPage }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const rows = p.phases.filter((x) => x.money);
  const edit = p.phaseEdit;
  const roles = edit?.roles ?? [];
  const rateOf = (id: string) => roles.find((r) => r.id === id)?.billCents ?? 0;

  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<number, Record<string, string>>>({});
  const [banner, setBanner] = useState<{ text: string; stale: boolean } | null>(null);
  const [mixFor, setMixFor] = useState<{ key: string; readOnly: boolean } | null>(null);
  const [adding, setAdding] = useState(false);
  const [redistributing, setRedistributing] = useState(false);

  const set = (key: string, patch: Partial<Draft>) => {
    const i = drafts?.findIndex((d) => d.key === key) ?? -1;
    if (i >= 0 && rowErrors[i]) {
      const rest = { ...rowErrors };
      delete rest[i];
      setRowErrors(rest);
      if (Object.keys(rest).length === 0 && !banner?.stale) setBanner(null);
    }
    setDrafts((ds) => ds!.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  };
  const move = (i: number, by: -1 | 1) =>
    setDrafts((ds) => {
      const next = [...ds!];
      [next[i], next[i + by]] = [next[i + by], next[i]];
      return next;
    });

  /** Hours shown for a row: typed, else from its mix, else from the fee at the blended rate. */
  function autoHours(d: Draft, feeCents: number): number {
    const mix = d.mix ?? d.savedMix;
    if (d.feeType === "hourly") return hoursNum(d.hours);
    if (mix.length && (d.mix !== undefined || feeCents !== d.savedFeeCents))
      return mixHours(feeCents, mix.map((m) => ({ roleId: m.firmRoleId, shareBp: m.shareBp, rateCents: rateOf(m.firmRoleId) }))).total;
    if (!mix.length && feeCents !== d.savedFeeCents) return hoursFromFee(feeCents, edit?.blendedBillRateCents ?? null) ?? d.savedHours;
    return d.savedHours;
  }
  const rowValues = (d: Draft) => {
    const feeCents = parseMoney(d.fee);
    const typed = hoursNum(d.hours);
    const budgetHours = d.budgetHoursManual ? typed : autoHours(d, feeCents ?? 0);
    return { feeCents, budgetHours };
  };

  const live = useMemo(() => {
    if (!drafts) return null;
    const kept = drafts.filter((d) => !d.archived);
    const vals = kept.map(rowValues);
    return {
      fee: vals.reduce((n, v) => n + (v.feeCents ?? 0), 0),
      hours: vals.reduce((n, v) => n + Math.round((Number.isFinite(v.budgetHours) ? v.budgetHours : 0) * 4), 0) / 4,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rowValues reads drafts and the page's rates
  }, [drafts]);

  function asEditRow(d: Draft): EditRow {
    const { feeCents, budgetHours } = rowValues(d);
    return {
      id: d.id,
      code: d.code,
      name: d.name,
      feeType: d.feeType,
      feeCents: feeCents ?? -1,
      budgetHours: Number.isFinite(budgetHours) ? budgetHours : -1,
      percentCompleteBp: Number.isFinite(pctNum(d.pct)) ? pctNum(d.pct) : -1,
      status: d.status,
      startDate: d.startDate || null,
      endDate: d.endDate || null,
    };
  }

  function save(source: Draft[], message = "Phases saved") {
    // Same checks as the server (it re-checks, including what's been billed).
    const kept = source.map((d, i) => ({ d, i })).filter(({ d }) => !d.archived);
    const local = phaseEditProblems(kept.map(({ d }) => asEditRow(d)), new Map(), formatMoney);
    const mapped: Record<number, Record<string, string>> = {};
    for (const [k, v] of Object.entries(local)) mapped[kept[Number(k)].i] = v;
    if (Object.keys(mapped).length) {
      setRowErrors(mapped);
      setBanner({ text: `${Object.keys(mapped).length} ${Object.keys(mapped).length === 1 ? "phase needs" : "phases need"} attention`, stale: false });
      return;
    }
    startTransition(async () => {
      const r = await updatePhases({
        projectId: p.id,
        loadedAt: edit!.loadedAt,
        rows: source.map((d) => {
          const { feeCents, budgetHours } = rowValues(d);
          return {
            id: d.id,
            code: d.code,
            name: d.name,
            description: d.description,
            feeType: d.feeType,
            feeCents,
            budgetHours,
            budgetHoursManual: d.budgetHoursManual,
            percentCompleteBp: pctNum(d.pct),
            status: d.status,
            startDate: d.startDate,
            endDate: d.endDate,
            isAdditionalService: d.isAdditionalService,
            ...(d.mix !== undefined ? { mix: d.feeType === "hourly" ? [] : d.mix } : {}),
            archived: d.archived,
          };
        }),
      });
      if (!r.ok) {
        setRowErrors(r.rowErrors ?? {});
        setBanner({ text: r.error ?? "Couldn't save the phases.", stale: r.error?.startsWith("Someone else") ?? false });
        return;
      }
      setDrafts(null);
      setRowErrors({});
      setBanner(null);
      toast(message);
      router.refresh();
    });
  }

  const err = (i: number, f: string) => rowErrors[i]?.[f];
  const warnings = drafts ? completeWarnings(drafts.filter((d) => !d.archived).map(asEditRow)) : [];
  const total = p.money?.feeCents ?? 0;
  const billed = rows.reduce((n, x) => n + x.money!.billedCents, 0);
  const pct = (fee: number) => (total > 0 ? `${Math.round((fee * 100) / total)}%` : "—");
  const mixRow = mixFor && (drafts ?? rows.map(draftOf)).find((d) => d.key === mixFor.key);

  return (
    <section aria-label="Architectural fee by phase" className="rounded-sm border border-line bg-surface">
      <header className="flex flex-wrap items-start gap-3 px-[var(--spacing-card)] pt-4 pb-3">
        <div>
          <h2 className="m-0 text-sm font-semibold">Architectural fee by phase</h2>
          <p className="m-0 mt-0.5 text-xs text-muted">{feeTypeSummary(rows.map((x) => x.money!.feeType))}</p>
        </div>
        {p.canEdit && edit && !drafts && (
          <span className="ml-auto flex flex-wrap gap-2">
            <Button icon={<PlusIcon />} onClick={() => setAdding(true)}>
              Add phase
            </Button>
            <Button onClick={() => setRedistributing(true)} disabled={rows.length === 0}>
              Redistribute fee
            </Button>
            <Button variant="primary" onClick={() => setDrafts(rows.map(draftOf))} disabled={rows.length === 0}>
              Edit phases
            </Button>
          </span>
        )}
        {drafts && (
          <span className="ml-auto flex gap-2">
            <Button
              onClick={() => {
                setDrafts(null);
                setRowErrors({});
                setBanner(null);
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" disabled={pending} onClick={() => save(drafts)}>
              {pending ? "Saving…" : "Save phases"}
            </Button>
          </span>
        )}
      </header>

      {banner && (
        <div role="alert" className="mx-[var(--spacing-card)] mb-3 flex items-center gap-3 rounded-sm bg-red-tint px-3 py-2 text-sm text-red">
          {banner.text}
          {banner.stale && (
            <Button className="ml-auto" onClick={() => window.location.reload()}>
              Reload
            </Button>
          )}
        </div>
      )}
      {warnings.map((w) => (
        <div key={w.index} className="mx-[var(--spacing-card)] mb-3 flex items-center gap-3 rounded-sm bg-orange-tint px-3 py-2 text-sm text-orange-strong">
          {w.text}
          <Button
            className="ml-auto"
            onClick={() => {
              const target = drafts!.filter((d) => !d.archived)[w.index];
              set(target.key, { pct: "100" });
            }}
          >
            Set to 100%
          </Button>
        </div>
      ))}

      {rows.length === 0 && !drafts ? (
        <div className="px-[var(--spacing-card)] pb-6 text-center">
          <p className="m-0 font-semibold">No phases yet</p>
          <p className="m-0 mt-1 text-sm text-muted">Add the phases this project is billed by.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] border-collapse text-sm">
            <thead className="bg-surface-2">
              <tr>
                {drafts && <th scope="col" className={th}><span className="sr-only">Order</span></th>}
                <th scope="col" className={th}>Phase</th>
                <th scope="col" className={th}>Fee type</th>
                <th scope="col" className={cn(th, "text-right")}>Fee</th>
                <th scope="col" className={cn(th, "text-right")}>% of total</th>
                <th scope="col" className={cn(th, "text-right")}>Budget hours</th>
                {!drafts && <th scope="col" className={cn(th, "text-right")}>Hours used / budget</th>}
                <th scope="col" className={cn(th, "text-right")}>% complete</th>
                {drafts ? (
                  <th scope="col" colSpan={2} className={cn(th, "text-right")}>Start / end</th>
                ) : (
                  <>
                    <th scope="col" className={cn(th, "text-right")}>Billed</th>
                    <th scope="col" className={cn(th, "text-right")}>Left to bill</th>
                  </>
                )}
                <th scope="col" className={th}>Status</th>
                {drafts && <th scope="col" className={th}><span className="sr-only">Archive</span></th>}
              </tr>
            </thead>
            <tbody>
              {!drafts &&
                rows.map((x) => {
                  const m = x.money!;
                  const left = m.feeCents - m.billedCents;
                  return (
                    <tr key={x.id} data-phase={x.code}>
                      <td className={td}>
                        <span className="num mr-2 text-xs text-ink-3">{x.code}</span>
                        {x.name}
                        {m.isAdditionalService && <span className="ml-2 text-xs text-muted">Additional service</span>}
                      </td>
                      <td className={td}>{m.feeType === "nte" ? "NTE" : FEE_TYPE_LABELS[m.feeType]}</td>
                      <td className={cn(td, "num text-right")}>
                        {formatMoney(m.feeCents)}
                        {m.feeType === "hourly" && m.feeCents === 0 && <span className="text-muted"> (estimate)</span>}
                      </td>
                      <td className={cn(td, "num text-right")}>{pct(m.feeCents)}</td>
                      <td className={cn(td, "num text-right")}>
                        {fmtHours(m.budgetHours)}
                        {m.roles.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setMixFor({ key: x.id, readOnly: true })}
                            aria-label={`Roles for ${x.name}`}
                            className="ml-1.5 cursor-pointer border-0 bg-transparent p-0 text-xs text-blue underline"
                          >
                            Roles ({m.roles.length})
                          </button>
                        )}
                      </td>
                      <td className={cn(td, "num text-right", m.usedHours > m.budgetHours && "text-red")}>
                        {fmtHours(m.usedHours)} / {fmtHours(m.budgetHours)} h
                      </td>
                      <td className={cn(td, "num text-right")}>{m.feeType === "fixed" ? `${m.percentCompleteBp / 100}%` : "—"}</td>
                      <td className={cn(td, "num text-right")}>{formatMoney(m.billedCents)}</td>
                      <td className={cn(td, "num text-right", left < 0 && "text-red")}>{formatMoneySigned(left)}</td>
                      <td className={td}>
                        <Badge tone={PHASE_STATUS[x.status].tone} dot>
                          {PHASE_STATUS[x.status].label}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              {drafts?.map((d, i) => {
                const { feeCents, budgetHours } = rowValues(d);
                const mix = d.mix ?? d.savedMix;
                return (
                  <Fragment key={d.key}>
                    <tr data-phase={d.code} className={cn(d.archived && "opacity-50")}>
                      <td className={cn(td, "whitespace-nowrap")}>
                        <button type="button" aria-label={`Move ${d.name} up`} disabled={i === 0} onClick={() => move(i, -1)} className="cursor-pointer border-0 bg-transparent p-0.5 disabled:opacity-30">
                          <ChevronUpIcon className="size-3.5" />
                        </button>
                        <button type="button" aria-label={`Move ${d.name} down`} disabled={i === drafts.length - 1} onClick={() => move(i, 1)} className="cursor-pointer border-0 bg-transparent p-0.5 disabled:opacity-30">
                          <ChevronDownIcon className="size-3.5" />
                        </button>
                      </td>
                      <td className={td}>
                        <span className="flex gap-1.5">
                          <input aria-label={`${d.name} code`} value={d.code} maxLength={12} disabled={d.archived} aria-invalid={!!err(i, "code") || undefined} onChange={(e) => set(d.key, { code: e.target.value })} className={cn(input, "w-[64px]")} />
                          <input aria-label={`${d.code} name`} value={d.name} maxLength={80} disabled={d.archived} aria-invalid={!!err(i, "name") || undefined} onChange={(e) => set(d.key, { name: e.target.value })} className={cn(input, "w-[170px]")} />
                        </span>
                        <label className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                          <input type="checkbox" checked={d.isAdditionalService} disabled={d.archived} onChange={(e) => set(d.key, { isAdditionalService: e.target.checked })} className="size-3.5 accent-ink" />
                          Additional service
                        </label>
                        {(err(i, "code") || err(i, "name")) && <p className="m-0 mt-1 text-xs text-red">{err(i, "code") ?? err(i, "name")}</p>}
                      </td>
                      <td className={td}>
                        <select
                          aria-label={`${d.name} fee type`}
                          value={d.feeType}
                          disabled={d.archived}
                          aria-invalid={!!err(i, "feeType") || undefined}
                          onChange={(e) => set(d.key, { feeType: e.target.value as FeeType })}
                          className={input}
                        >
                          {(Object.keys(FEE_TYPE_LABELS) as FeeType[]).map((t) => (
                            <option key={t} value={t}>
                              {FEE_TYPE_LABELS[t]}
                            </option>
                          ))}
                        </select>
                        {err(i, "feeType") && <p className="m-0 mt-1 max-w-[160px] text-xs text-red">{err(i, "feeType")}</p>}
                      </td>
                      <td className={cn(td, "text-right")}>
                        <input
                          aria-label={`${d.name} fee`}
                          value={d.fee}
                          inputMode="decimal"
                          disabled={d.archived}
                          aria-invalid={feeCents === null || !!err(i, "feeCents") || undefined}
                          onChange={(e) => set(d.key, { fee: e.target.value })}
                          className={cn(input, "num w-[110px] text-right")}
                        />
                        {err(i, "feeCents") && <p className="m-0 mt-1 max-w-[180px] text-xs text-red">{err(i, "feeCents")}</p>}
                      </td>
                      <td className={cn(td, "num text-right")}>{live && live.fee > 0 && feeCents !== null ? `${Math.round((feeCents * 100) / live.fee)}%` : "—"}</td>
                      <td className={cn(td, "text-right")}>
                        <span className="inline-flex items-center gap-1.5">
                          {d.budgetHoursManual && <span role="img" aria-label="edited" className="size-1.5 rounded-full bg-blue" />}
                          <input
                            aria-label={`${d.name} budget hours`}
                            value={d.budgetHoursManual || d.feeType === "hourly" ? d.hours : String(budgetHours)}
                            inputMode="decimal"
                            disabled={d.archived}
                            aria-invalid={!!err(i, "budgetHours") || undefined}
                            onChange={(e) => set(d.key, { hours: e.target.value, budgetHoursManual: d.feeType !== "hourly" })}
                            className={cn(input, "num w-[84px] text-right")}
                          />
                        </span>
                        <span className="mt-1 flex justify-end gap-2 text-xs">
                          {d.feeType !== "hourly" && (
                            <button type="button" disabled={d.archived} onClick={() => setMixFor({ key: d.key, readOnly: false })} aria-label={`Roles for ${d.name}`} className="cursor-pointer border-0 bg-transparent p-0 text-blue underline">
                              Roles{mix.length ? ` (${mix.length})` : ""}
                            </button>
                          )}
                          {d.budgetHoursManual && (
                            <button type="button" onClick={() => set(d.key, { budgetHoursManual: false })} className="cursor-pointer border-0 bg-transparent p-0 text-blue underline">
                              Auto
                            </button>
                          )}
                        </span>
                        {err(i, "budgetHours") && <p className="m-0 mt-1 text-xs text-red">{err(i, "budgetHours")}</p>}
                      </td>
                      <td className={cn(td, "text-right")}>
                        {d.feeType === "fixed" ? (
                          <span className="inline-flex items-center gap-1">
                            <input
                              aria-label={`${d.name} percent complete`}
                              value={d.pct}
                              inputMode="decimal"
                              disabled={d.archived}
                              aria-invalid={!!err(i, "percentCompleteBp") || undefined}
                              onChange={(e) => set(d.key, { pct: e.target.value })}
                              className={cn(input, "num w-[60px] text-right")}
                            />
                            %
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                        {err(i, "percentCompleteBp") && <p className="m-0 mt-1 text-xs text-red">{err(i, "percentCompleteBp")}</p>}
                      </td>
                      <td className={cn(td, "text-right")} colSpan={2}>
                        <span className="flex flex-col items-end gap-1">
                          <input type="date" aria-label={`${d.name} start date`} value={d.startDate} disabled={d.archived} onChange={(e) => set(d.key, { startDate: e.target.value })} className={cn(input, "w-[132px]")} />
                          <input type="date" aria-label={`${d.name} end date`} value={d.endDate} disabled={d.archived} aria-invalid={!!err(i, "endDate") || undefined} onChange={(e) => set(d.key, { endDate: e.target.value })} className={cn(input, "w-[132px]")} />
                        </span>
                        {err(i, "endDate") && <p className="m-0 mt-1 text-xs text-red">{err(i, "endDate")}</p>}
                      </td>
                      <td className={td}>
                        <select aria-label={`${d.name} status`} value={d.status} disabled={d.archived} onChange={(e) => set(d.key, { status: e.target.value as PhaseStatus })} className={input}>
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {PHASE_STATUS[s].label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={td}>
                        <Button variant="ghost" aria-label={`${d.archived ? "Keep" : "Archive"} ${d.name}`} onClick={() => set(d.key, { archived: !d.archived })}>
                          {d.archived ? "Undo" : "Archive"}
                        </Button>
                        {err(i, "archived") && <p className="m-0 mt-1 max-w-[160px] text-xs text-red">{err(i, "archived")}</p>}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                {drafts && <td />}
                <td className="px-2.5 py-2.5 pl-[18px]" colSpan={2}>
                  Total
                </td>
                <td className="num px-2.5 py-2.5 text-right" data-testid="phase-fee-total">
                  {formatMoney(drafts ? live!.fee : total)}
                </td>
                <td className="num px-2.5 py-2.5 text-right">{(drafts ? live!.fee : total) > 0 ? "100%" : "—"}</td>
                <td className="num px-2.5 py-2.5 text-right" data-testid="phase-hours-total">
                  {fmtHours(drafts ? live!.hours : rows.reduce((n, x) => n + x.money!.budgetHours, 0))}
                </td>
                {!drafts && (
                  <td className="num px-2.5 py-2.5 text-right">
                    {fmtHours(rows.reduce((n, x) => n + x.money!.usedHours, 0))} h
                  </td>
                )}
                <td />
                {drafts ? (
                  <td colSpan={2} />
                ) : (
                  <>
                    <td className="num px-2.5 py-2.5 text-right">{formatMoney(billed)}</td>
                    <td className="num px-2.5 py-2.5 text-right">{formatMoneySigned(total - billed)}</td>
                  </>
                )}
                <td />
                {drafts && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {mixFor && mixRow && (
        <RoleMixPanel
          title={`Roles · ${mixRow.code} ${mixRow.name}`}
          feeCents={parseMoney(mixRow.fee) ?? 0}
          mix={mixRow.mix ?? mixRow.savedMix}
          roles={mixFor.readOnly ? rowsRoles(rows.find((x) => x.id === mixFor.key)!) : roles}
          readOnly={mixFor.readOnly}
          onClose={() => setMixFor(null)}
          onSave={(mix) => {
            set(mixRow.key, { mix, budgetHoursManual: false });
            setMixFor(null);
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
            save(
              rows.map((x) => {
                const d = draftOf(x);
                return {
                  ...d,
                  fee: moneyInput(fees[x.id]),
                  ...(hours ? { hours: String(hours[x.id]), budgetHoursManual: true } : {}),
                };
              }),
              "Fee redistributed",
            );
          }}
        />
      )}
    </section>
  );
}

/** For the read-only panel: the rates saved with the mix, not today's. */
function rowsRoles(x: PhaseRow) {
  return x.money!.roles.map((r) => ({ id: r.firmRoleId, name: r.roleName, billCents: r.rateCents }));
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
