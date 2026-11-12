// Invoice math (invoicing spec, business rules 2–11). Pure functions over
// integer cents, basis points and hundredths of an hour. Money rounds half
// up at the last step (ADR 0004); nothing here touches the database.

import { addDays } from "./timesheet";

export type InvoiceStatus = "draft" | "in_review" | "sent" | "partially_paid" | "paid" | "void" | "written_off";
export type InvoiceLineType = "phase_fee" | "hourly" | "consultant" | "expense" | "adjustment";
export type FeeType = "fixed" | "hourly" | "nte";

/** Invoices that went out: they count as billed (rules 2 and 11). */
export const COUNTED_STATUSES: ReadonlySet<InvoiceStatus> = new Set(["sent", "partially_paid", "paid", "written_off"]);
/** Invoices with money still owed (KPIs, aging). */
export const OPEN_STATUSES: ReadonlySet<InvoiceStatus> = new Set(["sent", "partially_paid"]);
/** A project has at most one of these at a time (rule 12). */
export const DRAFT_STATUSES: ReadonlySet<InvoiceStatus> = new Set(["draft", "in_review"]);

// ---------------------------------------------------------------------------
// Rounding

/** a ÷ b rounded to the nearest whole number, .5 away from zero (b > 0). */
export function divRoundHalfUp(a: number, b: number): number {
  if (!(b > 0)) throw new Error("divRoundHalfUp needs a positive divisor");
  const abs = Math.abs(a);
  const q = Math.floor(abs / b);
  const r = abs - q * b;
  const n = r * 2 >= b ? q + 1 : q;
  return a < 0 ? -n : n;
}

/** "10.50" (numeric from the database) → 1050 hundredths, without float error. */
export function hoursToHundredths(hours: string | number): number {
  const text = typeof hours === "number" ? hours.toFixed(2) : hours.trim();
  const m = /^(-?)(\d+)(?:\.(\d{1,2})\d*)?$/.exec(text);
  if (!m) throw new Error(`Not an hours value: ${hours}`);
  const n = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0"));
  return m[1] ? -n : n;
}

// ---------------------------------------------------------------------------
// Rule 2: previously billed

/**
 * Whether a line counts toward a phase's billed amount: fixed-fee phases
 * count their phase-fee lines, hourly and NTE phases their hourly and
 * adjustment lines. Consultant and expense lines never count.
 */
export function lineCountsForPhase(feeType: FeeType, lineType: InvoiceLineType): boolean {
  return feeType === "fixed" ? lineType === "phase_fee" : lineType === "hourly" || lineType === "adjustment";
}

export type PriorLine = {
  invoiceId: string;
  invoiceStatus: InvoiceStatus;
  /** The invoice's issue date, to find the most recent line. */
  issueDate: string | null;
  projectPhaseId: string | null;
  lineType: InvoiceLineType;
  amountCents: number;
  percentCompleteBp: number | null;
  /** Consultant lines: which consultant (decision #31). */
  consultantId?: string | null;
};

/** Lines on counted invoices for this phase, excluding the invoice being built. */
function countedLines(lines: readonly PriorLine[], phaseId: string, feeType: FeeType, currentInvoiceId: string | null) {
  return lines.filter(
    (l) =>
      l.projectPhaseId === phaseId &&
      l.invoiceId !== currentInvoiceId &&
      COUNTED_STATUSES.has(l.invoiceStatus) &&
      lineCountsForPhase(feeType, l.lineType),
  );
}

/** Rule 2. Callers pass non-archived lines on non-archived invoices. */
export function previouslyBilled(
  lines: readonly PriorLine[],
  phaseId: string,
  feeType: FeeType,
  currentInvoiceId: string | null,
): number {
  return countedLines(lines, phaseId, feeType, currentInvoiceId).reduce((n, l) => n + l.amountCents, 0);
}

/** Rule 3: % complete on the phase's most recent counted phase-fee line (0 if none). */
export function lastBilledBp(lines: readonly PriorLine[], phaseId: string, currentInvoiceId: string | null): number {
  const counted = countedLines(lines, phaseId, "fixed", currentInvoiceId);
  let best: PriorLine | null = null;
  for (const l of counted)
    if (!best || (l.issueDate ?? "") > (best.issueDate ?? "") || (l.issueDate === best.issueDate && (l.percentCompleteBp ?? 0) > (best.percentCompleteBp ?? 0)))
      best = l;
  return best?.percentCompleteBp ?? 0;
}

/** Consultant lines on counted invoices for this consultant, excluding the invoice being built. */
function consultantLines(lines: readonly PriorLine[], consultantId: string, currentInvoiceId: string | null) {
  return lines.filter(
    (l) =>
      l.lineType === "consultant" &&
      l.consultantId === consultantId &&
      l.invoiceId !== currentInvoiceId &&
      COUNTED_STATUSES.has(l.invoiceStatus),
  );
}

/** Rule 6 (decision #31): billed so far for a consultant's fee. */
export function consultantPreviouslyBilled(lines: readonly PriorLine[], consultantId: string, currentInvoiceId: string | null): number {
  return consultantLines(lines, consultantId, currentInvoiceId).reduce((n, l) => n + l.amountCents, 0);
}

/** Rule 6: % complete on the consultant's most recent counted line (0 if none). */
export function consultantLastBilledBp(lines: readonly PriorLine[], consultantId: string, currentInvoiceId: string | null): number {
  let best: PriorLine | null = null;
  for (const l of consultantLines(lines, consultantId, currentInvoiceId))
    if (!best || (l.issueDate ?? "") > (best.issueDate ?? "") || (l.issueDate === best.issueDate && (l.percentCompleteBp ?? 0) > (best.percentCompleteBp ?? 0)))
      best = l;
  return best?.percentCompleteBp ?? 0;
}

// ---------------------------------------------------------------------------
// Rule 3: fixed-fee lines

export const BELOW_BILLED_MESSAGE = (lastBilledPct: string) => `% complete is below what's already billed (${lastBilledPct}).`;

/** 3025 bp → "30.25%", 6000 → "60%". */
export function formatPercentBp(bp: number): string {
  const whole = Math.trunc(bp / 100);
  const frac = Math.abs(bp % 100);
  return frac === 0 ? `${whole}%` : `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}%`;
}

export type FixedFeeResult =
  | { ok: true; earnedToDateCents: number; amountCents: number; /** Nothing to bill this time: no line. */ omit: boolean }
  | { ok: false; error: string };

export function fixedFeeLine(input: {
  feeCents: number;
  percentCompleteBp: number;
  previouslyBilledCents: number;
  lastBilledBp: number;
}): FixedFeeResult {
  const { feeCents, percentCompleteBp, previouslyBilledCents } = input;
  if (!Number.isInteger(percentCompleteBp) || percentCompleteBp < 0 || percentCompleteBp > 10000)
    return { ok: false, error: "Enter a % complete from 0 to 100." };
  const below = { ok: false as const, error: BELOW_BILLED_MESSAGE(formatPercentBp(input.lastBilledBp)) };
  if (percentCompleteBp < input.lastBilledBp) return below;
  const earnedToDateCents = divRoundHalfUp(feeCents * percentCompleteBp, 10000);
  const amountCents = earnedToDateCents - previouslyBilledCents;
  // Also catches a fee lowered after it was billed.
  if (amountCents < 0) return below;
  return { ok: true, earnedToDateCents, amountCents, omit: amountCents === 0 };
}

// ---------------------------------------------------------------------------
// Rule 4: hourly lines

export type BillableEntry = {
  /** firm_roles.name of the person's billing role. */
  roleName: string;
  /** Frozen on the entry at approval; never looked up again. */
  billRateCents: number;
  /** numeric(5,2) from the database, e.g. "10.50". */
  hours: string | number;
};

export type HourlyGroup = {
  roleName: string;
  rateCents: number;
  hoursHundredths: number;
  amountCents: number;
};

/**
 * Group a phase's eligible entries by (role, rate). Amount =
 * roundHalfUp(Σ hours × 100 × rate / 100), rounded once per group.
 * Highest rate first, then role name.
 */
export function hourlyGroups(entries: readonly BillableEntry[]): HourlyGroup[] {
  const groups = new Map<string, HourlyGroup>();
  for (const e of entries) {
    const key = `${e.roleName}\u0000${e.billRateCents}`;
    const g = groups.get(key) ?? { roleName: e.roleName, rateCents: e.billRateCents, hoursHundredths: 0, amountCents: 0 };
    g.hoursHundredths += hoursToHundredths(e.hours);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, amountCents: divRoundHalfUp(g.hoursHundredths * g.rateCents, 100) }))
    .sort((a, b) => b.rateCents - a.rateCents || a.roleName.localeCompare(b.roleName));
}

// ---------------------------------------------------------------------------
// Rule 5: not-to-exceed

export type NteWarning = "none" | "approaching" | "reached";

export type NteResult = {
  /** What the phase bills this time. */
  netCents: number;
  /** Time not billed because of the cap (0 when under). Becomes a negative adjustment line. */
  writeDownCents: number;
  /** (previously billed + net) ÷ cap in basis points, rounded down; null when the cap is 0. */
  pctOfCapBp: number | null;
  warning: NteWarning;
};

export function nteCap(input: { capCents: number; previouslyBilledCents: number; hourlyAmountCents: number }): NteResult {
  const { capCents, previouslyBilledCents, hourlyAmountCents } = input;
  const remaining = Math.max(0, capCents - previouslyBilledCents);
  const netCents = Math.min(hourlyAmountCents, remaining);
  const writeDownCents = hourlyAmountCents - netCents;
  if (capCents <= 0) return { netCents, writeDownCents, pctOfCapBp: null, warning: writeDownCents > 0 ? "reached" : "none" };
  const used = previouslyBilledCents + netCents;
  const pctOfCapBp = Math.floor((used * 10000) / capCents);
  const warning: NteWarning = used >= capCents ? "reached" : pctOfCapBp >= 9000 ? "approaching" : "none";
  return { netCents, writeDownCents, pctOfCapBp, warning };
}

// ---------------------------------------------------------------------------
// Rule 6: consultants

/** A fee plus the markup: roundHalfUp(cost × (10000 + markup) / 10000). The client-facing consultant fee. */
export function consultantAmount(costCents: number, markupBp: number): number {
  return divRoundHalfUp(costCents * (10000 + markupBp), 10000);
}

// ---------------------------------------------------------------------------
// WIP on fixed-fee phases (1.8 B, Blake 2026-11-11)

/** Bill-rate value of time: roundHalfUp(Σ hours × 100 × rate / 100), rounded once. */
export function timeValueCents(entries: readonly { hours: string | number; rateCents: number }[]): number {
  return divRoundHalfUp(
    entries.reduce((n, e) => n + hoursToHundredths(e.hours) * e.rateCents, 0),
    100,
  );
}

/** Hours used ÷ budget hours as a suggested % complete, capped at 100 %; null with no budget. */
export function hoursSuggestBp(usedHundredths: number, budgetHours: string | number): number | null {
  const budget = hoursToHundredths(budgetHours);
  if (budget <= 0) return null;
  return Math.min(10000, divRoundHalfUp(usedHundredths * 10000, budget));
}

// ---------------------------------------------------------------------------
// Rule 7: totals

export type InvoiceTotals = { subtotalCents: number; taxCents: number; totalCents: number };

/** Σ line amounts. Tax is 0 in Release 1 (professional services). */
export function invoiceTotals(lines: readonly { amountCents: number }[]): InvoiceTotals {
  const subtotalCents = lines.reduce((n, l) => n + l.amountCents, 0);
  return { subtotalCents, taxCents: 0, totalCents: subtotalCents };
}

// ---------------------------------------------------------------------------
// Rule 8: dates

/** Issue date + payment terms. Oct 16 + 30 → Nov 15. */
export const invoiceDueDate = (issueDate: string, termsDays: number) => addDays(issueDate, termsDays);

/** The day after the previous counted invoice's period, else the project start (may be null). */
export function periodStart(previousPeriodEnd: string | null, projectStartDate: string | null): string | null {
  return previousPeriodEnd ? addDays(previousPeriodEnd, 1) : projectStartDate;
}

/** Last day of the month containing `isoDate`: the default "Period through". */
export function endOfMonth(isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Rule 9: payments

export type PaidStatus = "sent" | "partially_paid" | "paid";

/** Status from what's been paid. Overpayment is blocked before this is called. */
export function statusFromPaid(totalCents: number, paidCents: number): PaidStatus {
  if (paidCents <= 0) return "sent";
  return paidCents >= totalCents ? "paid" : "partially_paid";
}

/** Why a payment can't be recorded, or null. */
export function paymentProblem(amountCents: number, balanceCents: number, receivedOn: string, today: string): string | null {
  if (!Number.isInteger(amountCents) || amountCents <= 0) return "Enter an amount over $0.";
  if (amountCents > balanceCents) return "That's more than the balance.";
  if (receivedOn > today) return "The received date can't be in the future.";
  return null;
}

// ---------------------------------------------------------------------------
// Rule 10: aging

/** Whole days between two ISO dates (b − a). */
export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** today − due date; negative while not yet due. */
export const daysPastDue = (today: string, dueDate: string) => daysBetween(dueDate, today);

export type AgingBucket = "current" | "1_30" | "31_60" | "61_90" | "90_plus";

export const AGING_BUCKETS: readonly { key: AgingBucket; label: string }[] = [
  { key: "current", label: "Current" },
  { key: "1_30", label: "1–30" },
  { key: "31_60", label: "31–60" },
  { key: "61_90", label: "61–90" },
  { key: "90_plus", label: "90+" },
];

export function agingBucket(days: number): AgingBucket {
  if (days <= 0) return "current";
  if (days <= 30) return "1_30";
  if (days <= 60) return "31_60";
  if (days <= 90) return "61_90";
  return "90_plus";
}

export type AgingPill = { label: string; tone: "neutral" | "attention" | "danger" };

/** "Due in 28 d" · "Due today" · "12 d late" · "45 d late". */
export function agingPill(days: number): AgingPill {
  if (days < 0) return { label: `Due in ${-days} d`, tone: "neutral" };
  if (days === 0) return { label: "Due today", tone: "neutral" };
  return { label: `${days} d late`, tone: days > 30 ? "danger" : "attention" };
}

// ---------------------------------------------------------------------------
// Rule 11: project summary

export type InvoiceMoney = { status: InvoiceStatus; totalCents: number; amountPaidCents: number };

export function projectInvoiceSummary(invoices: readonly InvoiceMoney[]): {
  billedCents: number;
  receivedCents: number;
  outstandingCents: number;
} {
  let billedCents = 0;
  let receivedCents = 0;
  for (const i of invoices) {
    if (!COUNTED_STATUSES.has(i.status)) continue;
    billedCents += i.totalCents;
    receivedCents += i.amountPaidCents;
  }
  return { billedCents, receivedCents, outstandingCents: billedCents - receivedCents };
}
