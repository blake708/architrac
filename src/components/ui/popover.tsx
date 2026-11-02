"use client";

import * as RadixPopover from "@radix-ui/react-popover";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A small panel that opens next to its trigger (Radix: Esc and outside
 * click close it, focus moves in and back).
 *
 * <Popover>
 *   <PopoverTrigger asChild><button>Jan 1, 2026</button></PopoverTrigger>
 *   <PopoverContent label="Designer rate history">…</PopoverContent>
 * </Popover>
 */
export const Popover = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;

export function PopoverContent({
  label,
  children,
  className,
  align = "start",
}: {
  /** Read by screen readers as the panel's name. */
  label: string;
  children: ReactNode;
  className?: string;
  align?: "start" | "center" | "end";
}) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        aria-label={label}
        align={align}
        sideOffset={6}
        collisionPadding={16}
        className={cn(
          "z-50 max-w-[calc(100vw-32px)] rounded-sm border border-line bg-surface p-3 text-sm text-ink shadow-[0_4px_16px_rgba(0,0,0,0.08)] focus:outline-none",
          className,
        )}
      >
        {children}
      </RadixPopover.Content>
    </RadixPopover.Portal>
  );
}
