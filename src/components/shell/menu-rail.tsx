"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { type RailEntry, isCurrent } from "@/lib/shell/nav";
import { RAIL_ICONS, SHELL_ICONS, iconProps } from "./icons";
import { LogoMark } from "./logo-mark";

type MenuRailProps = {
  entries: RailEntry[];
  collapsed: boolean;
  /** Not passed in the mobile drawer, which has no collapse toggle. */
  onToggleCollapsed?: () => void;
  /** Called when an item is clicked (the drawer closes itself). */
  onNavigate?: () => void;
};

/** The black menu on the left (app-shell spec, layout section 1). */
export function MenuRail({
  entries,
  collapsed,
  onToggleCollapsed,
  onNavigate,
}: MenuRailProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main menu"
      data-collapsed={collapsed ? "true" : "false"}
      className={cn(
        "flex h-full flex-none flex-col gap-0.5 overflow-y-auto bg-rail py-3.5 text-chrome-muted transition-[width] duration-140",
        collapsed ? "w-rail-min px-2.5" : "w-rail px-3",
      )}
    >
      <Link
        href="/app"
        aria-label="ArchiTrac home"
        onClick={onNavigate}
        className={cn(
          "mb-2 flex h-10 items-center text-chrome-text no-underline",
          collapsed ? "justify-center" : "px-2.5",
        )}
      >
        <LogoMark showWord={!collapsed} />
      </Link>

      {entries.map((entry) => {
        if (entry.kind === "label") {
          return collapsed ? (
            <span
              key="label"
              role="separator"
              className="mx-2 my-2.5 block h-px bg-chrome-2"
            />
          ) : (
            <span
              key="label"
              className="block px-3 pt-4 pb-1.5 text-[10.5px] font-semibold tracking-[0.12em] text-rail-dim uppercase"
            >
              {entry.label}
            </span>
          );
        }

        const current = isCurrent(pathname, entry.href);
        const name = entry.off ? `${entry.label} (turned off)` : entry.label;
        return (
          <Link
            key={entry.key}
            href={entry.href}
            onClick={onNavigate}
            aria-label={name}
            title={name}
            aria-current={current ? "page" : undefined}
            data-off={entry.off ? "true" : undefined}
            className={cn(
              "relative flex h-10 shrink-0 items-center gap-3 rounded-sm text-xs tracking-[0.08em] whitespace-nowrap uppercase no-underline",
              "focus-visible:outline-2 focus-visible:outline-white",
              collapsed ? "mx-auto w-11 justify-center" : "w-full px-3",
              current
                ? "bg-chrome-2 font-semibold text-white shadow-[inset_2px_0_0_#FFFFFF]"
                : entry.off
                  ? "font-medium text-rail-dim hover:text-rail-item"
                  : "font-medium text-rail-item hover:text-white",
            )}
          >
            <svg {...iconProps(20, 1.75)} className="shrink-0">
              <path d={RAIL_ICONS[entry.key]} />
            </svg>
            {!collapsed && (
              <span className="min-w-0 flex-1 truncate">{entry.label}</span>
            )}
            {entry.off &&
              (collapsed ? (
                <span
                  aria-hidden="true"
                  className="absolute top-[7px] right-[7px] size-1.5 rounded-full bg-rail-dim"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex-none rounded-sm bg-chrome-2 px-[5px] py-px text-[9.5px] font-semibold tracking-[0.06em] text-rail-badge"
                >
                  ADD
                </span>
              ))}
          </Link>
        );
      })}

      {onToggleCollapsed && (
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand menu" : "Collapse menu"}
          title={collapsed ? "Expand menu" : "Collapse menu"}
          className={cn(
            "mt-auto flex h-[38px] shrink-0 cursor-pointer items-center gap-2.5 rounded-sm border-0 bg-transparent text-xs font-medium tracking-[0.04em] text-rail-dim hover:text-rail-item",
            "focus-visible:outline-2 focus-visible:outline-white",
            collapsed ? "mx-auto w-11 justify-center" : "w-full px-3",
          )}
        >
          <svg
            {...iconProps(18, 2)}
            className={cn("shrink-0", collapsed && "rotate-180")}
          >
            <path d={SHELL_ICONS.collapse} />
          </svg>
          {!collapsed && <span>Collapse menu</span>}
        </button>
      )}
    </nav>
  );
}
