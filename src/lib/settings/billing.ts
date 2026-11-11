import { z } from "zod";
import { formatNumber, parseNumberFormat, usesProject } from "@/lib/calc/number-format";
import { nextProjectNumber } from "@/lib/calc/projects";

// Settings → Billing & invoices (invoicing spec rule 1, decisions #5 and
// #28): invoice and project number formats, the firm's next invoice
// number, payment terms and the PDF remittance text.

export type BillingSettings = {
  invoiceNumberFormat: string;
  /** Firm-wide counter; only used when the invoice format has no {PROJECT}. */
  nextInvoiceNumber: number;
  projectNumberFormat: string;
  paymentTermsDays: number;
  /** Printed in the invoice PDF footer. Empty = none. */
  remittanceText: string;
};

export type BillingField = keyof BillingSettings;

export const REMITTANCE_MAX = 500;
export const NEXT_INVOICE_MAX = 999_999;

const formatField = (kind: "invoice" | "project") =>
  z
    .string()
    .transform((s) => s.trim())
    .superRefine((s, ctx) => {
      const r = parseNumberFormat(s, kind);
      if (!r.ok) ctx.addIssue({ code: "custom", message: r.error });
    });

export const billingSchema = z.object({
  invoiceNumberFormat: formatField("invoice"),
  nextInvoiceNumber: z
    .number({ message: "Enter a whole number." })
    .int("Enter a whole number.")
    .min(1, "The next number must be 1 or more.")
    .max(NEXT_INVOICE_MAX, "That number is too big."),
  projectNumberFormat: formatField("project"),
  paymentTermsDays: z
    .number({ message: "Enter a number of days." })
    .int("Enter a whole number of days.")
    .min(0, "Terms can't be negative.")
    .max(365, "Terms can be up to 365 days."),
  remittanceText: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().max(REMITTANCE_MAX, `Keep this to ${REMITTANCE_MAX} characters or fewer.`)),
});

/** Field errors for a set of values, checked the same way the server does. */
export function billingErrors(values: BillingSettings): Partial<Record<BillingField, string>> {
  const r = billingSchema.safeParse(values);
  if (r.success) return {};
  const errors: Partial<Record<BillingField, string>> = {};
  for (const issue of r.error.issues) {
    const key = issue.path[0] as BillingField;
    errors[key] ??= issue.message;
  }
  return errors;
}

export type NumberExamples = {
  /** "2026-128", or "26031-01" for per-project formats. */
  invoice: string | null;
  /** Plain-language note under the example. */
  invoiceNote: string;
  /** The next project number New project will suggest. */
  project: string | null;
};

/**
 * The live examples under the format fields. `projectNumbers` are the
 * firm's project numbers (to work out the next one); `sampleProjectNumber`
 * is the newest, used to show a {PROJECT} invoice format.
 */
export function numberExamples(
  values: Pick<BillingSettings, "invoiceNumberFormat" | "nextInvoiceNumber" | "projectNumberFormat">,
  ctx: { year: number; sampleProjectNumber: string | null; projectNumbers: readonly string[] },
): NumberExamples {
  const projectOk = parseNumberFormat(values.projectNumberFormat, "project").ok;
  const project = projectOk ? nextProjectNumber(ctx.projectNumbers, values.projectNumberFormat, ctx.year) : null;
  const invoiceOk = parseNumberFormat(values.invoiceNumberFormat, "invoice").ok;
  if (!invoiceOk) return { invoice: null, invoiceNote: "", project };

  if (usesProject(values.invoiceNumberFormat)) {
    const sample =
      ctx.sampleProjectNumber ??
      (projectOk ? formatNumber(values.projectNumberFormat, "project", { year: ctx.year, n: 1 }) : "2026-001");
    const invoice = formatNumber(values.invoiceNumberFormat, "invoice", { year: ctx.year, projectNumber: sample, n: 1 });
    return { invoice, invoiceNote: `Each project counts its own invoices. The first one on ${sample} is ${invoice}.`, project };
  }
  const n = Number.isInteger(values.nextInvoiceNumber) && values.nextInvoiceNumber >= 1 ? values.nextInvoiceNumber : 1;
  const invoice = formatNumber(values.invoiceNumberFormat, "invoice", { year: ctx.year, n });
  return { invoice, invoiceNote: "One counter for the whole firm. It doesn't restart in January.", project };
}
