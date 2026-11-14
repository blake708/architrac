// Home (home spec, business rules 2–9, 12–13). Pure functions: the page and the
// tests share them. Dates are "YYYY-MM-DD" strings; money is in cents.

import { type InvoiceStatus, daysPastDue } from "./invoice";
import type { PhaseStatus } from "./projects";
import { type AgingTotal, OVER_60, agingTotals, balanceCents, isOpen, monthDay } from "./receivables";
import { type TimesheetStatus, addDays, isWeekend } from "./timesheet";
import { utilizationPct } from "./utilization";

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

// ---------- Firm health (rule 12) ----------

export type FirmUtilizationPerson = { billableHours: number; weeklyCapacityHours: number; targetBp: number | null };

/**
 * The firm's utilization over the Team page's 4-week window: Σ billable ÷
 * Σ (capacity × 4), with the same rounding as one person. Target = the
 * people's targets weighted by capacity, as a whole percent (null if no one
 * has one). People with no capacity don't count.
 */
export function firmUtilization(people: readonly FirmUtilizationPerson[]): { pct: number | null; targetPct: number | null } {
  const counted = people.filter((p) => p.weeklyCapacityHours > 0);
  const capacity = counted.reduce((n, p) => n + p.weeklyCapacityHours, 0);
  const pct = utilizationPct(
    counted.reduce((n, p) => n + p.billableHours, 0),
    capacity,
  );
  const targeted = counted.filter((p) => p.targetBp);
  const targetCapacity = targeted.reduce((n, p) => n + p.weeklyCapacityHours, 0);
  const targetPct = targetCapacity
    ? Math.round(targeted.reduce((n, p) => n + p.weeklyCapacityHours * (p.targetBp ?? 0), 0) / targetCapacity / 100)
    : null;
  return { pct, targetPct };
}

/** "Billable hours, last 4 weeks · target 75%" */
export function utilizationNote(targetPct: number | null): string {
  return targetPct === null ? "Billable hours, last 4 weeks" : `Billable hours, last 4 weeks · target ${targetPct}%`;
}

/** What a new invoice for the project would bill now: Σ its planned lines (never below 0). */
export function unbilledCents(plan: { lines: readonly { amountCents: number }[] }): number {
  return Math.max(0, plan.lines.reduce((n, l) => n + l.amountCents, 0));
}

/** "Time and fees not yet invoiced · 4 projects" */
export function unbilledNote(projects: number): string {
  return projects === 0
    ? "Time and fees not yet invoiced"
    : `Time and fees not yet invoiced · ${projects} ${projects === 1 ? "project" : "projects"}`;
}

// ---------- Due this week (rule 13) ----------

export type DueKind = "timesheet" | "approvals" | "phase" | "invoice";

/** The chip on each row. */
export const DUE_CHIP: Record<DueKind, { label: string; tone: "neutral" | "blue" | "green" }> = {
  timesheet: { label: "Time", tone: "neutral" },
  approvals: { label: "Time", tone: "neutral" },
  phase: { label: "Projects", tone: "blue" },
  invoice: { label: "Invoices", tone: "green" },
};

export type DueItem = {
  key: string;
  kind: DueKind;
  date: string;
  title: string;
  detail: string;
  href: string;
  /** Red flag text, e.g. "5 days late"; "" when not late. */
  flag: string;
};

export const DUE_MAX = 8;

const KIND_ORDER: DueKind[] = ["timesheet", "approvals", "phase", "invoice"];
const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/** Whole days from `from` to `to`. */
const daysBetween = (from: string, to: string) => Math.round((utc(to).getTime() - utc(from).getTime()) / 86_400_000);

/** Your timesheets not yet submitted, due on or before the week's end. */
export function timesheetDue(
  sheets: readonly { weekStart: string; status: TimesheetStatus | null; dueDate: string }[],
  weekEnd: string,
  today: string,
): DueItem[] {
  return sheets
    .filter((s) => (s.status === null || s.status === "draft" || s.status === "rejected") && s.dueDate <= weekEnd)
    .map((s) => ({
      key: `timesheet:${s.weekStart}`,
      kind: "timesheet",
      date: s.dueDate,
      title: s.status === "rejected" ? "Submit returned timesheet" : "Submit timesheet",
      detail: weekOf(s.weekStart),
      href: `/app/time/week/${s.weekStart}`,
      flag: s.dueDate < today ? `${days(daysBetween(s.dueDate, today))} late` : "",
    }));
}

/** One line for everything in your Approvals queue. */
export function approvalsDue(count: number, today: string): DueItem[] {
  if (count <= 0) return [];
  return [
    {
      key: "approvals",
      kind: "approvals",
      date: today,
      title: `Approve ${count} ${count === 1 ? "timesheet" : "timesheets"}`,
      detail: "Waiting on you",
      href: "/app/time/approvals",
      flag: "",
    },
  ];
}

/** Unfinished phases with an end date on or before the week's end. */
export function phasesDue(
  phases: readonly { id: string; projectId: string; projectName: string; name: string; status: PhaseStatus; endDate: string | null }[],
  weekEnd: string,
  today: string,
): DueItem[] {
  return phases.flatMap((p): DueItem[] =>
    p.endDate && p.endDate <= weekEnd && (p.status === "current" || p.status === "upcoming")
      ? [
          {
            key: `phase:${p.id}`,
            kind: "phase",
            date: p.endDate,
            title: `${p.name} ends`,
            detail: p.projectName,
            href: `/app/projects/${p.projectId}`,
            flag: p.endDate < today ? `${days(daysBetween(p.endDate, today))} late` : "",
          },
        ]
      : [],
  );
}

/** Open invoices due on or before the week's end. */
export function invoicesDue(invoices: readonly HomeInvoice[], weekEnd: string, today: string): DueItem[] {
  return invoices.flatMap((i): DueItem[] => {
    if (!isOpen(i.status) || i.dueDate > weekEnd) return [];
    const d = daysPastDue(today, i.dueDate);
    return [
      {
        key: `invoice:${i.id}`,
        kind: "invoice",
        date: i.dueDate,
        title: i.number ? `Invoice ${i.number} due` : "Invoice due",
        detail: `${i.projectName} · ${i.clientName}`,
        href: `/app/invoices/${i.id}`,
        flag: d > 0 ? `${days(d)} past due` : "",
      },
    ];
  });
}

/** Oldest first (late items lead), then by kind; up to 8 shown. */
export function dueList(items: readonly DueItem[]): { items: DueItem[]; more: number } {
  const sorted = [...items].sort(
    (a, b) => a.date.localeCompare(b.date) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.title.localeCompare(b.title),
  );
  return { items: sorted.slice(0, DUE_MAX), more: Math.max(0, sorted.length - DUE_MAX) };
}

/** The date column: "Mon / 19" in this week, "Sep / 16" outside it. */
export function dueDay(date: string, weekStart: string): { top: string; day: number } {
  const inWeek = date >= weekStart && date <= addDays(weekStart, 6);
  const top = new Intl.DateTimeFormat("en-US", inWeek ? { weekday: "short", timeZone: "UTC" } : { month: "short", timeZone: "UTC" }).format(utc(date));
  return { top, day: utc(date).getUTCDate() };
}
