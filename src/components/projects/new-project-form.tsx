"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { type MixRow, RoleMixPanel } from "./role-mix-panel";
import { EMPTY_DRAFT, ProjectFields, type ProjectDraft, checkDraft } from "./project-fields";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { mixHours } from "@/lib/calc/phase-edit";
import { type FeeType, type PhaseEdit, hoursFromFee, planPhaseFees } from "@/lib/calc/projects";
import { formatMoney } from "@/lib/format";
import {
  CREATE_STATUSES,
  FEE_TYPE_HELP,
  FEE_TYPE_LABELS,
  PROJECT_MESSAGES,
  moneyExact,
  moneyInput,
  parseMoney,
  phaseProblem,
} from "@/lib/projects/form";
import { createProject } from "@/server/projects/actions";
import type { NewProjectOptions } from "@/server/projects/view";

// New project (projects-list spec, "New project flow"). Card 1 is the
// project; Card 2 splits the total fee over the firm's default phases by
// share (editable as % or $) and turns each fee into budget hours at the
// firm's blended bill rate. The server re-checks everything on Create.

type Row = {
  key: string;
  templateId: string | null;
  code: string;
  name: string;
  feeType: FeeType;
  /** Template share, used to rebalance phases nobody has edited. */
  weightBp: number;
  include: boolean;
  /** The person set this phase's fee or % (blue dot). */
  edit: PhaseEdit;
  /** Hours typed over the calculated ones (always typed for hourly phases). */
  hoursEdit: number | null;
  /** Role mix (starts from the template's default). Empty = blended bill rate. */
  mix: MixRow[];
  /** What's in a box while it's being typed in. */
  draft: { fee?: string; pct?: string; hours?: string };
};

function parseHours(raw: string): number | null {
  const v = raw.trim().replace(/,/g, "");
  if (v === "") return 0;
  if (!/^\d+(\.\d+)?$/.test(v)) return null;
  const n = Number(v);
  return Number.isInteger(n * 4) ? n : null;
}

/** "12.5" or "12.5%" → 1250 basis points (0–100%, up to 2 decimals). */
function parsePct(raw: string): number | null {
  const v = raw.trim().replace(/%$/, "").trim();
  if (v === "") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  const bp = Math.round(Number(v) * 100);
  return bp <= 10_000 ? bp : null;
}

/** 1075 → "10.75", 2500 → "25". */
const pctText = (bp: number) => String(bp / 100);

export function NewProjectForm({
  options,
  viewerMembershipId,
  presetClientId,
  addressLookup,
}: {
  options: NewProjectOptions;
  viewerMembershipId: string;
  presetClientId: string | null;
  /** Google address lookup is set up (GOOGLE_MAPS_API_KEY). */
  addressLookup: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [d, setD] = useState<ProjectDraft>(() => ({
    ...EMPTY_DRAFT,
    number: options.suggestedNumber,
    clientCompanyId: presetClientId && options.clients.some((c) => c.id === presetClientId) ? presetClientId : "",
    principalMembershipId: options.principals.length === 1 ? options.principals[0].membershipId : "",
    pmMembershipId: options.pms.some((p) => p.membershipId === viewerMembershipId) ? viewerMembershipId : "",
  }));
  const set = (p: Partial<typeof d>) => setD((x) => ({ ...x, ...p }));
  const [totalFeeText, setTotalFeeText] = useState("0");
  const totalFee = parseMoney(totalFeeText);
  const rate = options.blendedBillRateCents;

  const [rows, setRows] = useState<Row[]>(() =>
    options.templates.map((t) => ({
      key: t.id,
      templateId: t.id,
      code: t.code,
      name: t.name,
      feeType: t.feeType,
      weightBp: t.shareBp,
      include: true,
      edit: null,
      hoursEdit: null,
      mix: t.mix,
      draft: {},
    })),
  );
  const editRow = (key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const draft = (key: string, p: Row["draft"]) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, draft: { ...r.draft, ...p } } : r)));

  // Fees and % from the total; hours from each fee at the blended bill rate.
  const plan = useMemo(
    () =>
      planPhaseFees(
        totalFee ?? 0,
        rows.map((r) => ({ id: r.key, include: r.include, feeType: r.feeType, weightBp: r.weightBp, edit: r.edit })),
      ),
    [rows, totalFee],
  );
  const hoursOf = (r: Row) => {
    if (!r.include) return 0;
    if (r.hoursEdit !== null) return r.hoursEdit;
    if (r.feeType === "hourly") return 0;
    if (r.mix.length) return mixHours(plan.fees[r.key], r.mix.map((m) => ({ roleId: m.firmRoleId, shareBp: m.shareBp, rateCents: rateOf(m.firmRoleId) }))).total;
    return hoursFromFee(plan.fees[r.key], rate) ?? 0;
  };
  const rateOf = (roleId: string) => options.roles.find((x) => x.id === roleId)?.billCents ?? 0;
  const [mixFor, setMixFor] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const included = rows.filter((r) => r.include);
  const sumFee = plan.sumCents;
  const sumHours = included.reduce((n, r) => n + Math.round(hoursOf(r) * 4), 0) / 4;
  const rowBad = rows.some(
    (r) =>
      (r.draft.fee !== undefined && parseMoney(r.draft.fee) === null) ||
      (r.draft.pct !== undefined && parsePct(r.draft.pct) === null) ||
      (r.draft.hours !== undefined && parseHours(r.draft.hours) === null),
  );
  const problem =
    totalFee === null || rowBad
      ? null
      : phaseProblem({
          totalFeeCents: totalFee,
          totalBudgetHours: sumHours,
          phases: included.map((r) => ({ feeType: r.feeType, feeCents: plan.fees[r.key], budgetHours: hoursOf(r) })),
        });
  // The NTE cap is reported on Create (spec); sum problems block the button.
  const blocking = problem !== null && problem !== PROJECT_MESSAGES.nteCap;
  const feeMismatch = totalFee !== null && sumFee !== totalFee;
  const sumPct = totalFee ? Math.round((sumFee * 10_000) / totalFee) : 0;
  const shownTypes = new Set(included.map((r) => r.feeType));

  function submit() {
    setFormError(null);
    const { fields, errors: local } = checkDraft(d);
    if (totalFee === null) local.totalFeeCents = PROJECT_MESSAGES.money;
    if (problem === PROJECT_MESSAGES.nteCap) local.phases = problem;
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    startTransition(async () => {
      const result = await createProject({
        ...fields,
        totalFeeCents: totalFee,
        totalBudgetHours: sumHours,
        phases: included.map((r) => ({
          templateId: r.templateId,
          code: r.code,
          name: r.name,
          feeType: r.feeType,
          feeCents: plan.fees[r.key],
          budgetHours: hoursOf(r),
          budgetHoursManual: r.hoursEdit !== null,
          mix: r.feeType === "hourly" ? [] : r.mix,
        })),
      });
      if (!result.ok) {
        setErrors((result.fieldErrors ?? {}) as Record<string, string>);
        setFormError(result.error ?? (result.fieldErrors ? "Fix the fields marked in red." : null));
        return;
      }
      router.push(`/app/projects/${result.data.id}`);
    });
  }

  const e = (k: string) => errors[k];
  const cell = "border-b border-line-soft px-2 py-1.5";

  return (
    <form
      className="flex flex-col gap-5 px-4 pt-6 md:px-page-x"
      onSubmit={(ev) => {
        ev.preventDefault();
        submit();
      }}
      noValidate
    >
      <Card title="Project details" className="w-full max-w-[720px]">
        <ProjectFields
          value={d}
          onChange={set}
          errors={errors}
          options={options}
          statuses={CREATE_STATUSES}
          addressLookup={addressLookup}
        />
      </Card>

      <Card title="Phases & fees" padded={false}>
        <div className="flex flex-wrap items-end gap-6 px-[var(--spacing-card)] pb-4">
          <Input
            label="Total fee *"
            value={totalFeeText}
            inputMode="decimal"
            wrapperClassName="w-[200px]"
            error={totalFee === null ? PROJECT_MESSAGES.money : e("totalFeeCents")}
            onChange={(ev) => setTotalFeeText(ev.target.value)}
          />
          <div className="flex flex-col gap-1.5 pb-2">
            <span className="cap text-xs font-medium text-muted">Total budget hours</span>
            <span className="num text-base" data-testid="hours-total">
              {sumHours}
            </span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] border-collapse text-sm">
            <thead className="bg-surface-2">
              <tr className="text-left text-2xs font-medium text-muted">
                <th scope="col" className="cap border-b border-line px-2 py-2 pl-[18px]">Include</th>
                <th scope="col" className="cap border-b border-line px-2 py-2">Code</th>
                <th scope="col" className="cap border-b border-line px-2 py-2">Name</th>
                <th scope="col" className="cap border-b border-line px-2 py-2">Fee type</th>
                <th scope="col" className="cap border-b border-line px-2 py-2 text-right">Share</th>
                <th scope="col" className="cap border-b border-line px-2 py-2 text-right">Fee</th>
                <th scope="col" className="cap border-b border-line px-2 py-2 pr-[18px] text-right">Budget hours</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const split = r.include && r.feeType !== "hourly";
                const dot = <span aria-label="edited" role="img" className="size-1.5 rounded-full bg-blue" />;
                return (
                  <tr key={r.key} data-phase={r.code} className={cn(!r.include && "opacity-50")}>
                    <td className={cn(cell, "pl-[18px]")}>
                      <input
                        type="checkbox"
                        aria-label={`Include ${r.name}`}
                        checked={r.include}
                        onChange={(ev) => editRow(r.key, { include: ev.target.checked, edit: null, hoursEdit: null, draft: {} })}
                        className="size-4 cursor-pointer accent-ink"
                      />
                    </td>
                    <td className={cell}>
                      <input aria-label={`${r.name} code`} value={r.code} maxLength={12} disabled={!r.include} onChange={(ev) => editRow(r.key, { code: ev.target.value })} className="h-8 w-[70px] rounded-sm border border-line-input bg-surface px-2" />
                    </td>
                    <td className={cell}>
                      <input aria-label={`${r.code} name`} value={r.name} maxLength={80} disabled={!r.include} onChange={(ev) => editRow(r.key, { name: ev.target.value })} className="h-8 w-full min-w-[180px] rounded-sm border border-line-input bg-surface px-2" />
                    </td>
                    <td className={cell}>
                      <select
                        aria-label={`${r.name} fee type`}
                        value={r.feeType}
                        disabled={!r.include}
                        onChange={(ev) => {
                          const feeType = ev.target.value as FeeType;
                          // Hourly phases leave the split; their hours are typed.
                          editRow(r.key, { feeType, edit: feeType === "hourly" ? null : r.edit, hoursEdit: null, draft: {} });
                        }}
                        className="h-8 rounded-sm border border-line-input bg-surface px-1.5"
                      >
                        {(Object.keys(FEE_TYPE_LABELS) as FeeType[]).map((t) => (
                          <option key={t} value={t}>
                            {FEE_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={cn(cell, "text-right")}>
                      <span className="inline-flex items-center gap-1.5">
                        {r.edit?.kind === "pct" && dot}
                        <input
                          aria-label={`${r.name} share`}
                          value={r.draft.pct ?? pctText(plan.shares[r.key])}
                          inputMode="decimal"
                          disabled={!split}
                          aria-invalid={(r.draft.pct !== undefined && parsePct(r.draft.pct) === null) || undefined}
                          onChange={(ev) => {
                            const bp = parsePct(ev.target.value);
                            editRow(r.key, {
                              draft: { pct: ev.target.value },
                              ...(bp !== null ? { edit: { kind: "pct" as const, bp }, hoursEdit: null } : {}),
                            });
                          }}
                          onBlur={() => draft(r.key, { pct: undefined })}
                          className="num h-8 w-[64px] rounded-sm border border-line-input bg-surface px-2 text-right aria-[invalid=true]:border-red"
                        />
                        <span className="text-muted">%</span>
                      </span>
                    </td>
                    <td className={cn(cell, "text-right")}>
                      <span className="inline-flex items-center gap-1.5">
                        {r.edit?.kind === "fee" && dot}
                        <input
                          aria-label={`${r.name} fee`}
                          value={r.draft.fee ?? moneyInput(plan.fees[r.key])}
                          inputMode="decimal"
                          disabled={!split}
                          aria-invalid={(r.draft.fee !== undefined && parseMoney(r.draft.fee) === null) || undefined}
                          onChange={(ev) => {
                            const v = parseMoney(ev.target.value);
                            editRow(r.key, {
                              draft: { fee: ev.target.value },
                              ...(v !== null ? { edit: { kind: "fee" as const, cents: v }, hoursEdit: null } : {}),
                            });
                          }}
                          onBlur={() => draft(r.key, { fee: undefined })}
                          className="num h-8 w-[120px] rounded-sm border border-line-input bg-surface px-2 text-right aria-[invalid=true]:border-red"
                        />
                      </span>
                    </td>
                    <td className={cn(cell, "pr-[18px] text-right")}>
                      <span className="inline-flex items-center gap-1.5">
                        {r.hoursEdit !== null && r.feeType !== "hourly" && dot}
                        <input
                          aria-label={`${r.name} budget hours`}
                          value={r.draft.hours ?? String(hoursOf(r))}
                          inputMode="decimal"
                          disabled={!r.include}
                          aria-invalid={(r.draft.hours !== undefined && parseHours(r.draft.hours) === null) || undefined}
                          onChange={(ev) => {
                            const v = parseHours(ev.target.value);
                            editRow(r.key, { draft: { ...r.draft, hours: ev.target.value }, ...(v !== null ? { hoursEdit: v } : {}) });
                          }}
                          onBlur={() => draft(r.key, { hours: undefined })}
                          className="num h-8 w-[90px] rounded-sm border border-line-input bg-surface px-2 text-right aria-[invalid=true]:border-red"
                        />
                        {r.feeType !== "hourly" && (
                          <button
                            type="button"
                            disabled={!r.include}
                            onClick={() => setMixFor(r.key)}
                            aria-label={`Roles for ${r.name}`}
                            className="ml-1 cursor-pointer border-0 bg-transparent p-0 text-xs text-blue underline disabled:cursor-not-allowed disabled:text-faint"
                          >
                            Roles{r.mix.length ? ` (${r.mix.length})` : ""}
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td colSpan={4} className="px-2 py-2.5 pl-[18px]">
                  Total
                </td>
                <td className="num px-2 py-2.5 pr-6 text-right" data-testid="share-sum">
                  {pctText(sumPct)}%
                </td>
                <td className="num px-2 py-2.5 text-right" data-testid="fee-sum">
                  {moneyExact(sumFee)}
                </td>
                <td className="num px-2 py-2.5 pr-[18px] text-right" data-testid="hours-sum">
                  {sumHours}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="flex flex-col gap-2 px-[var(--spacing-card)] py-4 text-sm">
          <div>
            <button
              type="button"
              className="cursor-pointer border-0 bg-transparent p-0 text-blue underline"
              onClick={() =>
                setRows((rs) =>
                  rs.map((r) => ({ ...r, edit: null, hoursEdit: r.feeType === "hourly" ? r.hoursEdit : null, draft: {} })),
                )
              }
            >
              Reset to template split
            </button>
          </div>
          {(plan.over || feeMismatch || e("phases") || (problem && problem !== PROJECT_MESSAGES.nteCap)) && (
            <div role="alert" className="flex flex-wrap items-center gap-3 text-red">
              <span>{e("phases") ?? problem}</span>
              {feeMismatch && (
                <Button
                  type="button"
                  onClick={() => {
                    // Freeze %-edited phases at their dollars so the new total
                    // doesn't move them, then make the total match.
                    setRows((rs) =>
                      rs.map((r) => (r.edit?.kind === "pct" ? { ...r, edit: { kind: "fee", cents: plan.fees[r.key] } } : r)),
                    );
                    setTotalFeeText(moneyInput(sumFee));
                  }}
                >
                  Use {moneyExact(sumFee)} as total
                </Button>
              )}
            </div>
          )}
          <p className="m-0 text-xs text-muted" data-testid="hours-note">
            {rate
              ? `Budget hours = phase fee ÷ each role's bill rate (Roles), or the blended bill rate (${formatMoney(rate)}/h) for phases with no roles, to the quarter hour. Type over any phase's hours.`
              : "Set up roles and rates in Settings → Rates & roles to fill in budget hours from the fee. Until then, type them in."}
          </p>
          <ul className="m-0 list-none p-0 text-xs text-muted">
            {(Object.keys(FEE_TYPE_HELP) as FeeType[])
              .filter((t) => shownTypes.has(t))
              .map((t) => (
                <li key={t}>{FEE_TYPE_HELP[t]}</li>
              ))}
          </ul>
        </div>
      </Card>

      {mixFor &&
        (() => {
          const r = rows.find((x) => x.key === mixFor)!;
          return (
            <RoleMixPanel
              title={`Roles · ${r.code} ${r.name}`}
              feeCents={plan.fees[r.key]}
              mix={r.mix}
              roles={options.roles}
              onClose={() => setMixFor(null)}
              onSave={(mix) => {
                // A new mix sets the hours again, unless they were typed in.
                editRow(r.key, { mix, hoursEdit: null, draft: {} });
                setMixFor(null);
              }}
            />
          );
        })()}

      <div className="sticky bottom-0 z-10 -mx-4 border-t border-line bg-surface md:-mx-page-x">
        {formError && (
          <div role="alert" className="border-b border-red bg-red-tint px-4 py-2 text-sm text-red md:px-page-x">
            {formError}
          </div>
        )}
        <div className="flex justify-end gap-2 px-4 py-3 md:px-page-x">
          <Button type="button" onClick={() => router.push("/app/projects")}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={pending || blocking || totalFee === null || rowBad}>
            {pending ? "Creating…" : "Create project"}
          </Button>
        </div>
      </div>

    </form>
  );
}
