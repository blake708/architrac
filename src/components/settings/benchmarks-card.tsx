"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { PlusIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import {
  moneyInput,
  parseMoney,
  SCOPE_KINDS,
  SCOPE_LABELS,
  type ScopeKind,
} from "@/lib/projects/form";
import {
  BENCHMARK_MESSAGES,
  type BenchmarkRow,
} from "@/lib/settings/benchmarks";
import { saveBenchmarks } from "@/server/settings/actions";

// Settings → Phases → Project type ranges (Blake, 2026-11-04). New project's
// estimate uses these when there are fewer than 3 similar past projects.

type Draft = {
  key: string;
  id: string | null;
  projectType: string;
  scopeKind: ScopeKind | "";
  costLow: string;
  costHigh: string;
  feeLow: string;
  feeHigh: string;
};

const pctText = (bp: number) => String(bp / 100);
/** "3" / "2.85%" → basis points; null if it isn't a % with up to 2 decimals. */
function parsePct(raw: string): number | null {
  const v = raw.trim().replace(/%$/, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  return Math.round(Number(v) * 100);
}

const toDraft = (r: BenchmarkRow, i: number): Draft => ({
  key: r.id ?? `new-${i}`,
  id: r.id,
  projectType: r.projectType,
  scopeKind: r.scopeKind ?? "",
  costLow: moneyInput(r.costPerSfLowCents),
  costHigh: moneyInput(r.costPerSfHighCents),
  feeLow: pctText(r.feeLowBp),
  feeHigh: pctText(r.feeHighBp),
});

export function BenchmarksCard({
  initial,
  types,
}: {
  initial: BenchmarkRow[];
  types: string[];
}) {
  const toast = useToast();
  const [saved, setSaved] = useState(() => initial.map(toDraft));
  const [rows, setRows] = useState(saved);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const dirty = useMemo(
    () => JSON.stringify(rows) !== JSON.stringify(saved),
    [rows, saved],
  );
  const set = (key: string, p: Partial<Draft>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  function save() {
    // Check what can be checked here; the server checks everything again.
    const local: Record<string, string> = {};
    const out = rows.map((r, i) => {
      const n = (k: string, v: number | null, msg: string) => {
        if (v === null || v <= 0) local[`rows.${i}.${k}`] = msg;
        return v ?? 0;
      };
      if (!r.projectType.trim())
        local[`rows.${i}.projectType`] = BENCHMARK_MESSAGES.type;
      return {
        id: r.id,
        projectType: r.projectType.trim(),
        scopeKind: r.scopeKind || null,
        costPerSfLowCents: n(
          "costPerSfLowCents",
          parseMoney(r.costLow),
          BENCHMARK_MESSAGES.cost,
        ),
        costPerSfHighCents: n(
          "costPerSfHighCents",
          parseMoney(r.costHigh),
          BENCHMARK_MESSAGES.cost,
        ),
        feeLowBp: n("feeLowBp", parsePct(r.feeLow), BENCHMARK_MESSAGES.fee),
        feeHighBp: n("feeHighBp", parsePct(r.feeHigh), BENCHMARK_MESSAGES.fee),
      };
    });
    setErrors(local);
    if (Object.keys(local).length) return;
    startTransition(async () => {
      const r = await saveBenchmarks({ rows: out });
      if (!r.ok) {
        setErrors((r.fieldErrors ?? {}) as Record<string, string>);
        toast(r.error ?? "Couldn't save the ranges.", "error");
        return;
      }
      const next = r.data.rows.map(toDraft);
      setSaved(next);
      setRows(next);
      toast(BENCHMARK_MESSAGES.saved);
    });
  }

  const box =
    "h-8 rounded-sm border border-line-input bg-surface px-2 aria-[invalid=true]:border-red";
  const th =
    "cap border-b border-line px-2 py-2 text-left text-2xs font-medium text-muted";
  const err = (i: number, k: string) => errors[`rows.${i}.${k}`];

  return (
    <section
      aria-labelledby="ranges-title"
      className="max-w-[960px] rounded-sm border border-line bg-surface"
    >
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-[var(--spacing-card)] pt-4 pb-3">
        <h2 id="ranges-title" className="m-0 text-sm font-semibold">
          Project type ranges
        </h2>
        <span className="text-[12.5px] text-muted">
          Construction cost per SF and fee as a % of construction. New project
          uses these until you have 3 similar past projects.
        </span>
      </header>
      <datalist id="range-types">
        {types.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table
            className="w-full min-w-[760px] border-collapse text-sm"
            aria-label="Project type ranges"
          >
            <thead className="bg-surface-2">
              <tr>
                <th scope="col" className={cn(th, "pl-[18px]")}>
                  Project type
                </th>
                <th scope="col" className={th}>
                  Scope
                </th>
                <th scope="col" className={th}>
                  Cost / SF
                </th>
                <th scope="col" className={th}>
                  Fee %
                </th>
                <th scope="col" className={cn(th, "pr-[18px]")}>
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const rowErrors = [
                  "projectType",
                  "costPerSfLowCents",
                  "costPerSfHighCents",
                  "feeLowBp",
                  "feeHighBp",
                ]
                  .map((k) => err(i, k))
                  .filter(Boolean);
                return (
                  <tr key={r.key} data-range={r.projectType}>
                    <td className="border-b border-line-soft px-2 py-1.5 pl-[18px] align-top">
                      <input
                        aria-label={`Range ${i + 1} project type`}
                        list="range-types"
                        value={r.projectType}
                        maxLength={60}
                        aria-invalid={!!err(i, "projectType") || undefined}
                        onChange={(e) =>
                          set(r.key, { projectType: e.target.value })
                        }
                        className={cn(box, "w-full min-w-[160px]")}
                      />
                      {rowErrors.length > 0 && (
                        <p className="m-0 mt-1 text-[12.5px] text-red">
                          {rowErrors[0]}
                        </p>
                      )}
                    </td>
                    <td className="border-b border-line-soft px-2 py-1.5 align-top">
                      <select
                        aria-label={`Range ${i + 1} scope`}
                        value={r.scopeKind}
                        onChange={(e) =>
                          set(r.key, {
                            scopeKind: e.target.value as ScopeKind | "",
                          })
                        }
                        className={box}
                      >
                        <option value="">Any scope</option>
                        {SCOPE_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {SCOPE_LABELS[k]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="border-b border-line-soft px-2 py-1.5 align-top whitespace-nowrap">
                      <span className="text-muted">$</span>{" "}
                      <input
                        aria-label={`Range ${i + 1} cost per SF low`}
                        value={r.costLow}
                        inputMode="decimal"
                        aria-invalid={
                          !!err(i, "costPerSfLowCents") || undefined
                        }
                        onChange={(e) =>
                          set(r.key, { costLow: e.target.value })
                        }
                        className={cn(box, "num w-[80px] text-right")}
                      />
                      <span className="mx-1.5 text-muted">–</span>
                      <input
                        aria-label={`Range ${i + 1} cost per SF high`}
                        value={r.costHigh}
                        inputMode="decimal"
                        aria-invalid={
                          !!err(i, "costPerSfHighCents") || undefined
                        }
                        onChange={(e) =>
                          set(r.key, { costHigh: e.target.value })
                        }
                        className={cn(box, "num w-[80px] text-right")}
                      />
                    </td>
                    <td className="border-b border-line-soft px-2 py-1.5 align-top whitespace-nowrap">
                      <input
                        aria-label={`Range ${i + 1} fee % low`}
                        value={r.feeLow}
                        inputMode="decimal"
                        aria-invalid={!!err(i, "feeLowBp") || undefined}
                        onChange={(e) => set(r.key, { feeLow: e.target.value })}
                        className={cn(box, "num w-[64px] text-right")}
                      />
                      <span className="mx-1.5 text-muted">–</span>
                      <input
                        aria-label={`Range ${i + 1} fee % high`}
                        value={r.feeHigh}
                        inputMode="decimal"
                        aria-invalid={!!err(i, "feeHighBp") || undefined}
                        onChange={(e) =>
                          set(r.key, { feeHigh: e.target.value })
                        }
                        className={cn(box, "num w-[64px] text-right")}
                      />
                      <span className="ml-1 text-muted">%</span>
                    </td>
                    <td className="border-b border-line-soft px-2 py-1.5 pr-[18px] text-right align-top">
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label={`Remove range ${i + 1}`}
                        onClick={() =>
                          setRows((rs) => rs.filter((x) => x.key !== r.key))
                        }
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 px-[var(--spacing-card)] py-4">
        <Button
          type="button"
          icon={<PlusIcon />}
          onClick={() =>
            setRows((rs) => [
              ...rs,
              {
                key: `new-${Date.now()}`,
                id: null,
                projectType: "",
                scopeKind: "",
                costLow: "",
                costHigh: "",
                feeLow: "",
                feeHigh: "",
              },
            ])
          }
        >
          Add range
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={!dirty || pending}
          onClick={save}
          className="ml-auto"
        >
          {pending ? "Saving…" : "Save ranges"}
        </Button>
      </div>
    </section>
  );
}
