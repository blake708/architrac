"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { controlClasses } from "@/components/ui/field";
import { ChevronDownIcon, ChevronUpIcon, PlusIcon } from "@/components/ui/icons";
import { phaseTotalNote } from "@/lib/calc/rates";
import { cn } from "@/lib/cn";
import {
  FEE_TYPES,
  FEE_TYPE_LABELS,
  type FeeType,
  PHASE_MESSAGES,
  type PhaseErrors,
  type PhaseList,
  type PhaseRow,
  type PhasesForm,
  shareBarWidth,
  shareTotal,
  validatePhases,
} from "@/lib/settings/phases";
import { savePhases } from "@/server/settings/actions";
import { ErrorBanner } from "./error-banner";
import { useSettingsForm } from "./form-state";

const FORM_ID = "phases-form";

/** A row plus a key that stays put while the row is edited or moved. */
type Keyed = PhaseRow & { key: string };
type State = Record<PhaseList, Keyed[]>;

let nextKey = 0;
const withKeys = (f: PhasesForm): State => ({
  defaults: f.defaults.map((r) => ({ ...r, key: r.id ?? `new-${nextKey++}` })),
  optional: f.optional.map((r) => ({ ...r, key: r.id ?? `new-${nextKey++}` })),
});
const plain = (r: Keyed): PhaseRow => ({
  id: r.id,
  code: r.code,
  name: r.name,
  description: r.description,
  pct: r.pct,
  feeType: r.feeType,
});
const strip = (s: State): PhasesForm => ({
  defaults: s.defaults.map(plain),
  optional: s.optional.map(plain),
});

const smallInput = cn(controlClasses, "h-8 text-sm");
const iconButton =
  "inline-flex size-7 cursor-pointer items-center justify-center rounded-sm border border-line-input bg-surface text-ink-3 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-blue";

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="m-0 mt-1 text-[12.5px] text-red">
      {message}
    </p>
  );
}

/** Settings → Phases & fees (settings-rates-phases spec, section A). */
export function PhasesFormView({ initial }: { initial: PhasesForm }) {
  const router = useRouter();
  const [saved, setSaved] = useState(() => withKeys(initial));
  const [rows, setRows] = useState(saved);
  const [errors, setErrors] = useState<PhaseErrors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = useMemo(
    () => JSON.stringify(strip(rows)) !== JSON.stringify(strip(saved)),
    [rows, saved],
  );
  const markSaved = useSettingsForm(FORM_ID, dirty, pending);
  const total = shareTotal(rows.defaults);

  function update(list: PhaseList, key: string, patch: Partial<PhaseRow>) {
    setRows((s) => ({
      ...s,
      [list]: s[list].map((r) => (r.key === key ? { ...r, ...patch } : r)),
    }));
  }
  function move(list: PhaseList, index: number, by: -1 | 1) {
    setRows((s) => {
      const next = [...s[list]];
      [next[index], next[index + by]] = [next[index + by], next[index]];
      return { ...s, [list]: next };
    });
  }
  function remove(list: PhaseList, key: string) {
    setRows((s) => ({ ...s, [list]: s[list].filter((r) => r.key !== key) }));
  }
  function add(list: PhaseList) {
    const key = `new-${nextKey++}`;
    setRows((s) => ({
      ...s,
      [list]: [
        ...s[list],
        { key, id: null, code: "", name: "", description: "", pct: 0, feeType: "fixed" },
      ],
    }));
    setFocusKey(key);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || pending) return;
    const form = strip(rows);
    const found = validatePhases(form);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setBanner(found.total ?? found.list ?? PHASE_MESSAGES.summary);
      return;
    }
    setBanner(null);
    startTransition(async () => {
      const result = await savePhases(form);
      if (!result.ok) {
        setErrors((result.fieldErrors ?? {}) as Record<string, string>);
        setBanner(result.error ?? PHASE_MESSAGES.summary);
        return;
      }
      const next = withKeys(result.data.form);
      setSaved(next);
      setRows(next);
      setErrors({});
      markSaved();
      router.refresh();
    });
  }

  const totalTone = total === 100 ? "text-green" : "text-orange-strong";

  return (
    <form
      id={FORM_ID}
      onSubmit={onSubmit}
      noValidate
      className="flex max-w-[960px] flex-col gap-4"
    >
      {banner && <ErrorBanner message={banner} />}

      <section
        aria-labelledby="phases-default-title"
        className="rounded-sm border border-line bg-surface"
      >
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 pt-4 pb-3">
          <h2 id="phases-default-title" className="m-0 text-sm font-semibold">
            Default phases &amp; fee split
          </h2>
          <span className="text-[12.5px] text-muted">
            New projects and proposals start with these. Each can be changed per
            project.
          </span>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <PhaseHead list="defaults" />
            <tbody>
              {rows.defaults.map((r, i) => (
                <PhaseRows
                  key={r.key}
                  list="defaults"
                  row={r}
                  index={i}
                  count={rows.defaults.length}
                  errors={errors}
                  autoFocus={focusKey === r.key}
                  onChange={(patch) => update("defaults", r.key, patch)}
                  onMove={(by) => move("defaults", i, by)}
                  onRemove={() => remove("defaults", r.key)}
                />
              ))}
            </tbody>
            <tfoot>
              <tr className={cn("bg-surface-2 font-semibold", totalTone)}>
                <td className="py-2.5 pl-[18px]">Total</td>
                <td />
                <td className="num px-2.5 text-right text-sm" data-testid="phase-total">
                  {total}%
                </td>
                <td colSpan={3} className="px-2.5 pr-[18px] text-[12.5px]">
                  {phaseTotalNote(total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="px-5 pt-3 pb-4">
          {errors.list && <FieldError id="phases-list-error" message={errors.list} />}
          <Button
            icon={<PlusIcon />}
            className="h-8"
            onClick={() => add("defaults")}
          >
            Add phase
          </Button>
        </div>
      </section>

      <section
        aria-labelledby="phases-optional-title"
        className="rounded-sm border border-line bg-surface"
      >
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 pt-4 pb-3">
          <h2 id="phases-optional-title" className="m-0 text-sm font-semibold">
            Optional phases
          </h2>
          <span className="text-[12.5px] text-muted">
            Phases only some projects need, like interiors or as-built surveys.
            They aren&apos;t added to new projects automatically. Add one from a
            project&apos;s Phases &amp; fees, and set its fee there.
          </span>
        </header>
        {rows.optional.length === 0 ? (
          <p className="m-0 px-5 py-4 text-sm text-muted">
            No optional phases yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <PhaseHead list="optional" />
              <tbody>
                {rows.optional.map((r, i) => (
                  <PhaseRows
                    key={r.key}
                    list="optional"
                    row={r}
                    index={i}
                    count={rows.optional.length}
                    errors={errors}
                    autoFocus={focusKey === r.key}
                    onChange={(patch) => update("optional", r.key, patch)}
                    onMove={(by) => move("optional", i, by)}
                    onRemove={() => remove("optional", r.key)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-5 pt-3 pb-4">
          <Button
            icon={<PlusIcon />}
            className="h-8"
            onClick={() => add("optional")}
          >
            Add optional phase
          </Button>
        </div>
      </section>
    </form>
  );
}

const th =
  "border-b border-line px-2.5 py-2.5 text-2xs font-medium whitespace-nowrap text-muted first:pl-[18px] last:pr-[18px]";

function PhaseHead({ list }: { list: PhaseList }) {
  return (
    <thead className="bg-surface-2">
      <tr>
        <th scope="col" className={cn(th, "text-left")}>Phase</th>
        <th scope="col" className={cn(th, "w-[96px] text-left")}>Abbrev.</th>
        {list === "defaults" ? (
          <>
            <th scope="col" className={cn(th, "w-[100px] text-right")}>% of fee</th>
            <th scope="col" className={cn(th, "w-[200px] text-left")}>Share</th>
          </>
        ) : (
          <th scope="col" className={cn(th, "w-[150px] text-left")}>Fee type</th>
        )}
        <th scope="col" className={cn(th, "w-[80px] text-left")}>Order</th>
        <th scope="col" className={cn(th, "w-[80px] text-left")}>
          <span className="sr-only">Remove</span>
        </th>
      </tr>
    </thead>
  );
}

/** One phase: its main row, then its description line. */
function PhaseRows({
  list,
  row,
  index,
  count,
  errors,
  autoFocus,
  onChange,
  onMove,
  onRemove,
}: {
  list: PhaseList;
  row: Keyed;
  index: number;
  count: number;
  errors: PhaseErrors;
  autoFocus: boolean;
  onChange: (patch: Partial<PhaseRow>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const at = `${list}.${index}`;
  const label = row.name.trim() || "New phase";
  const err = (f: string) => errors[`${at}.${f}`];
  const errId = (f: string) => `phase-${row.key}-${f}-error`;
  const aria = (f: string) =>
    err(f)
      ? ({ "aria-invalid": true, "aria-describedby": errId(f) } as const)
      : {};
  const td = "px-2.5 pt-2.5 align-top first:pl-[18px] last:pr-[18px]";

  return (
    <>
      <tr>
        <td className={td}>
          <input
            aria-label="Phase name"
            value={row.name}
            autoFocus={autoFocus}
            maxLength={80}
            onChange={(e) => onChange({ name: e.target.value })}
            className={cn(smallInput, "font-medium")}
            {...aria("name")}
          />
          <FieldError id={errId("name")} message={err("name")} />
        </td>
        <td className={td}>
          <input
            aria-label={`${label} abbreviation`}
            value={row.code}
            maxLength={8}
            onChange={(e) => onChange({ code: e.target.value.toUpperCase() })}
            className={cn(smallInput, "num w-[72px]! text-[12.5px]")}
            {...aria("code")}
          />
          <FieldError id={errId("code")} message={err("code")} />
        </td>
        {list === "defaults" ? (
          <>
            <td className={cn(td, "text-right")}>
              <span className="inline-flex items-center gap-1">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  step={1}
                  aria-label={`${label} percent of fee`}
                  value={Number.isFinite(row.pct) ? row.pct : ""}
                  onChange={(e) =>
                    onChange({
                      pct: e.target.value === "" ? Number.NaN : Number(e.target.value),
                    })
                  }
                  className={cn(smallInput, "num w-[60px]! text-right")}
                  {...aria("pct")}
                />
                <span className="text-muted">%</span>
              </span>
              <FieldError id={errId("pct")} message={err("pct")} />
            </td>
            <td className={cn(td, "pt-[22px]")}>
              <span className="block h-2 w-[180px] max-w-full rounded-sm bg-line-soft">
                <span
                  className="block h-2 rounded-sm bg-blue"
                  style={{
                    width: `${shareBarWidth(Number.isFinite(row.pct) ? row.pct : 0)}%`,
                  }}
                />
              </span>
            </td>
          </>
        ) : (
          <td className={td}>
            <select
              aria-label={`${label} fee type`}
              value={row.feeType}
              onChange={(e) => onChange({ feeType: e.target.value as FeeType })}
              className={cn(smallInput, "w-[130px]! cursor-pointer")}
            >
              {FEE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {FEE_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </td>
        )}
        <td className={td}>
          <span className="inline-flex gap-1">
            <button
              type="button"
              aria-label={`Move ${label} up`}
              disabled={index === 0}
              onClick={() => onMove(-1)}
              className={iconButton}
            >
              <ChevronUpIcon className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label={`Move ${label} down`}
              disabled={index === count - 1}
              onClick={() => onMove(1)}
              className={iconButton}
            >
              <ChevronDownIcon className="size-3.5" />
            </button>
          </span>
        </td>
        <td className={td}>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${label}`}
            className="h-8 cursor-pointer border-0 bg-transparent px-1 text-sm text-red hover:underline focus-visible:outline-2 focus-visible:outline-blue"
          >
            Remove
          </button>
        </td>
      </tr>
      <tr className="border-b border-line-soft">
        <td colSpan={list === "defaults" ? 6 : 5} className="px-[18px] pt-1.5 pb-2.5">
          <textarea
            aria-label={`${label} description`}
            placeholder="Default description (optional)"
            value={row.description}
            rows={1}
            onChange={(e) => onChange({ description: e.target.value })}
            className={cn(
              controlClasses,
              "field-sizing-content min-h-8 resize-none py-1.5 text-sm text-ink-3",
            )}
            {...aria("description")}
          />
          <FieldError id={errId("description")} message={err("description")} />
        </td>
      </tr>
    </>
  );
}
