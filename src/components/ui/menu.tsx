"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A small menu that opens from a button (like the "⋯" on a table row).
 * Built on Radix, so arrow keys, Esc and focus work.
 *
 * <Menu>
 *   <MenuTrigger asChild><button aria-label="Actions for Jo">⋯</button></MenuTrigger>
 *   <MenuContent><MenuItem onSelect={…}>Resend</MenuItem></MenuContent>
 * </Menu>
 */
export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;

export function MenuContent({
  children,
  align = "end",
}: {
  children: ReactNode;
  align?: "start" | "end";
}) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align={align}
        sideOffset={4}
        className="z-50 min-w-[180px] rounded-sm border border-line bg-surface py-1 text-sm text-ink shadow-md"
      >
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}

export function MenuItem({
  children,
  onSelect,
  danger,
}: {
  children: ReactNode;
  onSelect: () => void;
  danger?: boolean;
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className={cn(
        "cursor-pointer px-3 py-2 outline-none data-[highlighted]:bg-surface-2",
        danger && "text-red",
      )}
    >
      {children}
    </DropdownMenu.Item>
  );
}
