"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { AddressFields } from "@/components/address/address-fields";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { type FeeType, type SplitRow, distributeFee, distributeHours } from "@/lib/calc/projects";
import {
  CREATE_STATUSES,
  FEE_TYPE_HELP,
  FEE_TYPE_LABELS,
  PROJECT_MESSAGES,
  SCOPE_KINDS,
  SCOPE_LABELS,
  STANDARD_TYPES,
  STATUS_LABELS,
  type ScopeKind,
  moneyExact,
  moneyInput,
  parseMoney,
  phaseProblem,
} from "@/lib/projects/form";
import { saveCompany } from "@/server/contacts/actions";
import { createProject } from "@/server/projects/actions";
import type { NewProjectOptions } from "@/server/projects/view";

// New project (projects-list spec, "New project flow"). Card 1 is the
// project; Card 2 splits the total fee and budget hours over the firm's
// default phases. The server re-checks everything on Create.

type Row = {
  key: string;
  templateId: string | null;
  code: string;
  name: string;
  feeType: FeeType;
  shareBp: number;
  include: boolean;
  feeCents: number;
  feeText: string;
  feeEdited: boolean;
  hours: number;
  hoursText: string;
  hoursEdited: boolean;
};

const OTHER = "__other";
const NEW_CLIENT = "__new";

const hoursText = (h: number) => String(h);
function parseHours(raw: string): number | null {
  const v = raw.trim().replace(/,/g, "");
  if (v === "") return 0;
  if (!/^\d+(\.\d+)?$/.test(v)) return null;
  const n = Number(v);
  return Number.isInteger(n * 4) ? n : null;
}

/** Re-split fee and hours over included rows; edited rows keep theirs. */
function resplit(rows: Row[], totalCents: number, totalHours: number): { rows: Row[]; feeOver: boolean; hoursOver: boolean } {
  const included = rows.filter((r) => r.include);
  const asSplit = (r: Row, amount: number): SplitRow => ({ id: r.key, weightBp: r.shareBp, amount });
  const fee = distributeFee(
    totalCents,
    included.map((r) => asSplit(r, r.feeCents)),
    new Set(included.filter((r) => r.feeEdited).map((r) => r.key)),
  );
  const hrs = distributeHours(
    totalHours,
    included.map((r) => asSplit(r, r.hours)),
    new Set(included.filter((r) => r.hoursEdited).map((r) => r.key)),
  );
  const next = rows.map((r) => {
    if (!r.include) return r;
    const out = { ...r };
    if (fee.ok && !r.feeEdited) {
      out.feeCents = fee.amounts[r.key];
      out.feeText = moneyInput(out.feeCents);
    }
    if (hrs.ok && !r.hoursEdited) {
      out.hours = hrs.amounts[r.key];
      out.hoursText = hoursText(out.hours);
    }
    return out;
  });
  return { rows: next, feeOver: !fee.ok, hoursOver: !hrs.ok };
}

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
  const [clients, setClients] = useState(options.clients);
  const [d, setD] = useState({
    number: options.suggestedNumber,
    name: "",
    clientCompanyId: presetClientId && options.clients.some((c) => c.id === presetClientId) ? presetClientId : "",
    clientContactId: "",
    projectType: "",
    otherType: "",
    scopeKind: "" as ScopeKind | "",
    status: "active" as (typeof CREATE_STATUSES)[number],
    principalMembershipId: options.principals.length === 1 ? options.principals[0].membershipId : "",
    pmMembershipId: options.pms.some((p) => p.membershipId === viewerMembershipId) ? viewerMembershipId : "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    postalCode: "",
    squareFeet: "",
    construction: "",
    startDate: "",
    targetEndDate: "",
  });
  const set = (p: Partial<typeof d>) => setD((x) => ({ ...x, ...p }));
  const [totalFeeText, setTotalFeeText] = useState("0");
  const [totalHoursText, setTotalHoursText] = useState("0");
  const totalFee = parseMoney(totalFeeText);
  const totalHours = parseHours(totalHoursText);

  const [split, setSplit] = useState(() =>
    resplit(
      options.templates.map((t) => ({
        key: t.id,
        templateId: t.id,
        code: t.code,
        name: t.name,
        feeType: t.feeType,
        shareBp: t.shareBp,
        include: true,
        feeCents: 0,
        feeText: "0",
        feeEdited: false,
        hours: 0,
        hoursText: "0",
        hoursEdited: false,
      })),
      0,
      0,
    ),
  );
  const rows = split.rows;
  const update = (next: Row[], fee = totalFee ?? 0, hours = totalHours ?? 0) => setSplit(resplit(next, fee, hours));
  const editRow = (key: string, p: Partial<Row>) => update(rows.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [newClient, setNewClient] = useState<{ open: boolean; name: string; error: string | null }>({
    open: false,
    name: "",
    error: null,
  });

  const types = useMemo(
    () => [...new Set([...STANDARD_TYPES, ...options.types])].sort((a, b) => a.localeCompare(b)),
    [options.types],
  );
  const contacts = d.clientCompanyId ? (options.contactsByClient[d.clientCompanyId] ?? []) : [];
  const included = rows.filter((r) => r.include);
  const sumFee = included.reduce((n, r) => n + r.feeCents, 0);
  const sumHours = included.reduce((n, r) => n + Math.round(r.hours * 4), 0) / 4;
  const rowBad = rows.some((r) => r.include && (parseMoney(r.feeText) === null || parseHours(r.hoursText) === null));
  const problem =
    totalFee === null || totalHours === null || rowBad
      ? null
      : phaseProblem({
          totalFeeCents: totalFee,
          totalBudgetHours: totalHours,
          phases: included.map((r) => ({ feeType: r.feeType, feeCents: r.feeCents, budgetHours: r.hours })),
        });
  // The NTE cap is reported on Create (spec); sum problems block the button.
  const blocking = problem !== null && problem !== PROJECT_MESSAGES.nteCap;
  const feeMismatch = totalFee !== null && sumFee !== totalFee;
  const hoursMismatch = totalHours !== null && Math.round(sumHours * 4) !== Math.round(totalHours * 4);
  const shownTypes = new Set(included.map((r) => r.feeType));

  function submit() {
    setFormError(null);
    const projectType = d.projectType === OTHER ? d.otherType.trim() : d.projectType;
    const construction = d.construction.trim() === "" ? null : parseMoney(d.construction);
    const local: Record<string, string> = {};
    if (d.projectType === OTHER && (projectType.length < 1 || projectType.length > 60)) local.projectType = "Enter a type (up to 60 characters)";
    if (construction === null && d.construction.trim() !== "") local.constructionCostCents = PROJECT_MESSAGES.money;
    if (totalFee === null) local.totalFeeCents = PROJECT_MESSAGES.money;
    if (totalHours === null) local.totalBudgetHours = PROJECT_MESSAGES.hours;
    const sqft = d.squareFeet.trim() === "" ? null : Number(d.squareFeet.replace(/,/g, ""));
    if (sqft !== null && !(Number.isInteger(sqft) && sqft > 0)) local.squareFeet = PROJECT_MESSAGES.squareFeet;
    if (problem === PROJECT_MESSAGES.nteCap) local.phases = problem;
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    startTransition(async () => {
      const result = await createProject({
        number: d.number,
        name: d.name,
        clientCompanyId: d.clientCompanyId,
        clientContactId: d.clientContactId || null,
        projectType,
        scopeKind: d.scopeKind || null,
        status: d.status,
        principalMembershipId: d.principalMembershipId,
        pmMembershipId: d.pmMembershipId,
        addressLine1: d.addressLine1,
        addressLine2: d.addressLine2,
        city: d.city,
        state: d.state,
        postalCode: d.postalCode,
        squareFeet: sqft,
        constructionCostCents: construction,
        startDate: d.startDate,
        targetEndDate: d.targetEndDate,
        totalFeeCents: totalFee,
        totalBudgetHours: totalHours,
        phases: included.map((r) => ({
          templateId: r.templateId,
          code: r.code,
          name: r.name,
          feeType: r.feeType,
          feeCents: r.feeCents,
          budgetHours: r.hours,
        })),
      });
      if (!result.ok) {
        setErrors((result.fieldErrors ?? {}) as Record<string, string>);
        setFormError(result.error ?? (result.fieldErrors ? "Fix the fields marked in red." : null));
        return;
      }
      router.push(`/app/projects/${result.data.id}?created=${encodeURIComponent(result.data.number)}`);
    });
  }

  function addClient() {
    const name = newClient.name.trim();
    if (!name) {
      setNewClient((x) => ({ ...x, error: "Enter a name" }));
      return;
    }
    startTransition(async () => {
      const r = await saveCompany({
        id: null,
        name,
        kind: "client",
        description: "",
        phone: "",
        website: "",
        addressLine1: "",
        addressLine2: "",
        city: "",
        state: "",
        postalCode: "",
        primaryContactId: null,
        billingContactId: null,
        notes: "",
      });
      if (!r.ok) {
        setNewClient((x) => ({ ...x, error: r.fieldErrors?.name ?? r.error ?? "Couldn't add the client." }));
        return;
      }
      setClients((c) => [...c, { id: r.data.id, name }].sort((a, b) => a.name.localeCompare(b.name)));
      set({ clientCompanyId: r.data.id, clientContactId: "" });
      setNewClient({ open: false, name: "", error: null });
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
        <fieldset className="m-0 border-0 p-0">
          <legend className="cap float-left mb-3 w-full text-xs font-semibold text-ink-2">Project</legend>
          <div className="clear-both grid grid-cols-1 gap-4 md:grid-cols-3">
            <Input label="Project number *" value={d.number} maxLength={20} onChange={(ev) => set({ number: ev.target.value })} error={e("number")} required />
          <Input label="Project name *" value={d.name} maxLength={200} onChange={(ev) => set({ name: ev.target.value })} error={e("name")} wrapperClassName="md:col-span-2" required />
          <Select label="Status" value={d.status} onChange={(ev) => set({ status: ev.target.value as typeof d.status })}>
            {CREATE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          <Select label="Project type *" value={d.projectType} error={d.projectType === OTHER ? undefined : e("projectType")} onChange={(ev) => set({ projectType: ev.target.value })}>
            <option value="">Choose a type…</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
            <option value={OTHER}>Other…</option>
          </Select>
          {d.projectType === OTHER && (
            <Input label="Other type *" value={d.otherType} maxLength={60} onChange={(ev) => set({ otherType: ev.target.value })} error={e("projectType")} />
          )}
          <Select label="Scope" value={d.scopeKind} onChange={(ev) => set({ scopeKind: ev.target.value as ScopeKind | "" })}>
            <option value="">—</option>
            {SCOPE_KINDS.map((s) => (
              <option key={s} value={s}>
                {SCOPE_LABELS[s]}
              </option>
            ))}
          </Select>
          </div>
        </fieldset>
        <fieldset className="m-0 mt-6 border-0 border-t border-line-soft p-0 pt-5">
          <legend className="cap float-left mb-3 w-full text-xs font-semibold text-ink-2">Client</legend>
          <div className="clear-both grid grid-cols-1 gap-4 md:grid-cols-2">
            <Select
            label="Client *"
            value={d.clientCompanyId}
            error={e("clientCompanyId")}
            onChange={(ev) => {
              if (ev.target.value === NEW_CLIENT) setNewClient({ open: true, name: "", error: null });
              else set({ clientCompanyId: ev.target.value, clientContactId: "" });
            }}
          >
            <option value="">Choose a client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value={NEW_CLIENT}>+ New client…</option>
          </Select>
          <Select
            label="Client contact"
            value={d.clientContactId}
            disabled={!d.clientCompanyId}
            error={e("clientContactId")}
            onChange={(ev) => set({ clientContactId: ev.target.value })}
          >
            <option value="">{d.clientCompanyId && contacts.length === 0 ? "No contacts at this client" : "None"}</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          </div>
        </fieldset>
        <fieldset className="m-0 mt-6 border-0 border-t border-line-soft p-0 pt-5">
          <legend className="cap float-left mb-3 w-full text-xs font-semibold text-ink-2">People</legend>
          <div className="clear-both grid grid-cols-1 gap-4 md:grid-cols-2">
            <Select label="Principal in charge *" value={d.principalMembershipId} error={e("principalMembershipId")} onChange={(ev) => set({ principalMembershipId: ev.target.value })}>
            <option value="">Choose…</option>
            {options.principals.map((p) => (
              <option key={p.membershipId} value={p.membershipId}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select label="Project manager *" value={d.pmMembershipId} error={e("pmMembershipId")} onChange={(ev) => set({ pmMembershipId: ev.target.value })}>
            <option value="">Choose…</option>
            {options.pms.map((p) => (
              <option key={p.membershipId} value={p.membershipId}>
                {p.name}
              </option>
            ))}
          </Select>
          </div>
        </fieldset>
        <fieldset className="m-0 mt-6 border-0 border-t border-line-soft p-0 pt-5">
          <legend className="cap float-left mb-3 w-full text-xs font-semibold text-ink-2">Site address</legend>
          <div className="clear-both">
            <AddressFields
              lookup={addressLookup}
              value={{ addressLine1: d.addressLine1, addressLine2: d.addressLine2, city: d.city, state: d.state, postalCode: d.postalCode }}
              onChange={(patch) => set(patch)}
              errors={{ addressLine1: e("addressLine1"), addressLine2: e("addressLine2"), city: e("city"), state: e("state"), postalCode: e("postalCode") }}
            />
          </div>
        </fieldset>
        <fieldset className="m-0 mt-6 border-0 border-t border-line-soft p-0 pt-5">
          <legend className="cap float-left mb-3 w-full text-xs font-semibold text-ink-2">Size & schedule</legend>
          <div className="clear-both grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input label="Square feet" value={d.squareFeet} inputMode="numeric" onChange={(ev) => set({ squareFeet: ev.target.value })} error={e("squareFeet")} />
          <Input label="Construction estimate" value={d.construction} inputMode="decimal" placeholder="$" onChange={(ev) => set({ construction: ev.target.value })} error={e("constructionCostCents")} />
          <Input label="Start date" type="date" value={d.startDate} onChange={(ev) => set({ startDate: ev.target.value })} error={e("startDate")} />
          <Input label="Target end" type="date" value={d.targetEndDate} onChange={(ev) => set({ targetEndDate: ev.target.value })} error={e("targetEndDate")} />
          </div>
        </fieldset>
      </Card>

      <Card title="Phases & fees" padded={false}>
        <div className="flex flex-wrap gap-4 px-[var(--spacing-card)] pb-4">
          <Input
            label="Total fee *"
            value={totalFeeText}
            inputMode="decimal"
            wrapperClassName="w-[200px]"
            error={totalFee === null ? PROJECT_MESSAGES.money : e("totalFeeCents")}
            onChange={(ev) => {
              setTotalFeeText(ev.target.value);
              const v = parseMoney(ev.target.value);
              if (v !== null) update(rows, v, totalHours ?? 0);
            }}
          />
          <Input
            label="Total budget hours"
            value={totalHoursText}
            inputMode="decimal"
            wrapperClassName="w-[200px]"
            error={totalHours === null ? PROJECT_MESSAGES.hours : e("totalBudgetHours")}
            onChange={(ev) => {
              setTotalHoursText(ev.target.value);
              const v = parseHours(ev.target.value);
              if (v !== null) update(rows, totalFee ?? 0, v);
            }}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-sm">
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
              {rows.map((r) => (
                <tr key={r.key} data-phase={r.code} className={cn(!r.include && "opacity-50")}>
                  <td className={cn(cell, "pl-[18px]")}>
                    <input
                      type="checkbox"
                      aria-label={`Include ${r.name}`}
                      checked={r.include}
                      onChange={(ev) =>
                        editRow(r.key, { include: ev.target.checked, feeEdited: false, hoursEdited: false })
                      }
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
                    <select aria-label={`${r.name} fee type`} value={r.feeType} disabled={!r.include} onChange={(ev) => editRow(r.key, { feeType: ev.target.value as FeeType })} className="h-8 rounded-sm border border-line-input bg-surface px-1.5">
                      {(Object.keys(FEE_TYPE_LABELS) as FeeType[]).map((t) => (
                        <option key={t} value={t}>
                          {FEE_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={cn(cell, "num text-right text-ink-3")}>{r.shareBp / 100}%</td>
                  <td className={cn(cell, "text-right")}>
                    <span className="inline-flex items-center gap-1.5">
                      {r.feeEdited && <span aria-label="edited" role="img" className="size-1.5 rounded-full bg-blue" />}
                      <input
                        aria-label={`${r.name} fee`}
                        value={r.feeText}
                        inputMode="decimal"
                        disabled={!r.include}
                        aria-invalid={parseMoney(r.feeText) === null || undefined}
                        onChange={(ev) => {
                          const v = parseMoney(ev.target.value);
                          const next = rows.map((x) =>
                            x.key === r.key
                              ? { ...x, feeText: ev.target.value, ...(v !== null ? { feeCents: v, feeEdited: true } : {}) }
                              : x,
                          );
                          update(next);
                        }}
                        className="num h-8 w-[120px] rounded-sm border border-line-input bg-surface px-2 text-right aria-[invalid=true]:border-red"
                      />
                    </span>
                  </td>
                  <td className={cn(cell, "pr-[18px] text-right")}>
                    <span className="inline-flex items-center gap-1.5">
                      {r.hoursEdited && <span aria-label="edited" role="img" className="size-1.5 rounded-full bg-blue" />}
                      <input
                        aria-label={`${r.name} budget hours`}
                        value={r.hoursText}
                        inputMode="decimal"
                        disabled={!r.include}
                        aria-invalid={parseHours(r.hoursText) === null || undefined}
                        onChange={(ev) => {
                          const v = parseHours(ev.target.value);
                          const next = rows.map((x) =>
                            x.key === r.key
                              ? { ...x, hoursText: ev.target.value, ...(v !== null ? { hours: v, hoursEdited: true } : {}) }
                              : x,
                          );
                          update(next);
                        }}
                        className="num h-8 w-[90px] rounded-sm border border-line-input bg-surface px-2 text-right aria-[invalid=true]:border-red"
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td colSpan={5} className="px-2 py-2.5 pl-[18px]">
                  Total
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
              onClick={() => update(rows.map((r) => ({ ...r, feeEdited: false, hoursEdited: false })))}
            >
              Reset to template split
            </button>
          </div>
          {(split.feeOver || feeMismatch || split.hoursOver || hoursMismatch || e("phases")) && (
            <div role="alert" className="flex flex-wrap items-center gap-3 text-red">
              <span>{e("phases") ?? problem}</span>
              {feeMismatch && (
                <Button
                  type="button"
                  onClick={() => {
                    setTotalFeeText(moneyInput(sumFee));
                    update(rows, sumFee, totalHours ?? 0);
                  }}
                >
                  Use {moneyExact(sumFee)} as total
                </Button>
              )}
              {!feeMismatch && hoursMismatch && (
                <Button
                  type="button"
                  onClick={() => {
                    setTotalHoursText(hoursText(sumHours));
                    update(rows, totalFee ?? 0, sumHours);
                  }}
                >
                  Use {sumHours} h as total
                </Button>
              )}
            </div>
          )}
          <ul className="m-0 list-none p-0 text-xs text-muted">
            {(Object.keys(FEE_TYPE_HELP) as FeeType[])
              .filter((t) => shownTypes.has(t))
              .map((t) => (
                <li key={t}>{FEE_TYPE_HELP[t]}</li>
              ))}
          </ul>
        </div>
      </Card>

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
          <Button type="submit" variant="primary" disabled={pending || blocking || totalFee === null || totalHours === null || rowBad}>
            {pending ? "Creating…" : "Create project"}
          </Button>
        </div>
      </div>

      <Dialog open={newClient.open} onOpenChange={(o) => !o && setNewClient({ open: false, name: "", error: null })}>
        <DialogContent
          title="New client"
          footer={
            <>
              <Button type="button" onClick={() => setNewClient({ open: false, name: "", error: null })}>
                Cancel
              </Button>
              <Button type="button" variant="primary" disabled={pending} onClick={addClient}>
                Add client
              </Button>
            </>
          }
        >
          <Input
            label="Name"
            value={newClient.name}
            maxLength={200}
            error={newClient.error ?? undefined}
            onChange={(ev) => setNewClient((x) => ({ ...x, name: ev.target.value, error: null }))}
            onKeyDown={(ev) => {
              if (ev.key === "Enter") {
                ev.preventDefault();
                addClient();
              }
            }}
          />
        </DialogContent>
      </Dialog>
    </form>
  );
}
