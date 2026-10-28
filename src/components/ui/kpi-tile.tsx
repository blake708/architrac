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
  className?: string;
};

export function KpiTile({
  label,
  value,
  note,
  tone = "default",
  className,
}: KpiTileProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-sm border border-line bg-surface px-4 py-3.5",
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
