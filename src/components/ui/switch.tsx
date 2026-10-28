"use client";

import { cn } from "@/lib/cn";

type SwitchProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** What the switch does, e.g. "Turn on Build" (read by screen readers). */
  "aria-label": string;
  disabled?: boolean;
  className?: string;
};

/** On/off switch: 40×22, dark when on (settings-firm spec, Layout §4). */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  className,
  ...props
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={props["aria-label"]}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-block h-[22px] w-10 shrink-0 cursor-pointer rounded-[11px] border-0 p-0 transition-colors duration-[120ms]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-ink" : "bg-line-strong",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-[3px] size-4 rounded-full bg-white transition-[left] duration-[120ms]",
          checked ? "left-[21px]" : "left-[3px]",
        )}
      />
    </button>
  );
}
