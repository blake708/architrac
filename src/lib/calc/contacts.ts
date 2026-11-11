// Client money and consultant fees for Contacts (contacts spec, rules 4–6
// and 13). Pure functions over cents. Invoices arrive in 1.8 and
// consultants in 1.5; until then callers pass empty lists.

import type { InvoiceStatus } from "./invoice";

export type { InvoiceStatus };

export type InvoiceMoney = {
  status: InvoiceStatus;
  totalCents: number;
  amountPaidCents: number;
};

const BILLED: ReadonlySet<InvoiceStatus> = new Set([
  "sent",
  "partially_paid",
  "paid",
  "written_off",
]);
const OPEN: ReadonlySet<InvoiceStatus> = new Set(["sent", "partially_paid"]);

/** Σ totals of invoices that went out (drafts and voids don't count). */
export function companyBilled(invoices: readonly InvoiceMoney[]): number {
  return invoices
    .filter((i) => BILLED.has(i.status))
    .reduce((n, i) => n + i.totalCents, 0);
}

/** Σ unpaid amounts on sent and partially paid invoices. */
export function companyOpen(invoices: readonly InvoiceMoney[]): number {
  return invoices
    .filter((i) => OPEN.has(i.status))
    .reduce((n, i) => n + (i.totalCents - i.amountPaidCents), 0);
}

/** Σ consultant fees on projects that aren't archived. */
export function consultantFees(
  rows: readonly { feeCents: number; projectArchived: boolean }[],
): number {
  return rows
    .filter((r) => !r.projectArchived)
    .reduce((n, r) => n + r.feeCents, 0);
}

/**
 * Rule 6: a client is missing a billing contact when invoices can't be
 * emailed: no billing email (decision #32) and no live billing contact
 * with an email.
 */
export function missingBillingContact(
  kind: string,
  billing: { archived: boolean; email: string | null } | null,
  billingEmail: string | null = null,
): boolean {
  if (kind !== "client") return false;
  if (billingEmail?.trim()) return false;
  return !billing || billing.archived || !billing.email?.trim();
}
