"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  bpText,
  estimate,
  pickBenchmark,
  sourceText,
} from "@/lib/calc/benchmarks";
import { formatMoney, formatMoneyShort } from "@/lib/format";
import { SCOPE_LABELS, type ScopeKind } from "@/lib/projects/form";
import type { BenchmarkSources } from "@/server/projects/estimate";

// The estimate at the top of New project → Phases & fees (Blake,
// 2026-11-04): construction cost from square feet and the type's cost per
// SF, and the fee as a % of construction. "Use" buttons fill the
// construction estimate (when blank) and the total fee.

export function EstimateCard({
  sources,
  projectType,
  scopeKind,
  squareFeet,
  constructionCents,
  totalFeeCents,
  canEditSettings,
  onUseConstruction,
  onUseFee,
}: {
  sources: BenchmarkSources;
  projectType: string;
  scopeKind: ScopeKind | null;
  squareFeet: number | null;
  constructionCents: number | null;
  totalFeeCents: number | null;
  canEditSettings: boolean;
  onUseConstruction: (cents: number) => void;
  onUseFee: (cents: number) => void;
}) {
  const b = pickBenchmark(
    projectType,
    scopeKind,
    sources.past,
    sources.settings,
  );
  const scopeLabel = scopeKind ? SCOPE_LABELS[scopeKind] : null;
  const settingsLink = canEditSettings ? (
    <Link href="/app/settings/phases" className="text-blue underline">
      Settings → Phases
    </Link>
  ) : (
    "Settings → Phases (ask an owner or admin)"
  );

  if (!b)
    return (
      <section
        aria-labelledby="estimate-title"
        className="rounded-sm border border-line bg-surface px-[var(--spacing-card)] py-4"
      >
        <h2 id="estimate-title" className="m-0 text-sm font-semibold">
          Estimate
        </h2>
        <p
          className="m-0 mt-1.5 text-sm text-muted"
          data-testid="estimate-empty"
        >
          No ranges for{" "}
          {projectType ? (
            <strong className="font-medium text-ink">
              {projectType.toLowerCase()}
            </strong>
          ) : (
            "this type"
          )}{" "}
          yet. They come from 3 or more similar past projects, or add a range in{" "}
          {settingsLink}.
        </p>
      </section>
    );

  const e = estimate(b, squareFeet, constructionCents);
  const position =
    totalFeeCents && e.feeCents
      ? totalFeeCents < e.feeCents.low
        ? "below the range"
        : totalFeeCents > e.feeCents.high
          ? "above the range"
          : "within the range"
      : null;

  return (
    <section
      aria-labelledby="estimate-title"
      className="rounded-sm border border-line bg-surface"
    >
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-[var(--spacing-card)] pt-4 pb-2">
        <h2 id="estimate-title" className="m-0 text-sm font-semibold">
          Estimate
        </h2>
        <span
          className="text-[12.5px] text-muted"
          data-testid="estimate-source"
        >
          {sourceText(b, projectType, scopeLabel)}
        </span>
      </header>
      <div className="grid grid-cols-1 gap-x-8 gap-y-4 px-[var(--spacing-card)] pb-4 md:grid-cols-2">
        <div
          className="flex flex-col gap-1"
          data-testid="estimate-construction"
        >
          <span className="cap text-2xs font-medium text-muted">
            Construction cost
          </span>
          {e.construction ? (
            <>
              <span className="num text-base font-semibold">
                {formatMoneyShort(e.construction.low)}–
                {formatMoneyShort(e.construction.high)}
              </span>
              <span className="text-xs text-ink-3">
                Typical {formatMoneyShort(e.construction.typical)} ·{" "}
                {formatMoney(b.costPerSfCents.low)}–
                {formatMoney(b.costPerSfCents.high)} / SF ×{" "}
                {squareFeet!.toLocaleString("en-US")} SF
              </span>
              {constructionCents === null && (
                <Button
                  type="button"
                  className="mt-1 self-start"
                  onClick={() => onUseConstruction(e.construction!.typical)}
                >
                  Use {formatMoneyShort(e.construction.typical)}
                </Button>
              )}
            </>
          ) : (
            <span className="text-sm text-muted">
              Add square feet on step 1 to estimate it (
              {formatMoney(b.costPerSfCents.low)}–
              {formatMoney(b.costPerSfCents.high)} / SF).
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1" data-testid="estimate-fee">
          <span className="cap text-2xs font-medium text-muted">
            Architectural fee
          </span>
          <span className="num text-base font-semibold">
            {bpText(e.feeBp.low)}–{bpText(e.feeBp.high)} of construction
          </span>
          {e.feeCents && e.feeBase ? (
            <>
              <span className="text-xs text-ink-3">
                {formatMoneyShort(e.feeCents.low)}–
                {formatMoneyShort(e.feeCents.high)} · typical{" "}
                {formatMoney(e.feeCents.typical)} ({bpText(e.feeBp.typical)} of{" "}
                {e.feeBase.entered ? "your" : "the typical"}{" "}
                {formatMoneyShort(e.feeBase.cents)} estimate)
              </span>
              {position && (
                <span
                  className={
                    position === "within the range"
                      ? "text-xs text-green"
                      : "text-xs text-orange-strong"
                  }
                  data-testid="estimate-position"
                >
                  Your total fee is {position}.
                </span>
              )}
              <Button
                type="button"
                className="mt-1 self-start"
                onClick={() => onUseFee(e.feeCents!.typical)}
              >
                Use {formatMoney(e.feeCents.typical)}
              </Button>
            </>
          ) : (
            <span className="text-xs text-muted">
              Add square feet or a construction estimate on step 1 to see
              dollars.
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
