// Timesheet math and rules (timesheet spec, business rules 1, 6, 7, 10–12).
// Pure functions: dates are "YYYY-MM-DD" strings, hours are numbers in
// quarter hours (0.25 steps are exact in floating point, so sums are too).
// The server runs the same submit checks the page shows live.

import { formatHours } from "@/lib/format";

export const DAYS_IN_WEEK = 7;
export const MAX_DAY_HOURS = 24;
export const NOTE_MAX = 500;

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

/** Rule 1: the most recent week-start day on or before the date. */
export function weekStartOf(isoDate: string, weekStartsOn: number): string {
  return addDays(isoDate, -((dayOfWeek(isoDate) - weekStartsOn + 7) % 7));
}

export function isIsoDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** The 7 dates of the week. */
export function weekDates(weekStart: string): string[] {
  return Array.from({ length: DAYS_IN_WEEK }, (_, i) => addDays(weekStart, i));
}

export function isWeekend(isoDate: string): boolean {
  const d = dayOfWeek(isoDate);
  return d === 0 || d === 6;
}

/**
 * The due date: the first `lockDay` on or after the week's fifth day.
 * Weeks from Monday Oct 12 → Monday due: Oct 19; Friday due: Oct 16.
 */
export function dueDate(weekStart: string, lockDay: number): string {
  const from = addDays(weekStart, 4);
  return addDays(from, (lockDay - dayOfWeek(from) + 7) % 7);
}

/** Minutes the time zone is ahead of UTC at that instant (New York in October: −240). */
function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** A wall-clock date and time ("09:00" or "09:00:00") in a time zone, as an instant. */
export function zonedInstant(isoDate: string, time: string, timeZone: string): Date {
  const [h, m] = time.split(":").map(Number);
  const guess = new Date(`${isoDate}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
  // Two passes settle the offset across a daylight-saving change.
  let t = guess.getTime() - zoneOffsetMinutes(guess, timeZone) * 60_000;
  t = guess.getTime() - zoneOffsetMinutes(new Date(t), timeZone) * 60_000;
  return new Date(t);
}

// ---------- Hours input (rules 6–7) ----------

export type HoursInput =
  | { kind: "empty" }
  | { kind: "hours"; hours: number; rounded: boolean }
  | { kind: "invalid" };

export const HOURS_INPUT_ERROR = "Enter hours like 1.5 or 1:30.";

/** Round to the nearest quarter hour. */
export function roundQuarter(h: number): number {
  return Math.round(h * 4) / 4;
}

export function isQuarterHours(h: number): boolean {
  return Number.isFinite(h) && Number.isInteger(h * 4);
}

/**
 * What the person typed in a day cell: `1.5`, `.75`, `1:30`, empty or 0.
 * Rounded to the nearest 0.25; anything that rounds to 0 is empty.
 */
export function parseHoursInput(text: string): HoursInput {
  const t = text.trim();
  if (t === "") return { kind: "empty" };
  let value: number;
  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(t);
  if (clock) value = Number(clock[1]) + Number(clock[2]) / 60;
  else if (/^(\d+(\.\d*)?|\.\d+)$/.test(t)) value = Number(t);
  else return { kind: "invalid" };
  if (!Number.isFinite(value)) return { kind: "invalid" };
  const hours = roundQuarter(value);
  if (hours === 0) return { kind: "empty" };
  return { kind: "hours", hours, rounded: Math.abs(hours - value) > 1e-9 };
}

/** "Oct 14" from "2026-10-14". */
export function shortDay(isoDate: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${isoDate}T00:00:00Z`),
  );
}

const h = formatHours;

export function dayLimitMessage(isoDate: string, total: number): string {
  return `${shortDay(isoDate)} would total ${h(total)} h. A day can't exceed ${MAX_DAY_HOURS} h.`;
}

// ---------- Rows and totals (rule 11) ----------

export type RowType = "project" | "overhead" | "leave";

/** One grid row, as the rules need it. `hours` and `notes` have 7 slots. */
export type CalcRow = {
  id: string;
  rowType: RowType | null;
  projectPhaseId: string | null;
  overheadCategoryId: string | null;
  activityId: string | null;
  billable: boolean;
  hours: number[];
  notes: (string | null)[];
  /** For messages and the phase summary. */
  projectNumber: string | null;
  projectName: string | null;
  phaseName: string | null;
  categoryName: string | null;
  activityName: string | null;
  /** The phase or its project is closed (rule 4). */
  closed: boolean;
  /** The activity is switched off (rule 5). */
  activityInactive: boolean;
};

export const rowTotal = (r: Pick<CalcRow, "hours">) => r.hours.reduce((a, b) => a + b, 0);

export type WeekTotals = {
  dayTotals: number[];
  weekTotal: number;
  billable: number;
  nonBillable: number;
  /** Whole percent; 0 when the week is empty. */
  billablePct: number;
  /** Bar segment widths, in percent of the target. */
  billableWidth: number;
  nonBillableWidth: number;
  /** Hours below the weekly target (0 when met). */
  short: number;
};

export function weekTotals(rows: Pick<CalcRow, "hours" | "billable">[], targetHours: number): WeekTotals {
  const dayTotals = Array.from({ length: DAYS_IN_WEEK }, (_, d) => rows.reduce((a, r) => a + (r.hours[d] ?? 0), 0));
  const weekTotal = dayTotals.reduce((a, b) => a + b, 0);
  const billable = rows.filter((r) => r.billable).reduce((a, r) => a + rowTotal(r), 0);
  const base = targetHours > 0 ? targetHours : weekTotal || 1;
  const billableWidth = Math.min(100, (billable / base) * 100);
  return {
    dayTotals,
    weekTotal,
    billable,
    nonBillable: weekTotal - billable,
    billablePct: weekTotal ? Math.round((billable / weekTotal) * 100) : 0,
    billableWidth,
    nonBillableWidth: Math.max(0, Math.min(100, (weekTotal / base) * 100) - billableWidth),
    short: Math.max(0, targetHours - weekTotal),
  };
}

/** Mon–Fri days below the daily target (weekly ÷ 5). Weekends never are. */
export function shortDays(dates: string[], dayTotals: number[], weeklyTarget: number): boolean[] {
  const daily = weeklyTarget / 5;
  return dates.map((d, i) => !isWeekend(d) && dayTotals[i] < daily);
}

/** "28 billable · 4.5 non-billable · 86% billable" */
export function billableNote(t: WeekTotals): string {
  return `${h(t.billable)} billable · ${h(t.nonBillable)} non-billable · ${t.billablePct}% billable`;
}

/** Rule 12: what the week feeds, by project phase, overhead and leave. */
export function phaseSummary(rows: CalcRow[]): string {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const total = rowTotal(r);
    if (!total || !r.rowType) continue;
    const key =
      r.rowType === "project"
        ? `${(r.projectName ?? "").split(",")[0].trim()} · ${r.phaseName ?? "No phase"}`
        : r.rowType === "overhead"
          ? `Overhead · ${r.categoryName ?? "No phase"}`
          : `${r.categoryName ?? "Leave"} · Leave`;
    totals.set(key, (totals.get(key) ?? 0) + total);
  }
  if (!totals.size) return "Nothing yet";
  return [...totals].map(([k, v]) => `${k} ${h(v)} h`).join(" · ");
}

// ---------- Submit checks (rule 10) ----------

export function isRowComplete(r: CalcRow): boolean {
  if (!r.rowType || !r.activityId) return false;
  return r.rowType === "project" ? r.projectPhaseId !== null : r.overheadCategoryId !== null;
}

/** Rows that are the same line (rule 10e): same phase or category, activity and billing. */
export function rowKey(r: Pick<CalcRow, "rowType" | "projectPhaseId" | "overheadCategoryId" | "activityId" | "billable">): string {
  return [r.rowType, r.projectPhaseId ?? r.overheadCategoryId, r.activityId, r.billable].join("|");
}

/** "2026-014", or "Overhead", or the leave category. */
function rowLabel(r: CalcRow): string {
  if (r.rowType === "project") return r.projectNumber ?? "Project";
  if (r.rowType === "overhead") return "Overhead";
  return r.categoryName ?? "Leave";
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export type SubmitCheck = {
  dates: string[];
  /** Today in the firm's time zone. */
  today: string;
  billableNotesRequired: boolean;
};

/**
 * Everything that blocks submit, in the spec's order (rule 10). The footer
 * shows the first one. Rows with no hours are ignored (they're dropped).
 */
export function submitProblems(rows: CalcRow[], check: SubmitCheck): string[] {
  const out: string[] = [];
  const withHours = rows.filter((r) => rowTotal(r) > 0);
  const totals = weekTotals(withHours, 0);

  if (totals.weekTotal <= 0) out.push("Add your hours before submitting.");

  const incomplete = withHours.filter((r) => !isRowComplete(r)).length;
  if (incomplete)
    out.push(
      `${incomplete} ${plural(incomplete, "row needs", "rows need")} a phase and an activity before you can submit.`,
    );

  for (const r of withHours.filter((x) => x.closed))
    out.push(`${[rowLabel(r), r.phaseName].filter(Boolean).join(" ")} is closed. Move these hours to an open phase.`);

  for (const r of withHours.filter((x) => x.activityInactive && x.activityId))
    out.push(`${r.activityName ?? "That activity"} is no longer offered. Pick another activity on ${rowLabel(r)}.`);

  const seen = new Set<string>();
  const reported = new Set<string>();
  for (const r of withHours.filter(isRowComplete)) {
    const key = rowKey(r);
    if (seen.has(key) && !reported.has(key)) {
      reported.add(key);
      const middle = r.rowType === "project" ? r.phaseName : r.rowType === "overhead" ? r.categoryName : null;
      out.push(`Two rows are both ${[rowLabel(r), middle, r.activityName].filter(Boolean).join(" · ")}. Combine them.`);
    }
    seen.add(key);
  }

  totals.dayTotals.forEach((t, i) => {
    if (t > MAX_DAY_HOURS) out.push(`${shortDay(check.dates[i])} totals ${h(t)} h. A day can't exceed ${MAX_DAY_HOURS} h.`);
  });

  if (check.today < check.dates[0]) out.push("You can't submit a week that hasn't started.");

  if (check.billableNotesRequired) {
    const missing = withHours.reduce((n, r) => n + r.hours.filter((_, i) => needsNote(r, i)).length, 0);
    if (missing)
      out.push(`${missing} billable ${plural(missing, "day needs", "days need")} a note before you can submit.`);
  }
  return out;
}

/** The short-week warning (rule 10, warning only). Null when the target is met. */
export function shortWarning(weekTotal: number, targetHours: number): string | null {
  const short = targetHours - weekTotal;
  if (short <= 0) return null;
  return `${h(short)} ${plural(short, "hour", "hours")} short of ${h(targetHours)}. Add the missing time, or log PTO or a holiday before submitting.`;
}

// ---------- Status (rules 2, 14, 18) ----------

export type TimesheetStatus = "draft" | "submitted" | "leader_approved" | "approved" | "rejected";

/** Rule 2: no timesheet yet counts as a draft. */
export function isEditable(status: TimesheetStatus | null): boolean {
  return status === null || status === "draft" || status === "rejected";
}

/** Rule 14: recall while no reviewer has acted. */
export function canRecall(status: TimesheetStatus | null, leaderApprovedAt: Date | string | null): boolean {
  return status === "submitted" || (status === "leader_approved" && leaderApprovedAt === null);
}

/**
 * Rule 18: who reviews first. The team leader when there is one, they're
 * active and they aren't the person; otherwise straight to a principal.
 */
export function submitRoute(
  membershipId: string,
  leader: { membershipId: string; active: boolean } | null,
): { status: "submitted" | "leader_approved"; reviewerMembershipId: string | null } {
  if (leader && leader.active && leader.membershipId !== membershipId)
    return { status: "submitted", reviewerMembershipId: leader.membershipId };
  return { status: "leader_approved", reviewerMembershipId: null };
}

// ---------- Copy last week (rule 13) ----------

/** A row from last week, with what's needed to decide if it can be copied. */
export type CopySource = CalcRow & {
  /** The overhead phase or leave type is switched off. */
  categoryInactive: boolean;
  /** The project is active (not on hold, in pursuit or closed). */
  projectActive: boolean;
};

export type CopyPlan<T extends CopySource> = {
  copy: T[];
  /** Why rows were left out, one sentence each. */
  skipped: string[];
  /** Rows left out because this week already has the same row. */
  alreadyHere: number;
};

/** Why a row can't be copied, or null when it can. */
function copyBlocker(r: CopySource): string | null {
  if (r.rowType === "project") {
    const label = r.projectNumber ?? "That project";
    if (r.closed) return `${[label, r.phaseName ?? r.projectName].filter(Boolean).join(" ")} is closed.`;
    if (!r.projectActive) return `${[label, r.projectName].filter(Boolean).join(" ")} isn't active.`;
  } else if (r.categoryInactive) {
    return `${r.categoryName ?? "That phase"} is no longer offered.`;
  }
  if (r.activityId && r.activityInactive) return `${r.activityName ?? "That activity"} is no longer offered.`;
  return null;
}

/**
 * Rule 13: which of last week's rows to add (selection and billing only,
 * never hours or notes). Rows that were never chosen are ignored; rows this
 * week already has (same rule 10e key) aren't added twice.
 */
export function copyPlan<T extends CopySource>(source: T[], existing: CalcRow[]): CopyPlan<T> {
  const keys = new Set(existing.filter((r) => r.rowType).map(rowKey));
  const plan: CopyPlan<T> = { copy: [], skipped: [], alreadyHere: 0 };
  for (const r of source) {
    if (!r.rowType) continue;
    const blocked = copyBlocker(r);
    if (blocked) {
      plan.skipped.push(blocked);
      continue;
    }
    const key = rowKey(r);
    if (keys.has(key)) {
      plan.alreadyHere += 1;
      continue;
    }
    keys.add(key);
    plan.copy.push(r);
  }
  return plan;
}

export const COPY_NO_SOURCE = "There's no timesheet for last week to copy.";

/** The toast after Copy last week. */
export function copyMessage(plan: Pick<CopyPlan<CopySource>, "skipped" | "alreadyHere"> & { copied: number }): string {
  if (plan.copied === 0 && plan.skipped.length === 0 && plan.alreadyHere === 0) return COPY_NO_SOURCE;
  const head =
    plan.copied > 0
      ? `Copied ${plan.copied} ${plural(plan.copied, "row", "rows")}.`
      : plan.alreadyHere > 0
        ? "Last week's rows are already on this timesheet."
        : "Nothing copied.";
  return plan.skipped.length ? `${head} Skipped ${plan.skipped.length}: ${plan.skipped.join(" ")}` : head;
}

// ---------- Notes ----------

export const NOTE_TOO_LONG = `Notes can be up to ${NOTE_MAX} characters.`;

/** A note as saved: trimmed, empty → null. */
export function cleanNote(text: string | null): string | null {
  const t = (text ?? "").trim();
  return t ? t : null;
}

/** Billable days with hours and no note, when notes are required (rule 10h). */
export function needsNote(r: Pick<CalcRow, "billable" | "hours" | "notes">, day: number): boolean {
  return r.billable && r.hours[day] > 0 && !r.notes[day]?.trim();
}
