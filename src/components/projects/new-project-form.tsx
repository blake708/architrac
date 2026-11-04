"use client";

import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PlusIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { mixHours } from "@/lib/calc/phase-edit";
import {
  type FeeType,
  type PhaseEdit,
  hoursFromFee,
  planPhaseFees,
} from "@/lib/calc/projects";
import { formatMoney } from "@/lib/format";
import {
  CREATE_STATUSES,
  FEE_TYPE_HELP,
  FEE_TYPE_LABELS,
  PROJECT_MESSAGES,
  createProjectSchema,
  moneyExact,
  moneyInput,
  parseMoney,
  phaseProblem,
} from "@/lib/projects/form";
import { createProject } from "@/server/projects/actions";
import type { CompanyChoice } from "@/server/projects/page";
import type { NewProjectOptions } from "@/server/projects/view";
import { EstimateCard } from "./estimate-card";
import { InlineRoles, rolesReady } from "./inline-roles";
import {
  type ConsultantDraft,
  NewConsultants,
  checkConsultants,
  consultantsPayload,
} from "./new-consultants";
import {
  EMPTY_DRAFT,
  ProjectFields,
  type ProjectDraft,
  checkDraft,
} from "./project-fields";
import type { MixRow } from "./role-mix-panel";

// New project (projects-list spec, "New project flow"), in two steps (Blake,
// 2026-11-04):
//   1. Project details on the left, the firm's phases to include on the right.
//   2. The estimate, the checked phases with editable % and fees, roles and
//      hours under each phase, custom phases, and consultant fees.
// The fee split works as before: checked phases total 100%, hours come from
// each role's bill rate (or the blended rate). The server re-checks
// everything on Create.

type Row = {
  key: string;
  templateId: string | null;
  code: string;
  name: string;
  description: string | null;
  isOptional: boolean;
  /** Added on step 2, not from a template. */
  custom: boolean;
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

/** Step 1's fields: a server error on one of these sends you back there. */
const STEP_ONE = new Set([
  "number",
  "name",
  "clientCompanyId",
  "clientContactId",
  "projectType",
  "scopeKind",
  "status",
  "principalMembershipId",
  "pmMembershipId",
  "addressLine1",
  "addressLine2",
  "city",
  "state",
  "postalCode",
  "squareFeet",
  "constructionCostCents",
  "startDate",
  "targetEndDate",
]);

export function NewProjectForm({
  options,
  consultantChoices,
  viewerMembershipId,
  presetClientId,
  addressLookup,
  canEditSettings,
}: {
  options: NewProjectOptions;
  consultantChoices: CompanyChoice[];
  viewerMembershipId: string;
  presetClientId: string | null;
  /** Google address lookup is set up (GOOGLE_MAPS_API_KEY). */
  addressLookup: boolean;
  /** Owner/admin: the estimate links to Settings → Phases. */
  canEditSettings: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<1 | 2>(1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [d, setD] = useState<ProjectDraft>(() => ({
    ...EMPTY_DRAFT,
    number: options.suggestedNumber,
    clientCompanyId:
      presetClientId && options.clients.some((c) => c.id === presetClientId)
        ? presetClientId
        : "",
    principalMembershipId:
      options.principals.length === 1 ? options.principals[0].membershipId : "",
    pmMembershipId: options.pms.some(
      (p) => p.membershipId === viewerMembershipId,
    )
      ? viewerMembershipId
      : "",
  }));
  const set = (p: Partial<typeof d>) => {
    setD((x) => ({ ...x, ...p }));
    // A field's error goes away as soon as it's edited.
    const keys = Object.keys(p).flatMap((k) => (k === "construction" ? ["constructionCostCents"] : k === "otherType" ? ["projectType"] : [k]));
    setErrors((er) => (keys.some((k) => k in er) ? Object.fromEntries(Object.entries(er).filter(([k]) => !keys.includes(k))) : er));
  };
  const [totalFeeText, setTotalFeeText] = useState("0");
  const totalFee = parseMoney(totalFeeText);
  const rate = options.blendedBillRateCents;

  const [rows, setRows] = useState<Row[]>(() =>
    options.templates.map((t) => ({
      key: t.id,
      templateId: t.id,
      code: t.code,
      name: t.name,
      description: t.description,
      isOptional: t.isOptional,
      custom: false,
      feeType: t.feeType,
      weightBp: t.shareBp,
      // Standard phases start checked; optional ones (e.g. Additional Services) don't.
      include: !t.isOptional,
      edit: null,
      hoursEdit: null,
      mix: t.mix,
      draft: {},
    })),
  );
  const [consultants, setConsultants] = useState<ConsultantDraft[]>([]);
  const editRow = (key: string, p: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const draft = (key: string, p: Row["draft"]) =>
    setRows((rs) =>
      rs.map((r) =>
        r.key === key ? { ...r, draft: { ...r.draft, ...p } } : r,
      ),
    );
  const rateOf = (roleId: string) =>
    options.roles.find((x) => x.id === roleId)?.billCents ?? 0;

  // Fees and % from the total; hours from each fee by role (or the blended rate).
  const plan = useMemo(
    () =>
      planPhaseFees(
        totalFee ?? 0,
        rows.map((r) => ({
          id: r.key,
          include: r.include,
          feeType: r.feeType,
          weightBp: r.weightBp,
          edit: r.edit,
        })),
      ),
    [rows, totalFee],
  );
  const hoursOf = (r: Row) => {
    if (!r.include) return 0;
    if (r.hoursEdit !== null) return r.hoursEdit;
    if (r.feeType === "hourly") return 0;
    if (r.mix.length)
      return mixHours(
        plan.fees[r.key],
        r.mix.map((m) => ({
          roleId: m.firmRoleId,
          shareBp: m.shareBp,
          rateCents: rateOf(m.firmRoleId),
        })),
      ).total;
    return hoursFromFee(plan.fees[r.key], rate) ?? 0;
  };

  const included = rows.filter((r) => r.include);
  const sumFee = plan.sumCents;
  const sumHours =
    included.reduce((n, r) => n + Math.round(hoursOf(r) * 4), 0) / 4;
  const rowBad = rows.some(
    (r) =>
      (r.draft.fee !== undefined && parseMoney(r.draft.fee) === null) ||
      (r.draft.pct !== undefined && parsePct(r.draft.pct) === null) ||
      (r.draft.hours !== undefined && parseHours(r.draft.hours) === null),
  );
  const codeCount = new Map<string, number>();
  for (const r of included)
    codeCount.set(
      r.code.trim().toLowerCase(),
      (codeCount.get(r.code.trim().toLowerCase()) ?? 0) + 1,
    );
  const dupCode = (r: Row) =>
    (codeCount.get(r.code.trim().toLowerCase()) ?? 0) > 1;
  const blankName = included.some((r) => !r.code.trim() || !r.name.trim());
  const rolesBad = included.some(
    (r) => r.feeType !== "hourly" && !rolesReady(r.mix),
  );
  const problem =
    totalFee === null || rowBad
      ? null
      : included.some(dupCode)
        ? PROJECT_MESSAGES.codeUsed
        : phaseProblem({
            totalFeeCents: totalFee,
            totalBudgetHours: sumHours,
            phases: included.map((r) => ({
              feeType: r.feeType,
              feeCents: plan.fees[r.key],
              budgetHours: hoursOf(r),
            })),
          });
  // The NTE cap is reported on Create (spec); other problems block the button.
  const blocking =
    (problem !== null && problem !== PROJECT_MESSAGES.nteCap) ||
    blankName ||
    rolesBad;
  const feeMismatch = totalFee !== null && sumFee !== totalFee;
  const sumPct = totalFee ? Math.round((sumFee * 10_000) / totalFee) : 0;
  const shownTypes = new Set(included.map((r) => r.feeType));
  const { fields, errors: draftErrors } = checkDraft(d);

  /** Step 1's checks: the server's own rules for the project fields, plus at least one phase. */
  function stepOneErrors() {
    const local: Record<string, string> = { ...draftErrors };
    const parsed = createProjectSchema.safeParse({
      ...fields,
      totalFeeCents: 0,
      totalBudgetHours: 0,
      phases: [],
      consultants: [],
    });
    if (!parsed.success)
      for (const i of parsed.error.issues) {
        const k = String(i.path[0]);
        if (STEP_ONE.has(k)) local[k] ??= i.message;
      }
    if (included.length === 0) local.pickPhases = PROJECT_MESSAGES.noPhases;
    return local;
  }

  function next() {
    const local = stepOneErrors();
    setErrors(local);
    if (Object.keys(local).length) return;
    setStep(2);
    window.scrollTo({ top: 0 });
  }

  function submit() {
    setFormError(null);
    const local: Record<string, string> = { ...checkConsultants(consultants) };
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
          code: r.code.trim(),
          name: r.name.trim(),
          feeType: r.feeType,
          feeCents: plan.fees[r.key],
          budgetHours: hoursOf(r),
          budgetHoursManual: r.hoursEdit !== null,
          mix: r.feeType === "hourly" ? [] : r.mix,
        })),
        consultants: consultantsPayload(consultants),
      });
      if (!result.ok) {
        const fe = (result.fieldErrors ?? {}) as Record<string, string>;
        setErrors(fe);
        if (Object.keys(fe).some((k) => STEP_ONE.has(k))) setStep(1);
        setFormError(
          result.error ??
            (Object.keys(fe).length ? "Fix the fields marked in red." : null),
        );
        return;
      }
      router.push(`/app/projects/${result.data.id}`);
    });
  }

  const e = (k: string) => errors[k];
  const cell = "border-b border-line-soft px-2 py-1.5";
  const dot = (
    <span
      aria-label="edited"
      role="img"
      className="size-1.5 rounded-full bg-blue"
    />
  );

  return (
    <form
      className="flex flex-col gap-5 px-4 pt-6 md:px-page-x"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (step === 1) next();
        else submit();
      }}
      noValidate
    >
      <p
        className="cap m-0 text-xs font-semibold text-muted"
        data-testid="step"
      >
        Step {step} of 2 ·{" "}
        {step === 1 ? "Project and phases" : "Fees, roles and consultants"}
      </p>

      {step === 1 && (
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,720px)_minmax(280px,420px)]">
          <Card title="Project details">
            <ProjectFields
              value={d}
              onChange={set}
              errors={errors}
              options={options}
              statuses={CREATE_STATUSES}
              addressLookup={addressLookup}
            />
          </Card>
          <Card
            title="Phases"
            description="Check the phases this project includes. Fees come next."
          >
            <fieldset className="m-0 border-0 p-0">
              <legend className="sr-only">Phases to include</legend>
              <ul className="m-0 flex list-none flex-col gap-0 p-0">
                {rows
                  .filter((r) => !r.custom)
                  .map((r) => (
                    <li
                      key={r.key}
                      className="border-b border-line-soft py-2.5 last:border-b-0"
                    >
                      <label className="flex cursor-pointer items-start gap-2.5">
                        <input
                          type="checkbox"
                          checked={r.include}
                          onChange={(ev) =>
                            editRow(r.key, {
                              include: ev.target.checked,
                              edit: null,
                              hoursEdit: null,
                              draft: {},
                            })
                          }
                          className="mt-0.5 size-4 shrink-0 cursor-pointer accent-ink"
                        />
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="text-sm">
                            <span className="num text-muted">{r.code}</span>{" "}
                            <span className="ml-1 font-medium">{r.name}</span>
                            {r.isOptional && (
                              <span className="cap ml-2 text-2xs font-medium text-muted">
                                Optional
                              </span>
                            )}
                          </span>
                          {r.description && (
                            <span className="text-xs text-muted">
                              {r.description}
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  ))}
              </ul>
              {rows.every((r) => r.custom) && (
                <p className="m-0 text-sm text-muted">
                  No phases set up yet. Add custom phases on the next step.
                </p>
              )}
            </fieldset>
            {e("pickPhases") && (
              <p role="alert" className="m-0 mt-2 text-sm text-red">
                {e("pickPhases")}
              </p>
            )}
            <p className="m-0 mt-3 text-xs text-muted">
              You can add custom phases on the next step.
            </p>
          </Card>
        </div>
      )}

      {step === 2 && (
        <>
          <EstimateCard
            sources={options.benchmarks}
            projectType={fields.projectType}
            scopeKind={fields.scopeKind}
            squareFeet={fields.squareFeet}
            constructionCents={fields.constructionCostCents}
            totalFeeCents={totalFee}
            canEditSettings={canEditSettings}
            onUseConstruction={(cents) =>
              set({ construction: moneyInput(cents) })
            }
            onUseFee={(cents) => {
              // Spread the fee over the checked phases by their template shares.
              setRows((rs) =>
                rs.map((r) => ({
                  ...r,
                  edit: null,
                  hoursEdit: r.feeType === "hourly" ? r.hoursEdit : null,
                  draft: {},
                })),
              );
              setTotalFeeText(moneyInput(cents));
            }}
          />

          <Card title="Phases & fees" padded={false}>
            <div className="flex flex-wrap items-end gap-6 px-[var(--spacing-card)] pb-4">
              <label className="flex w-[200px] flex-col gap-1.5">
                <span className="cap text-xs font-medium text-ink-2">
                  Total fee *
                </span>
                <input
                  value={totalFeeText}
                  inputMode="decimal"
                  aria-invalid={
                    totalFee === null || !!e("totalFeeCents") || undefined
                  }
                  onChange={(ev) => setTotalFeeText(ev.target.value)}
                  className="num h-9 rounded-sm border border-line-input bg-surface px-2.5 text-right aria-[invalid=true]:border-red"
                />
                {(totalFee === null || e("totalFeeCents")) && (
                  <span className="text-[12.5px] text-red">
                    {PROJECT_MESSAGES.money}
                  </span>
                )}
              </label>
              <div className="flex flex-col gap-1.5 pb-2">
                <span className="cap text-xs font-medium text-muted">
                  Total budget hours
                </span>
                <span className="num text-base" data-testid="hours-total">
                  {sumHours}
                </span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] border-collapse text-sm">
                <thead className="bg-surface-2">
                  <tr className="text-left text-2xs font-medium text-muted">
                    <th
                      scope="col"
                      className="cap border-b border-line px-2 py-2 pl-[18px]"
                    >
                      Code
                    </th>
                    <th
                      scope="col"
                      className="cap border-b border-line px-2 py-2"
                    >
                      Name
                    </th>
                    <th
                      scope="col"
                      className="cap border-b border-line px-2 py-2"
                    >
                      Fee type
                    </th>
                    <th
                      scope="col"
                      className="cap border-b border-line px-2 py-2 text-right"
                    >
                      Share
                    </th>
                    <th
                      scope="col"
                      className="cap border-b border-line px-2 py-2 text-right"
                    >
                      Fee
                    </th>
                    <th
                      scope="col"
                      className="cap border-b border-line px-2 py-2 text-right"
                    >
                      Budget hours
                    </th>
                    <th
                      scope="col"
                      className="cap border-b border-line px-2 py-2 pr-[18px]"
                    >
                      <span className="sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {included.map((r) => {
                    const split = r.feeType !== "hourly";
                    const label = r.name.trim() || "New phase";
                    return (
                      <Fragment key={r.key}>
                        <tr data-phase={r.code}>
                          <td className={cn(cell, "pl-[18px]")}>
                            <input
                              aria-label={`${label} code`}
                              value={r.code}
                              maxLength={12}
                              aria-invalid={
                                dupCode(r) || !r.code.trim() || undefined
                              }
                              onChange={(ev) =>
                                editRow(r.key, { code: ev.target.value })
                              }
                              className="h-8 w-[70px] rounded-sm border border-line-input bg-surface px-2 aria-[invalid=true]:border-red"
                            />
                          </td>
                          <td className={cell}>
                            <input
                              aria-label={
                                r.custom ? "New phase name" : `${r.code} name`
                              }
                              value={r.name}
                              maxLength={80}
                              aria-invalid={!r.name.trim() || undefined}
                              onChange={(ev) =>
                                editRow(r.key, { name: ev.target.value })
                              }
                              className="h-8 w-full min-w-[180px] rounded-sm border border-line-input bg-surface px-2 aria-[invalid=true]:border-red"
                            />
                          </td>
                          <td className={cell}>
                            <select
                              aria-label={`${label} fee type`}
                              value={r.feeType}
                              onChange={(ev) => {
                                const feeType = ev.target.value as FeeType;
                                // Hourly phases leave the split; their hours are typed.
                                editRow(r.key, {
                                  feeType,
                                  edit: feeType === "hourly" ? null : r.edit,
                                  hoursEdit: null,
                                  draft: {},
                                });
                              }}
                              className="h-8 rounded-sm border border-line-input bg-surface px-1.5"
                            >
                              {(Object.keys(FEE_TYPE_LABELS) as FeeType[]).map(
                                (t) => (
                                  <option key={t} value={t}>
                                    {FEE_TYPE_LABELS[t]}
                                  </option>
                                ),
                              )}
                            </select>
                          </td>
                          <td className={cn(cell, "text-right")}>
                            <span className="inline-flex items-center gap-1.5">
                              {r.edit?.kind === "pct" && dot}
                              <input
                                aria-label={`${label} share`}
                                value={
                                  r.draft.pct ?? pctText(plan.shares[r.key])
                                }
                                inputMode="decimal"
                                disabled={!split}
                                aria-invalid={
                                  (r.draft.pct !== undefined &&
                                    parsePct(r.draft.pct) === null) ||
                                  undefined
                                }
                                onChange={(ev) => {
                                  const bp = parsePct(ev.target.value);
                                  editRow(r.key, {
                                    draft: { pct: ev.target.value },
                                    ...(bp !== null
                                      ? {
                                          edit: { kind: "pct" as const, bp },
                                          hoursEdit: null,
                                        }
                                      : {}),
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
                                aria-label={`${label} fee`}
                                value={
                                  r.draft.fee ?? moneyInput(plan.fees[r.key])
                                }
                                inputMode="decimal"
                                disabled={!split}
                                aria-invalid={
                                  (r.draft.fee !== undefined &&
                                    parseMoney(r.draft.fee) === null) ||
                                  undefined
                                }
                                onChange={(ev) => {
                                  const v = parseMoney(ev.target.value);
                                  editRow(r.key, {
                                    draft: { fee: ev.target.value },
                                    ...(v !== null
                                      ? {
                                          edit: {
                                            kind: "fee" as const,
                                            cents: v,
                                          },
                                          hoursEdit: null,
                                        }
                                      : {}),
                                  });
                                }}
                                onBlur={() => draft(r.key, { fee: undefined })}
                                className="num h-8 w-[120px] rounded-sm border border-line-input bg-surface px-2 text-right aria-[invalid=true]:border-red"
                              />
                            </span>
                          </td>
                          <td className={cn(cell, "text-right")}>
                            <span className="inline-flex items-center gap-1.5">
                              {r.hoursEdit !== null &&
                                r.feeType !== "hourly" &&
                                dot}
                              <input
                                aria-label={`${label} budget hours`}
                                value={r.draft.hours ?? String(hoursOf(r))}
                                inputMode="decimal"
                                aria-invalid={
                                  (r.draft.hours !== undefined &&
                                    parseHours(r.draft.hours) === null) ||
                                  undefined
                                }
                                onChange={(ev) => {
                                  const v = parseHours(ev.target.value);
                                  editRow(r.key, {
                                    draft: {
                                      ...r.draft,
                                      hours: ev.target.value,
                                    },
                                    ...(v !== null ? { hoursEdit: v } : {}),
                                  });
                                }}
                                onBlur={() =>
                                  draft(r.key, { hours: undefined })
                                }
                                className="num h-8 w-[90px] rounded-sm border border-line-input bg-surface px-2 text-right aria-[invalid=true]:border-red"
                              />
                            </span>
                          </td>
                          <td className={cn(cell, "pr-[18px] text-right")}>
                            {r.custom && (
                              <Button
                                type="button"
                                variant="ghost"
                                aria-label={`Remove ${label}`}
                                onClick={() =>
                                  setRows((rs) =>
                                    rs.filter((x) => x.key !== r.key),
                                  )
                                }
                              >
                                Remove
                              </Button>
                            )}
                          </td>
                        </tr>
                        {split && (
                          <tr data-roles-for={r.code}>
                            <td
                              colSpan={7}
                              className="border-b border-line-soft px-[18px] pt-1 pb-3 pl-[34px]"
                            >
                              <InlineRoles
                                phaseName={label}
                                feeCents={plan.fees[r.key]}
                                mix={r.mix}
                                roles={options.roles}
                                // A new mix sets the hours again, unless they were typed in.
                                onChange={(mix) =>
                                  editRow(r.key, {
                                    mix,
                                    hoursEdit: null,
                                    draft: {},
                                  })
                                }
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td colSpan={3} className="px-2 py-2.5 pl-[18px]">
                      Total
                    </td>
                    <td
                      className="num px-2 py-2.5 pr-6 text-right"
                      data-testid="share-sum"
                    >
                      {pctText(sumPct)}%
                    </td>
                    <td
                      className="num px-2 py-2.5 text-right"
                      data-testid="fee-sum"
                    >
                      {moneyExact(sumFee)}
                    </td>
                    <td
                      className="num px-2 py-2.5 text-right"
                      data-testid="hours-sum"
                    >
                      {sumHours}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="flex flex-col gap-2 px-[var(--spacing-card)] py-4 text-sm">
              <div className="flex flex-wrap items-center gap-4">
                <Button
                  type="button"
                  icon={<PlusIcon />}
                  onClick={() =>
                    setRows((rs) => [
                      ...rs,
                      {
                        key: `custom-${Date.now()}`,
                        templateId: null,
                        code: "",
                        name: "",
                        description: null,
                        isOptional: false,
                        custom: true,
                        feeType: "fixed",
                        weightBp: 0,
                        include: true,
                        edit: { kind: "fee", cents: 0 },
                        hoursEdit: null,
                        mix: [],
                        draft: {},
                      },
                    ])
                  }
                >
                  Add custom phase
                </Button>
                <button
                  type="button"
                  className="cursor-pointer border-0 bg-transparent p-0 text-blue underline"
                  onClick={() =>
                    setRows((rs) =>
                      rs.map((r) => ({
                        ...r,
                        edit: r.custom ? r.edit : null,
                        hoursEdit: r.feeType === "hourly" ? r.hoursEdit : null,
                        draft: {},
                      })),
                    )
                  }
                >
                  Reset to template split
                </button>
              </div>
              {(plan.over ||
                feeMismatch ||
                e("phases") ||
                blankName ||
                (problem && problem !== PROJECT_MESSAGES.nteCap)) && (
                <div
                  role="alert"
                  className="flex flex-wrap items-center gap-3 text-red"
                >
                  <span>
                    {e("phases") ??
                      problem ??
                      (blankName ? "Give every phase a code and a name" : null)}
                  </span>
                  {feeMismatch && (
                    <Button
                      type="button"
                      onClick={() => {
                        // Freeze %-edited phases at their dollars so the new total
                        // doesn't move them, then make the total match.
                        setRows((rs) =>
                          rs.map((r) =>
                            r.edit?.kind === "pct"
                              ? {
                                  ...r,
                                  edit: {
                                    kind: "fee",
                                    cents: plan.fees[r.key],
                                  },
                                }
                              : r,
                          ),
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
                  ? `Budget hours = each role's share of the phase fee ÷ its bill rate (type a % or hours on any role), or the blended bill rate (${formatMoney(rate)}/h) for phases with no roles, to the quarter hour. Type over any phase's hours.`
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

          <NewConsultants
            rows={consultants}
            onChange={setConsultants}
            choices={consultantChoices}
            defaultMarkupBp={options.defaultConsultantMarkupBp}
            archFeeCents={sumFee}
            errors={errors}
          />
        </>
      )}

      <div className="sticky bottom-0 z-10 -mx-4 border-t border-line bg-surface md:-mx-page-x">
        {formError && (
          <div
            role="alert"
            className="border-b border-red bg-red-tint px-4 py-2 text-sm text-red md:px-page-x"
          >
            {formError}
          </div>
        )}
        <div className="flex justify-end gap-2 px-4 py-3 md:px-page-x">
          {step === 1 ? (
            <>
              <Button
                type="button"
                onClick={() => router.push("/app/projects")}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                Next: fees
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                onClick={() => {
                  setStep(1);
                  window.scrollTo({ top: 0 });
                }}
              >
                Back
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={pending || blocking || totalFee === null || rowBad}
              >
                {pending ? "Creating…" : "Create project"}
              </Button>
            </>
          )}
        </div>
      </div>
    </form>
  );
}
