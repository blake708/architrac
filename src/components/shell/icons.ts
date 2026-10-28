import type { NavKey } from "@/lib/shell/nav";

// SVG paths for the menu rail, copied from mockup/Settings.dc.html → ICONS.
// Drawn on a 24×24 grid with a 1.75 stroke.
export const RAIL_ICONS: Record<NavKey, string> = {
  home: "M3 11l9-7 9 7M5 10v10h14V10",
  projects:
    "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  contacts:
    "M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 19v-1a4 4 0 0 0-3-3.9M15 3.2a3.5 3.5 0 0 1 0 6.6",
  team: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1",
  time: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3 2",
  reports: "M3 21h18M6 21V11M11 21V5M16 21v-7M21 21v-4",
  build: "M3 18h18M5 18v-3a7 7 0 0 1 14 0v3M12 8V5M9 11V8.7M15 11V8.7",
  workload: "M4 5h9M4 10h15M4 15h12M4 20h6",
  accounting:
    "M12 3v18M16 7.5c-.5-1.5-2-2.5-4-2.5-2.2 0-4 1.3-4 3s1.8 2.6 4 3 4 1.3 4 3-1.8 3-4 3c-2 0-3.5-1-4-2.5",
  marketing:
    "M3 10v4h4l6 4V6L7 10zM17 9a4 4 0 0 1 0 6M19.5 6.5a7.5 7.5 0 0 1 0 11",
  knowledge:
    "M2 5h6a4 4 0 0 1 4 4v11a3 3 0 0 0-3-3H2zM22 5h-6a4 4 0 0 0-4 4v11a3 3 0 0 1 3-3h7z",
  website:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M3 12h18M12 3c2.5 2.5 3.8 5.6 3.8 9s-1.3 6.5-3.8 9M12 3c-2.5 2.5-3.8 5.6-3.8 9s1.3 6.5 3.8 9",
  hiring: "M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 7h18v12H3zM3 12h18",
};

// Header and rail controls (from mockup/Home.dc.html).
export const SHELL_ICONS = {
  collapse: "M4 4v16M15 7l-5 5 5 5M10 12h10",
  chevronDown: "M6 9l6 6 6-6",
  check: "M5 12l5 5L20 7",
  menu: "M4 6h16M4 12h16M4 18h16",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
} as const;

/** A stroke icon from one of the path strings above. */
export function iconProps(size: number, strokeWidth: number) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
}
