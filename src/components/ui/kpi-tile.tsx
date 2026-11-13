import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type KpiTone = "default" | "blue" | "green" | "orange" | "red";

const toneText: Record<KpiTone, string> = {
  default: "text-ink",
  blue: "text-blue",
  green: "text-green",
  orange: "text-orange",
  red: "text-red",
};

type KpiTileProps = {
  label: ReactNode;
  /** Already formatted (use src/lib/format.ts). */
  value: ReactNode;
  /** Optional delta or status line under the value. */
  note?: ReactNode;
  /** Colours the value, only to carry meaning (e.g. red = over budget). */
  tone?: KpiTone;
  /** "card" (default) is a bordered box; "header" is flat, for a row of
   *  tiles inside the white page-header band (see HeaderKpis). */
  variant?: "card" | "header";
  className?: string;
};

export function KpiTile({
  label,
  value,
  note,
  tone = "default",
  variant = "card",
  className,
}: KpiTileProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1",
        variant === "card"
          ? "rounded-sm border border-line bg-surface px-4 py-3.5"
          : "border-b border-line-soft px-4 pt-5 pb-[22px] md:border-r md:border-b-0 md:px-page-x",
        className,
      )}
    >
      <span className="cap text-2xs font-medium text-ink-2">{label}</span>
      <span
        className={cn(
          "text-2xl leading-[1.15] font-medium tabular-nums",
          toneText[tone],
        )}
      >
        {value}
      </span>
      {note && <span className="text-[12.5px] text-muted">{note}</span>}
    </div>
  );
}

/**
 * A row of summary tiles in the page-header band, under a thin rule, as in
 * the mockup. Pass it to PageHeader as a child, above the tabs.
 */
export function HeaderKpis({
  label,
  children,
}: {
  /** Accessible name for the region, e.g. "Project totals". */
  label: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] border-t border-line-soft"
    >
      {children}
    </section>
  );
}
