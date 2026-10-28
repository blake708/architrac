"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// Shared look for the header's drop-down menus (firm switcher, account).
// Radix handles keyboard use, focus and closing on Esc or outside click.

export const HeaderMenu = Menu.Root;
export const HeaderMenuTrigger = Menu.Trigger;

export function HeaderMenuContent({
  children,
  align = "start",
  label,
}: {
  children: ReactNode;
  align?: "start" | "end";
  label: string;
}) {
  return (
    <Menu.Portal>
      <Menu.Content
        // Radix names the menu after its button; use our clearer label instead.
        aria-labelledby={undefined}
        aria-label={label}
        align={align}
        sideOffset={6}
        className="z-50 min-w-60 rounded-sm border border-line bg-surface p-1 text-ink shadow-[0_4px_16px_rgba(0,0,0,0.12)]"
      >
        {children}
      </Menu.Content>
    </Menu.Portal>
  );
}

export function HeaderMenuItem({
  children,
  onSelect,
  asChild,
  className,
}: {
  children: ReactNode;
  onSelect?: (e: Event) => void;
  asChild?: boolean;
  className?: string;
}) {
  return (
    <Menu.Item
      asChild={asChild}
      onSelect={onSelect}
      className={cn(
        "flex h-9 cursor-pointer items-center gap-2 rounded-sm px-2.5 text-sm text-ink no-underline outline-none select-none data-highlighted:bg-line-soft",
        className,
      )}
    >
      {children}
    </Menu.Item>
  );
}

/** A group where one item is selected (screen readers announce which). */
export const HeaderMenuRadioGroup = Menu.RadioGroup;

export function HeaderMenuRadioItem({
  value,
  children,
  onSelect,
}: {
  value: string;
  children: ReactNode;
  onSelect?: (e: Event) => void;
}) {
  return (
    <Menu.RadioItem
      value={value}
      onSelect={onSelect}
      className="flex h-9 cursor-pointer items-center gap-2 rounded-sm px-2.5 text-sm text-ink outline-none select-none data-highlighted:bg-line-soft"
    >
      {children}
      <Menu.ItemIndicator className="ml-auto inline-flex">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5 12l5 5L20 7" />
        </svg>
      </Menu.ItemIndicator>
    </Menu.RadioItem>
  );
}

export function HeaderMenuSeparator() {
  return <Menu.Separator className="my-1 h-px bg-line-soft" />;
}

export function HeaderMenuLabel({ children }: { children: ReactNode }) {
  return (
    <Menu.Label className="cap px-2.5 pt-2 pb-1 text-2xs font-semibold text-muted">
      {children}
    </Menu.Label>
  );
}
