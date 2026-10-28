import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type BadgeTone =
  | "neutral"
  | "blue"
  | "green"
  | "orange"
  | "red"
  | "purple";

const tones: Record<BadgeTone, { badge: string; dot: string }> = {
  neutral: { badge: "bg-line-soft text-ink-2", dot: "bg-ink-3" },
  blue: { badge: "bg-blue-tint text-blue", dot: "bg-blue" },
  green: { badge: "bg-green-tint text-green", dot: "bg-green" },
  // orange-strong keeps small text above 4.5:1 contrast on the tint.
  orange: { badge: "bg-orange-tint text-orange-strong", dot: "bg-orange" },
  red: { badge: "bg-red-tint text-red", dot: "bg-red" },
  purple: { badge: "bg-purple-tint text-purple", dot: "bg-purple" },
};

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
  /** Small leading dot, as in the mockup's health and status pills. */
  dot?: boolean;
};

/** Status label. Always has text, so meaning never relies on colour alone. */
export function Badge({
  tone = "neutral",
  dot,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "cap inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-2xs leading-4 font-medium whitespace-nowrap",
        tones[tone].badge,
        className,
      )}
      {...props}
    >
      {dot && (
        <span
          aria-hidden="true"
          className={cn("size-1.5 shrink-0 rounded-full", tones[tone].dot)}
        />
      )}
      {children}
    </span>
  );
}
