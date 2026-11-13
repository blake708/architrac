import {
  AGING_BUCKETS,
  type AgingBucket,
  type InvoiceStatus,
  OPEN_STATUSES,
  agingBucket,
  daysPastDue,
  formatPercentBp,
} from "./invoice";

// The Invoices page and a project's Invoices tab (invoicing spec Layout A
// and B, "Data shown", rules 9–11). Pure functions; the pages call these.

/** What the list needs from an invoice. */
export type ListInvoice = {
  status: InvoiceStatus;
  dueDate: string;
  totalCents: number;
  amountPaidCents: number;
};

/** What's still owed. Nothing on a void invoice. */
export function balanceCents(
  i: Pick<ListInvoice, "status" | "totalCents" | "amountPaidCents">,
): number {
  if (i.status === "void" || i.status === "written_off") return 0;
  return Math.max(0, i.totalCents - i.amountPaidCents);
}

export const isOpen = (s: InvoiceStatus) => OPEN_STATUSES.has(s);

// ---------------------------------------------------------------------------
// Status tabs (Layout A.3)

export type InvoiceTab = "open" | "drafts" | "paid" | "void" | "all";

export const INVOICE_TABS: readonly { key: InvoiceTab; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "drafts", label: "Drafts & review" },
  { key: "paid", label: "Paid" },
  { key: "void", label: "Void" },
  { key: "all", label: "All" },
];

/** The tab an invoice sits under (besides All). */
export function tabOf(
  status: InvoiceStatus,
): Exclude<InvoiceTab, "all"> | null {
  if (status === "sent" || status === "partially_paid") return "open";
  if (status === "draft" || status === "in_review") return "drafts";
  if (status === "paid") return "paid";
  if (status === "void") return "void";
  return null;
}

export function inTab(status: InvoiceStatus, tab: InvoiceTab): boolean {
  return tab === "all" || tabOf(status) === tab;
}

export function tabCounts(
  rows: readonly Pick<ListInvoice, "status">[],
): Record<InvoiceTab, number> {
  const out: Record<InvoiceTab, number> = {
    open: 0,
    drafts: 0,
    paid: 0,
    void: 0,
    all: rows.length,
  };
  for (const r of rows) {
    const t = tabOf(r.status);
    if (t) out[t] += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// KPIs (Data shown)

export type ReceivablesKpis = {
  /** Σ balance of open invoices. */
  receivablesCents: number;
  openCount: number;
  /** Σ balance of open invoices more than 60 days past due. */
  over60Cents: number;
  over60Count: number;
  /** Drafts and invoices in review: count and Σ total. */
  draftsCount: number;
  draftsCents: number;
  /** Σ payments received this calendar month (firm time zone). */
  collectedCents: number;
  collectedCount: number;
};

/** The first day of today's month: "2026-10-18" → "2026-10-01". */
export const monthStart = (today: string) => `${today.slice(0, 8)}01`;

export function receivablesKpis(
  rows: readonly ListInvoice[],
  payments: readonly { amountCents: number; receivedOn: string }[],
  today: string,
): ReceivablesKpis {
  const k: ReceivablesKpis = {
    receivablesCents: 0,
    openCount: 0,
    over60Cents: 0,
    over60Count: 0,
    draftsCount: 0,
    draftsCents: 0,
    collectedCents: 0,
    collectedCount: 0,
  };
  for (const r of rows) {
    if (isOpen(r.status)) {
      const owed = balanceCents(r);
      k.receivablesCents += owed;
      k.openCount += 1;
      if (daysPastDue(today, r.dueDate) > 60) {
        k.over60Cents += owed;
        k.over60Count += 1;
      }
    } else if (r.status === "draft" || r.status === "in_review") {
      k.draftsCount += 1;
      k.draftsCents += r.totalCents;
    }
  }
  const from = monthStart(today);
  for (const p of payments) {
    if (p.receivedOn < from || p.receivedOn > today) continue;
    k.collectedCents += p.amountCents;
    k.collectedCount += 1;
  }
  return k;
}

// ---------------------------------------------------------------------------
// Aging bar (Layout A.4, rule 10)

export type AgingTotal = {
  key: AgingBucket;
  label: string;
  cents: number;
  count: number;
};

/** "Current" · "1–30 days" … "90+ days". */
export const agingLabel = (key: AgingBucket) => {
  const b = AGING_BUCKETS.find((x) => x.key === key)!;
  return key === "current" ? b.label : `${b.label} days`;
};

/** Open invoices' balances in each bucket, oldest last. */
export function agingTotals(
  rows: readonly ListInvoice[],
  today: string,
): AgingTotal[] {
  const out = AGING_BUCKETS.map((b) => ({
    key: b.key,
    label: agingLabel(b.key),
    cents: 0,
    count: 0,
  }));
  for (const r of rows) {
    if (!isOpen(r.status)) continue;
    const t = out.find(
      (x) => x.key === agingBucket(daysPastDue(today, r.dueDate)),
    )!;
    t.cents += balanceCents(r);
    t.count += 1;
  }
  return out;
}

/** "Over 60 days" is the 61–90 and 90+ buckets. */
export const OVER_60: readonly AgingBucket[] = ["61_90", "90_plus"];

// ---------------------------------------------------------------------------
// Project Invoices tab (Layout B)

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "2026-11-15" → "Nov 15". */
export function monthDay(iso: string): string {
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  return `${MONTHS[m - 1]} ${d}`;
}

/** The status wording on a project's Invoices tab (mockup: "Paid Oct 12", "Sent · due Nov 15"). */
export function projectStatusText(
  status: InvoiceStatus,
  dueDate: string,
  lastPaidOn: string | null,
): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "in_review":
      return "In review";
    case "sent":
      return `Sent · due ${monthDay(dueDate)}`;
    case "partially_paid":
      return `Partially paid · due ${monthDay(dueDate)}`;
    case "paid":
      return lastPaidOn ? `Paid ${monthDay(lastPaidOn)}` : "Paid";
    case "void":
      return "Void";
    case "written_off":
      return "Written off";
  }
}

/** What one invoice line tells the "For" column. */
export type ForLine = {
  lineType: "phase_fee" | "hourly" | "consultant" | "expense" | "adjustment";
  /** Phase name (phase fee, hourly) or consultant label (consultant). */
  name: string | null;
  percentCompleteBp: number | null;
  /** Hours × 100 on hourly lines. */
  hoursHundredths: number | null;
  description: string;
};

const hoursText = (hundredths: number) => {
  const h = hundredths / 100;
  return `${Number.isInteger(h) ? h : h.toFixed(2).replace(/0$/, "")} h`;
};

/**
 * The "For" column: what the invoice billed, from its lines, in line order.
 * "Schematic Design · 100%", "Permitting · 11 h", "MEP · 50%"; more than two
 * become "A, B + 2 more". Adjustments only when there's nothing else.
 */
export function invoiceFor(lines: readonly ForLine[]): string {
  const parts: string[] = [];
  const hours = new Map<string, number>();
  for (const l of lines) {
    if (l.lineType === "phase_fee" || l.lineType === "consultant") {
      if (l.name && l.percentCompleteBp !== null)
        parts.push(`${l.name} · ${formatPercentBp(l.percentCompleteBp)}`);
      else parts.push(l.description);
    } else if (l.lineType === "hourly" && l.name) {
      if (!hours.has(l.name)) parts.push(l.name); // placeholder, filled below
      hours.set(l.name, (hours.get(l.name) ?? 0) + (l.hoursHundredths ?? 0));
    }
  }
  const items = parts.map((p) =>
    hours.has(p) ? `${p} · ${hoursText(hours.get(p)!)}` : p,
  );
  if (items.length === 0) {
    const adj = lines.find((l) => l.lineType === "adjustment");
    return adj ? adj.description : "—";
  }
  if (items.length <= 2) return items.join(", ");
  return `${items.slice(0, 2).join(", ")} + ${items.length - 2} more`;
}
