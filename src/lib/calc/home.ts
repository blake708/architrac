// Home (home spec, business rules 2–9). Pure functions: the page and the
// tests share them. Dates are "YYYY-MM-DD" strings; money is in cents.

import { type InvoiceStatus, daysPastDue } from "./invoice";
import type { PhaseStatus } from "./projects";
import { type AgingTotal, OVER_60, agingTotals, balanceCents, isOpen, monthDay } from "./receivables";
import { type TimesheetStatus, isWeekend } from "./timesheet";

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

// ---------- Header ----------

export type Greeting = "morning" | "afternoon" | "evening";

/** 0–11 morning, 12–16 afternoon, 17–23 evening. */
export function greetingFor(hour: number): Greeting {
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

/** The hour (0–23) in a time zone. */
export function hourIn(timeZone: string, now: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(now));
}

/** "Sunday, October 18, 2026 · 10 active projects" (uppercase via CSS). */
export function homeEyebrow(today: string, activeProjects: number): string {
  const date = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(utc(today));
  return `${date} · ${activeProjects} active ${activeProjects === 1 ? "project" : "projects"}`;
}

// ---------- Board (rule 6) ----------

export type BoardPhase = { code: string; name: string; status: PhaseStatus; sortOrder: number };

/**
 * Lowest current phase, else lowest upcoming, else the last phase (complete
 * and closed phases only count then). Null when there are none.
 */
export function currentPhase<P extends BoardPhase>(phases: readonly P[]): P | null {
  const sorted = [...phases].sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    sorted.find((p) => p.status === "current") ??
    sorted.find((p) => p.status === "upcoming") ??
    sorted[sorted.length - 1] ??
    null
  );
}

export type BoardTemplate = { code: string; name: string; isOptional: boolean; sortOrder: number };

export type BoardColumn<C> = {
  /** Template code (lowercase), or "other". */
  key: string;
  name: string;
  /** Cards here show their phase name as a tag. */
  other: boolean;
  cards: C[];
};

export const OTHER_COLUMN = "other";

/**
 * Standard phases always, in order; optional phases only when a card is in
 * one; then "Other" for phases that match no template, when not empty.
 * Codes match case-insensitively. Cards sort by project number.
 */
export function boardColumns<C extends { number: string; phaseCode: string | null }>(
  templates: readonly BoardTemplate[],
  cards: readonly C[],
): BoardColumn<C>[] {
  const byOrder = (a: BoardTemplate, b: BoardTemplate) => a.sortOrder - b.sortOrder;
  const ordered = [...templates.filter((t) => !t.isOptional).sort(byOrder), ...templates.filter((t) => t.isOptional).sort(byOrder)];
  const cols: BoardColumn<C>[] = ordered.map((t) => ({ key: t.code.toLowerCase(), name: t.name, other: false, cards: [] }));
  const other: BoardColumn<C> = { key: OTHER_COLUMN, name: "Other", other: true, cards: [] };
  const byKey = new Map(cols.map((c) => [c.key, c]));
  for (const card of cards) (byKey.get(card.phaseCode?.toLowerCase() ?? "") ?? other).cards.push(card);
  for (const c of [...cols, other]) c.cards.sort((a, b) => a.number.localeCompare(b.number, "en", { numeric: true }));
  const optional = new Set(templates.filter((t) => t.isOptional).map((t) => t.code.toLowerCase()));
  return [...cols.filter((c) => !optional.has(c.key) || c.cards.length > 0), ...(other.cards.length ? [other] : [])];
}

/** Hours to one decimal place, trailing zero dropped: 412, 32.5. */
export function hoursText(h: number): string {
  return String(Math.round(h * 10) / 10);
}

export type HoursBar = { text: string; value: number; max: number; over: boolean } | { text: string; value: null; max: null; over: false };

/** Rule 8: "412 of 600 h"; no budget → "12 h · no budget" and no bar. */
export function hoursBar(used: number, budget: number): HoursBar {
  if (budget <= 0) return { text: `${hoursText(used)} h · no budget`, value: null, max: null, over: false };
  return { text: `${hoursText(used)} of ${hoursText(budget)} h`, value: used, max: budget, over: used > budget };
}

/** Rule 7: "20% billed", or "No fee" when there's no fee. */
export function billedText(pct: number | null): string {
  return pct === null ? "No fee" : `${pct}% billed`;
}

// ---------- Your time (rules 2–4) ----------

/** "Week of Oct 12". */
export const weekOf = (weekStart: string) => `Week of ${monthDay(weekStart)}`;

/** "Mon Oct 19". */
export function dueLabel(isoDate: string): string {
  const dow = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(utc(isoDate));
  return `${dow} ${monthDay(isoDate)}`;
}

/** Rule 2: whole percent, half up; null when the week is empty ("—"). */
export function weekBillablePct(billable: number, total: number): number | null {
  return total > 0 ? Math.round((billable / total) * 100) : null;
}

/** Indexes of the days that get a bar: weekdays always, Sat/Sun only with hours. */
export function chartDays(dates: readonly string[], dayTotals: readonly number[]): number[] {
  return dates.flatMap((d, i) => (!isWeekend(d) || (dayTotals[i] ?? 0) > 0 ? [i] : []));
}

export type StatusTone = "neutral" | "blue" | "green" | "orange";

export const TIMESHEET_PILL: Record<TimesheetStatus, { label: string; tone: StatusTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  submitted: { label: "Submitted", tone: "blue" },
  approved: { label: "Approved", tone: "green" },
  rejected: { label: "Returned", tone: "orange" },
};

/** Rule 3: the line under the chart. `status` null = no timesheet yet. */
export function timeStatusLine(
  status: TimesheetStatus | null,
  due: string,
  rejectionNote: string | null,
): { text: string; returned: boolean } {
  switch (status) {
    case null:
      return { text: `Not started · due ${dueLabel(due)}`, returned: false };
    case "draft":
      return { text: `Not submitted · due ${dueLabel(due)}`, returned: false };
    case "submitted":
      return { text: "Submitted · in review", returned: false };
    case "approved":
      return { text: "Approved", returned: false };
    case "rejected":
      return { text: rejectionNote ? `Returned: ${rejectionNote}` : "Returned", returned: true };
  }
}

/**
 * Rule 4: the banner about last week, or null. Shows when last week's sheet
 * is missing, draft or returned and its due time has passed.
 */
export function lastWeekBanner(
  status: TimesheetStatus | null,
  weekStart: string,
  dueAt: Date,
  now: Date,
): string | null {
  if (now <= dueAt) return null;
  if (status === "rejected") return `${weekOf(weekStart)} returned.`;
  if (status === null || status === "draft") return `${weekOf(weekStart)} not submitted.`;
  return null;
}

// ---------- Invoices outstanding (rule 9) ----------

export type HomeInvoice = {
  id: string;
  number: string | null;
  projectName: string;
  clientName: string;
  status: InvoiceStatus;
  dueDate: string;
  totalCents: number;
  amountPaidCents: number;
};

export type OutstandingRow = {
  id: string;
  number: string | null;
  projectName: string;
  clientName: string;
  balanceCents: number;
  daysPastDue: number;
  /** "62 days past due" or "Due Oct 30". */
  flag: string;
};

export type Outstanding = {
  totalCents: number;
  count: number;
  over60: number;
  buckets: AgingTotal[];
  rows: OutstandingRow[];
};

export const OUTSTANDING_LIST_MAX = 5;

/** Open invoices only; list = most days past due first, up to 5. */
export function outstanding(invoices: readonly HomeInvoice[], today: string): Outstanding {
  const open = invoices.filter((i) => isOpen(i.status));
  const buckets = agingTotals(open, today);
  const rows = open
    .map((i) => {
      const d = daysPastDue(today, i.dueDate);
      return {
        id: i.id,
        number: i.number,
        projectName: i.projectName,
        clientName: i.clientName,
        balanceCents: balanceCents(i),
        daysPastDue: d,
        flag: d > 0 ? `${d} ${d === 1 ? "day" : "days"} past due` : `Due ${monthDay(i.dueDate)}`,
      };
    })
    .sort((a, b) => b.daysPastDue - a.daysPastDue || (a.number ?? "").localeCompare(b.number ?? "", "en", { numeric: true }));
  return {
    totalCents: rows.reduce((n, r) => n + r.balanceCents, 0),
    count: rows.length,
    over60: buckets.filter((b) => OVER_60.includes(b.key)).reduce((n, b) => n + b.count, 0),
    buckets,
    rows: rows.slice(0, OUTSTANDING_LIST_MAX),
  };
}

/** "2 open invoices · 1 over 60 days" */
export function outstandingLine(o: Pick<Outstanding, "count" | "over60">): string {
  return `${o.count} open ${o.count === 1 ? "invoice" : "invoices"} · ${o.over60} over 60 days`;
}
