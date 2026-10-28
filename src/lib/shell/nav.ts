// What the menu rail shows (app-shell spec, items table and business rules 3
// and 5). Plain functions so they can be unit tested and shared by the rail,
// the module pages and the page titles.

export type CoreKey =
  "home" | "projects" | "contacts" | "team" | "time" | "reports";

/** Add-on modules that get a rail item, in rail order. */
export const RAIL_MODULE_KEYS = [
  "build",
  "workload",
  "accounting",
  "marketing",
  "knowledge",
  "website",
  "hiring",
] as const;
export type RailModuleKey = (typeof RAIL_MODULE_KEYS)[number];

/**
 * Every valid `firm_settings.modules_enabled` key. `schedule` and `code` are
 * switched on in Settings but never get a rail item.
 */
export const MODULE_KEYS = ["schedule", ...RAIL_MODULE_KEYS, "code"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export type NavKey = CoreKey | RailModuleKey;

type NavDef = { key: NavKey; label: string; href: string; release: number };

export const CORE_ITEMS: readonly NavDef[] = [
  { key: "home", label: "Home", href: "/app", release: 1 },
  { key: "projects", label: "Projects", href: "/app/projects", release: 1 },
  { key: "contacts", label: "Contacts", href: "/app/contacts", release: 1 },
  { key: "team", label: "Team", href: "/app/team", release: 1 },
  { key: "time", label: "Time", href: "/app/time", release: 1 },
  { key: "reports", label: "Reports", href: "/app/reports", release: 2 },
];

/** `release` is when the module is planned to arrive (docs/ROADMAP.md). */
export const MODULE_ITEMS: readonly (NavDef & { key: RailModuleKey })[] = [
  { key: "build", label: "Build", href: "/app/build", release: 4 },
  { key: "workload", label: "Workload", href: "/app/workload", release: 3 },
  {
    key: "accounting",
    label: "Accounting",
    href: "/app/accounting",
    release: 2,
  },
  { key: "marketing", label: "Marketing", href: "/app/marketing", release: 3 },
  { key: "knowledge", label: "Knowledge", href: "/app/knowledge", release: 4 },
  { key: "website", label: "Website", href: "/app/website", release: 5 },
  { key: "hiring", label: "Hiring", href: "/app/hiring", release: 5 },
];

export function moduleItem(key: RailModuleKey) {
  const item = MODULE_ITEMS.find((m) => m.key === key);
  if (!item) throw new Error(`Unknown module: ${key}`);
  return item;
}

/** Rule 3: is this module switched on for the firm? Unknown keys are ignored. */
export function isModuleOn(
  settings: { modulesEnabled: readonly string[] },
  key: ModuleKey,
): boolean {
  return settings.modulesEnabled.includes(key);
}

export type RailEntry =
  | { kind: "item"; key: NavKey; label: string; href: string; off: boolean }
  | { kind: "label"; label: "Modules" };

/**
 * The rows of the menu rail, top to bottom.
 *
 * Modules that are on always show. Modules that are off show only to people
 * who can turn them on (owner/admin), dimmed with an "Add" badge; everyone
 * else doesn't see them. Decided by Blake in 0.5.
 * The "Modules" label shows only if at least one module row shows.
 */
export function railEntries(
  modulesEnabled: readonly string[],
  { showOffModules }: { showOffModules: boolean },
): RailEntry[] {
  const core: RailEntry[] = CORE_ITEMS.map((c) => ({
    kind: "item",
    key: c.key,
    label: c.label,
    href: c.href,
    off: false,
  }));
  const modules: RailEntry[] = MODULE_ITEMS.flatMap((m) => {
    const on = modulesEnabled.includes(m.key);
    if (!on && !showOffModules) return [];
    return [
      { kind: "item", key: m.key, label: m.label, href: m.href, off: !on },
    ];
  });
  if (modules.length === 0) return core;
  return [...core, { kind: "label", label: "Modules" }, ...modules];
}

/**
 * Rule 5: is this rail item the current page? Home (`/app`) only on an exact
 * match; everything else also matches the pages below it.
 */
export function isCurrent(pathname: string, href: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (href === "/app") return path === "/app";
  return path === href || path.startsWith(href + "/");
}

/** The header title for a page, from the first part of its path under /app. */
export function titleForPath(pathname: string): string | null {
  const all = [...CORE_ITEMS, ...MODULE_ITEMS];
  const extra: Record<string, string> = {
    "/app/settings": "Settings",
    "/app/account": "Your account",
  };
  const home = all.find((i) => i.href === "/app");
  if (isCurrent(pathname, "/app")) return home?.label ?? null;
  for (const [href, label] of Object.entries(extra)) {
    if (isCurrent(pathname, href)) return label;
  }
  return (
    all.find((i) => i.href !== "/app" && isCurrent(pathname, i.href))?.label ??
    null
  );
}
