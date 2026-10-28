"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { type ReactNode, useState } from "react";
import type { RailEntry } from "@/lib/shell/nav";
import { saveRailCollapsed } from "@/lib/shell/rail-cookie";
import { MenuRail } from "./menu-rail";

type ShellFrameProps = {
  entries: RailEntry[];
  /** Read from the cookie on the server, so the first paint is right. */
  initialCollapsed: boolean;
  header: ReactNode;
  children: ReactNode;
};

/**
 * The page frame: menu rail on the left, header and page on the right.
 *
 * At 768px and wider the rail sits inline. Narrower, it's hidden and the
 * header's menu button opens it as a drawer (rule 9). The drawer is a Radix
 * dialog, so Esc and the scrim close it and focus goes back to the button.
 * The whole frame sits inside the dialog's Root so the header's button
 * (a Dialog trigger) can open it.
 */
export function ShellFrame({
  entries,
  initialCollapsed,
  header,
  children,
}: ShellFrameProps) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    saveRailCollapsed(next);
  }

  return (
    <RadixDialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
      <div className="flex min-h-screen bg-canvas text-base text-ink">
        <div className="sticky top-0 hidden h-screen self-start md:flex">
          <MenuRail
            entries={entries}
            collapsed={collapsed}
            onToggleCollapsed={toggleCollapsed}
          />
        </div>

        <RadixDialog.Portal>
          <RadixDialog.Overlay className="fixed inset-0 z-40 bg-scrim md:hidden" />
          <RadixDialog.Content
            aria-describedby={undefined}
            className="fixed inset-y-0 left-0 z-50 flex focus:outline-none md:hidden"
          >
            <RadixDialog.Title className="sr-only">Main menu</RadixDialog.Title>
            <MenuRail
              entries={entries}
              collapsed={false}
              onNavigate={() => setDrawerOpen(false)}
            />
          </RadixDialog.Content>
        </RadixDialog.Portal>

        <div className="flex min-w-0 flex-[1_1_0] flex-col">
          {header}
          {children}
        </div>
      </div>
    </RadixDialog.Root>
  );
}

/** The header's hamburger button, under 768px only. */
export function MobileMenuButton() {
  return (
    <RadixDialog.Trigger
      aria-label="Open menu"
      className="inline-flex size-[34px] shrink-0 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent text-chrome-text hover:bg-chrome-2 focus-visible:outline-2 focus-visible:outline-white md:hidden"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </RadixDialog.Trigger>
  );
}
