// Add-on modules a firm can switch on (settings-firm spec, business rules 2–3).
//
// Decided by Blake in 0.6: Schedule is a built-in part of Projects, not a
// module. Code is an add-on with no menu item; it shows up inside projects.

/** Every valid `firm_settings.modules_enabled` key, in card order. */
export const MODULE_KEYS = [
  "build",
  "workload",
  "accounting",
  "marketing",
  "knowledge",
  "code",
  "website",
  "hiring",
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export type ModuleInfo = { key: ModuleKey; name: string; description: string };

/** Card text (from mockup/Settings.dc.html). */
export const MODULES: readonly ModuleInfo[] = [
  {
    key: "build",
    name: "Build",
    description:
      "Construction administration: RFIs, submittals, field reports and pay applications.",
  },
  {
    key: "workload",
    name: "Workload",
    description:
      "See who is busy across every project, from the hours planned in each project schedule. Add tentative work from the pipeline to test new projects.",
  },
  {
    key: "accounting",
    name: "Accounting",
    description:
      "Invoicing, billing runs, payables, receipts and QuickBooks sync.",
  },
  {
    key: "marketing",
    name: "Marketing",
    description:
      "Pipeline, proposals with e-signature, and the project library.",
  },
  {
    key: "knowledge",
    name: "Knowledge",
    description:
      "Office standards, lessons learned, code and jurisdiction notes, and the details and product library.",
  },
  {
    key: "code",
    name: "Code",
    description:
      "Building code analysis inside each project: area, height, stories and occupant load.",
  },
  {
    key: "website",
    name: "Website",
    description: "Publish your portfolio straight from the project library.",
  },
  {
    key: "hiring",
    name: "Hiring",
    description: "Job postings, candidates and interview notes.",
  },
];

export function isModuleKey(value: string): value is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(value);
}

/**
 * Rule 3: how many modules are on. Unknown keys don't count.
 * TMG seed (all but Code) → 7, shown as "7 of 8".
 */
export function modulesOnCount(modulesEnabled: readonly string[]): number {
  return MODULE_KEYS.filter((k) => modulesEnabled.includes(k)).length;
}

/**
 * The list to save: known keys only, no repeats, in card order. Card order
 * (not A–Z) means switching a module on and off again saves the same array.
 */
export function normalizeModules(keys: readonly string[]): ModuleKey[] {
  return MODULE_KEYS.filter((k) => keys.includes(k));
}
