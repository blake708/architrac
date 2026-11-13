"use client";

import type { AgingBucket } from "@/lib/calc/invoice";
import { money } from "@/lib/calc/invoice-plan";
import type { AgingTotal } from "@/lib/calc/receivables";
import { cn } from "@/lib/cn";

// Receivables aging (invoicing spec Layout A.4, rule 10): open balances by
// days past due. A bar sized by amount, and a key under it; picking either
// filters the list.

const COLOR: Record<AgingBucket, string> = {
  current: "var(--color-age-current)",
  "1_30": "var(--color-age-30)",
  "31_60": "var(--color-age-60)",
  "61_90": "var(--color-age-90)",
  "90_plus": "var(--color-age-90-plus)",
};

export function AgingBar({
  totals,
  selected,
  onPick,
}: {
  totals: AgingTotal[];
  /** Buckets the list is filtered to; empty = all. */
  selected: readonly AgingBucket[];
  onPick: (bucket: AgingBucket | null) => void;
}) {
  const any = selected.length > 0;
  const on = (k: AgingBucket) => selected.includes(k);
  const aria = (t: AgingTotal) =>
    `${t.label}: ${money(t.cents)}, ${t.count} ${t.count === 1 ? "invoice" : "invoices"}`;
  const toggle = (k: AgingBucket) =>
    onPick(on(k) && selected.length === 1 ? null : k);
  const total = totals.reduce((n, t) => n + t.cents, 0);

  return (
    <section
      aria-labelledby="aging-title"
      className="rounded-sm border border-line bg-surface px-5 pt-[18px] pb-5"
    >
      <div className="mb-3.5 flex flex-wrap items-baseline gap-2.5">
        <h2 id="aging-title" className="m-0 text-sm font-semibold">
          Receivables aging
        </h2>
        <span className="text-[12.5px] text-muted">
          Days past the due date. Select a bar to filter the list.
        </span>
        {any && (
          <button
            type="button"
            onClick={() => onPick(null)}
            className="ml-auto cursor-pointer border-0 bg-transparent p-0 font-medium underline underline-offset-2"
          >
            Show all
          </button>
        )}
      </div>
      <div className="flex h-7 gap-0.5">
        {totals.map((t) =>
          t.cents > 0 || total === 0 ? (
            <button
              key={t.key}
              type="button"
              aria-pressed={on(t.key)}
              aria-label={aria(t)}
              title={aria(t)}
              onClick={() => toggle(t.key)}
              className="h-full min-w-1.5 cursor-pointer rounded-[1px] border-0 p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue"
              style={{
                flex: `${total === 0 ? 1 : t.cents} 1 0`,
                background: total === 0 ? "var(--color-track)" : COLOR[t.key],
                opacity: any && !on(t.key) ? 0.35 : 1,
                boxShadow: on(t.key)
                  ? "inset 0 0 0 2px var(--color-ink)"
                  : "none",
              }}
            />
          ) : null,
        )}
      </div>
      <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-3">
        {totals.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={on(t.key)}
            onClick={() => toggle(t.key)}
            data-bucket={t.key}
            className={cn(
              "flex cursor-pointer flex-col items-start gap-0.5 border-0 border-t-[3px] border-solid bg-transparent px-0 pt-1.5 text-left",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue",
              on(t.key) ? "border-ink" : "border-transparent",
            )}
          >
            <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
              <span
                aria-hidden="true"
                className="inline-block size-2.5 rounded-[1px]"
                style={{ background: COLOR[t.key] }}
              />
              <span className="cap text-2xs font-medium">{t.label}</span>
            </span>
            <span className="num text-lg font-medium">{money(t.cents)}</span>
            <span className="text-xs text-muted">
              {t.count} {t.count === 1 ? "invoice" : "invoices"}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
