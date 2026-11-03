// Project page math (project-detail spec, business rules 3, 4, 7–10 and the
// Overview tiles). Pure functions: money in cents, rates in basis points.

import type { FeeType, PhaseStatus } from "./projects";

/** a ÷ b rounded half away from zero (b > 0). */
function roundDiv(a: number, b: number): number {
  const q = Math.floor(Math.abs(a) / b);
  const r = Math.abs(a) - q * b;
  const n = r * 2 >= b ? q + 1 : q;
  return a < 0 ? -n : n;
}

// ---------------------------------------------------------------------------
// Rule 7: consultant fee to client

/** Fee × (1 + markup), or null when it isn't billed through. */
export function consultantFeeToClient(c: { feeCents: number; markupBp: number; billedThrough: boolean }): number | null {
  if (!c.billedThrough) return null;
  return roundDiv(c.feeCents * (10_000 + c.markupBp), 10_000);
}

// ---------------------------------------------------------------------------
// Rule 8: fee-type summary

const SUMMARY: Record<FeeType, [string, string]> = {
  fixed: ["Fixed fee", "billed by % complete"],
  hourly: ["Hourly", "billed by hours worked"],
  nte: ["Not-to-exceed", "hourly up to a cap"],
};

/** "Fixed fee · billed by % complete", or the short form "Fixed fee". */
export function feeTypeSummary(types: readonly FeeType[], short = false): string {
  const set = new Set(types);
  if (set.size !== 1) return "Mixed fee types";
  const [name, how] = SUMMARY[[...set][0]];
  return short ? name : `${name} · ${how}`;
}

// ---------------------------------------------------------------------------
// Rule 9: stepper note

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const md = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
const my = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

export function stepperNote(p: { status: PhaseStatus; startDate: string | null; endDate: string | null }): string {
  if (p.status === "complete" || p.status === "closed") return p.endDate ? `Done · ${md(p.endDate)}` : "Done";
  if (p.status === "current") return p.endDate ? `Now · to ${md(p.endDate)}` : "Now";
  if (p.startDate && p.endDate) return `${md(p.startDate)} – ${md(p.endDate)}`;
  if (p.startDate) return `From ${my(p.startDate)}`;
  return "—";
}

// ---------------------------------------------------------------------------
// Rule 4 and the Hours tile

/** "4 h" or "15 h over". */
export function remainingText(budgetHours: number, usedHours: number): { text: string; over: boolean } {
  const left = Math.round((budgetHours - usedHours) * 100) / 100;
  return left < 0 ? { text: `${fmtHours(-left)} h over`, over: true } : { text: `${fmtHours(left)} h`, over: false };
}

/** 1240 → "1,240"; 12.5 → "12.5". */
export function fmtHours(h: number): string {
  return h.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Hours tile note: "of 1,240 budgeted · SD ran 15 h over". */
export function hoursNote(
  phases: readonly { code: string; sortOrder: number; budgetHours: number; usedHours: number }[],
): string {
  const budget = phases.reduce((n, p) => n + p.budgetHours, 0);
  let worst: { code: string; over: number } | null = null;
  for (const p of [...phases].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const over = p.usedHours - p.budgetHours;
    if (over > 0 && (!worst || over > worst.over)) worst = { code: p.code, over };
  }
  const base = `of ${fmtHours(budget)} budgeted`;
  return worst ? `${base} · ${worst.code} ran ${fmtHours(Math.round(worst.over * 100) / 100)} h over` : base;
}

// ---------------------------------------------------------------------------
// Overview tiles

/** Fee as a % of construction, one decimal: "3.0%". Null without a cost. */
export function pctOfConstruction(feeCents: number, constructionCents: number | null): string | null {
  if (!constructionCents || constructionCents <= 0) return null;
  return `${(roundDiv(feeCents * 1000, constructionCents) / 10).toFixed(1)}%`;
}

/** Construction cost per square foot in whole dollars, or null. */
export function costPerSfDollars(constructionCents: number | null, squareFeet: number | null): number | null {
  if (!constructionCents || !squareFeet) return null;
  return roundDiv(constructionCents, squareFeet * 100);
}

// ---------------------------------------------------------------------------
// Rule 10: activity text

export type ActivityRow = {
  entityType: string;
  action: string;
  label: string;
  changes: Record<string, unknown> | null;
};

const FIELD_NAMES: Record<string, string> = {
  feeCents: "fee",
  budgetHours: "budget hours",
  percentCompleteBp: "% complete",
  projectRole: "role",
  billRateOverrideCents: "rate override",
  markupBp: "markup",
  billedThrough: "billed through",
  pmMembershipId: "PM",
  principalMembershipId: "principal",
  clientCompanyId: "client",
  clientContactId: "client contact",
  projectType: "type",
  scopeKind: "scope",
  constructionCostCents: "construction estimate",
  squareFeet: "square feet",
  addressLine1: "address",
  startDate: "start date",
  targetEndDate: "target end",
};
const fieldName = (k: string) => FIELD_NAMES[k] ?? k.replace(/([A-Z])/g, " $1").toLowerCase();

export function activityText(row: ActivityRow): string {
  const label = row.entityType === "project" ? "the project" : row.label;
  if (row.action === "created") return `created ${label}`;
  if (row.action === "archived" || row.action === "removed") return `removed ${label}`;
  if (row.action === "status_changed") {
    const after = (row.changes?.status as { after?: string } | undefined)?.after ?? "";
    return `moved ${label} to ${after.replace(/_/g, " ")}`;
  }
  const keys = Object.keys(row.changes ?? {}).filter((k) => k !== "status");
  const shown = keys.slice(0, 3).map(fieldName);
  return shown.length ? `updated ${label} (${shown.join(", ")})` : `updated ${label}`;
}
