import { z } from "zod";
import { isIsoDate } from "@/lib/calc/timesheet";

// Shared by the invoice builder's server actions and its page (invoicing
// spec, Actions table): input shapes, messages, and the send checks.

export const INVOICE_MESSAGES = {
  stale: "This draft changed. Reload to see the latest.",
  notFound: "That invoice isn't available.",
  notDraft: "Only a draft can be changed.",
  notEditable: "This invoice is waiting for review. Ask an owner or admin to return it to draft first.",
  projectNotBillable: "Only active or on-hold projects can be billed.",
  periodBeforeStart: (date: string) => `Period through can't be before ${date}.`,
  dueBeforeIssue: "The due date can't be before the issue date.",
  billToNotClient: "Pick a contact at the client.",
  memoTooLong: "Keep the memo to 2,000 characters or fewer.",
  percentRange: "Enter a % complete from 0 to 100.",
  notFixedPhase: "That phase isn't a fixed-fee phase on this project.",
  entryNotHere: "That time entry isn't on this invoice.",
  consultantNotBilled: "Pick a consultant whose fees are billed through.",
  costPositive: "Enter what they billed you (over $0).",
  vendorRef: "Enter their invoice number (up to 40 characters).",
  adjustmentDescription: "Enter a description (up to 200 characters).",
  adjustmentAmount: "Enter an amount other than $0.",
  lineNotRemovable: "Only consultant lines and adjustments can be removed.",
  returnNote: "Add a note of at least 3 characters for the person who prepared it.",
  notInReview: "This invoice isn't waiting for review.",
  submitted: "Submitted for review.",
  returned: "Returned to draft.",
  deleted: "Draft deleted. Its time is free to bill again.",
} as const;

const uuid = z.uuid();
const isoDate = z.string().refine(isIsoDate, "Enter a date.");
/** Every builder write names the version it saw, so a stale page can't overwrite. */
const base = { invoiceId: uuid, version: z.string().min(1) };

export const createDraftInput = z.object({ projectId: uuid });
export const versionInput = z.object(base);

export const settingsInput = z.object({
  ...base,
  periodEnd: isoDate.optional(),
  issueDate: isoDate.optional(),
  dueDate: isoDate.optional(),
  billToContactId: uuid.nullable().optional(),
  memo: z.string().max(2000, INVOICE_MESSAGES.memoTooLong).optional(),
});

export const percentInput = z.object({
  ...base,
  phaseId: uuid,
  percentCompleteBp: z.number().int(INVOICE_MESSAGES.percentRange).min(0, INVOICE_MESSAGES.percentRange).max(10000, INVOICE_MESSAGES.percentRange),
});

export const entryInput = z.object({ ...base, entryId: uuid, include: z.boolean() });

export const consultantLineInput = z.object({
  ...base,
  lineId: uuid.optional(),
  consultantId: uuid,
  vendorInvoiceRef: z.string().trim().min(1, INVOICE_MESSAGES.vendorRef).max(40, INVOICE_MESSAGES.vendorRef),
  costCents: z.number().int(INVOICE_MESSAGES.costPositive).positive(INVOICE_MESSAGES.costPositive).max(100_000_000_00),
});

export const adjustmentInput = z.object({
  ...base,
  lineId: uuid.optional(),
  description: z.string().trim().min(1, INVOICE_MESSAGES.adjustmentDescription).max(200, INVOICE_MESSAGES.adjustmentDescription),
  amountCents: z
    .number()
    .int(INVOICE_MESSAGES.adjustmentAmount)
    .refine((n) => n !== 0, INVOICE_MESSAGES.adjustmentAmount)
    .refine((n) => Math.abs(n) <= 100_000_000_00, INVOICE_MESSAGES.adjustmentAmount),
});

export const lineInput = z.object({ ...base, lineId: uuid });
export const returnInput = z.object({ ...base, note: z.string() });

/** "30.25" → 3025 basis points; null when it isn't a 0–100 number with up to 2 decimals. */
export function parsePercent(text: string): number | null {
  const m = /^\s*(\d{1,3})(?:\.(\d{1,2}))?\s*%?\s*$/.exec(text);
  if (!m) return null;
  const bp = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return bp <= 10000 ? bp : null;
}

/** "$1,234.50" / "-200" / "(200)" → cents; null when it isn't money. */
export function parseMoney(text: string): number | null {
  const t = text.trim().replace(/[$,\s]/g, "");
  const neg = /^\(.*\)$/.test(t) || t.startsWith("-") || t.startsWith("−");
  const m = /^[(−-]?(\d+)(?:\.(\d{1,2}))?\)?$/.exec(t);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return neg ? -cents : cents;
}

/**
 * Rule 14 send checks, also run at Submit for review. Empty = ready.
 * (Every line has a description: the database requires one.)
 */
export function sendProblems(f: {
  totalCents: number;
  lineCount: number;
  hasToAddress: boolean;
  negativeFixedLine: boolean;
  hasClient: boolean;
}): string[] {
  const out: string[] = [];
  if (f.lineCount === 0) out.push("Add at least one line.");
  else if (f.totalCents <= 0) out.push("The total must be more than $0.");
  if (!f.hasToAddress) out.push("The bill-to contact needs an email address.");
  if (f.negativeFixedLine) out.push("A fixed-fee line can't be negative.");
  if (!f.hasClient) out.push("The project needs a client.");
  return out;
}
