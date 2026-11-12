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
  consultantNotBilled: "That consultant's fees aren't billed through on this project.",
  adjustmentDescription: "Enter a description (up to 200 characters).",
  adjustmentAmount: "Enter an amount other than $0.",
  lineNotRemovable: "Only adjustments can be removed. Set % complete to change the other lines.",
  returnNote: "Add a note of at least 3 characters for the person who prepared it.",
  notInReview: "This invoice isn't waiting for review.",
  submitted: "Submitted for review.",
  returned: "Returned to draft.",
  deleted: "Draft deleted. Its time is free to bill again.",
  // Send, resend, void (1.8 C)
  sending: "Sending started but didn't finish. Retry to finish sending; the invoice keeps its number.",
  notSendable: "Only a draft or an invoice in review can be sent.",
  notSent: "Only a sent invoice can do that.",
  numberFailed: "Couldn't find a free invoice number; check the number format in Settings.",
  emailList: "Enter email addresses separated by commas.",
  toRequired: "Add at least one email address to send to.",
  subject: "Enter a subject (up to 200 characters).",
  message: "Keep the message to 5,000 characters or fewer.",
  voidReason: "Add a reason of at least 3 characters.",
  hasPayments: "Delete payments first.",
  noPdf: "This invoice has no saved PDF.",
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

export const consultantPercentInput = z.object({
  ...base,
  consultantId: uuid,
  percentCompleteBp: z.number().int(INVOICE_MESSAGES.percentRange).min(0, INVOICE_MESSAGES.percentRange).max(10000, INVOICE_MESSAGES.percentRange),
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

/** "a@x.com, b@y.com; c@z.com" → a clean list (lowercase, no repeats); null if any isn't an email. */
export function parseEmailList(text: string): string[] | null {
  const parts = text
    .split(/[,;\s]+/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  if (parts.some((p) => p.length > 254 || !z.email().safeParse(p).success)) return null;
  return [...new Set(parts)];
}

const emailList = z
  .string()
  .max(2000, INVOICE_MESSAGES.emailList)
  .transform((v, ctx) => {
    const list = parseEmailList(v);
    if (!list) {
      ctx.addIssue({ code: "custom", message: INVOICE_MESSAGES.emailList });
      return z.NEVER;
    }
    return list;
  });

const emailFields = {
  to: emailList,
  cc: emailList,
  subject: z.string().trim().min(1, INVOICE_MESSAGES.subject).max(200, INVOICE_MESSAGES.subject),
  message: z.string().max(5000, INVOICE_MESSAGES.message),
};

/** Send… (rule 15). "mark" = mark sent without emailing. */
export const sendInput = z.discriminatedUnion("mode", [
  z.object({ ...base, mode: z.literal("email"), issueDate: isoDate, expectedNumber: z.string().max(60), ...emailFields }),
  z.object({ ...base, mode: z.literal("mark"), issueDate: isoDate }),
]);
export type SendInput = z.input<typeof sendInput>;

export const resendInput = z.object({ invoiceId: uuid, ...emailFields });
export const voidInput = z.object({ invoiceId: uuid, reason: z.string() });

/** The Send dialog's starting message (rule 15c). Plain text. */
export function defaultSendMessage(v: {
  number: string;
  projectName: string;
  periodEnd: string;
  total: string;
  dueDate: string;
  sender: string;
  firmName: string;
}): string {
  return [
    "Hello,",
    "",
    `Attached is invoice ${v.number} for ${v.projectName}, for services through ${v.periodEnd}. The amount due is ${v.total}, due ${v.dueDate}.`,
    "",
    "Thank you,",
    v.sender,
    v.firmName,
  ].join("\n");
}
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

export const NO_EMAIL = "There's no email to send this to. Add a billing email for the client in Contacts, or pick a bill-to contact with an email.";

/**
 * Where an invoice is emailed (decision #32): the client's billing email if
 * it has one, copying the bill-to contact; otherwise the bill-to contact.
 */
export function invoiceRecipients(billingEmail: string | null, contactEmail: string | null): { to: string | null; cc: string | null } {
  const shared = billingEmail?.trim() || null;
  const person = contactEmail?.trim() || null;
  if (shared) return { to: shared, cc: person && person.toLowerCase() !== shared.toLowerCase() ? person : null };
  return { to: person, cc: null };
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
  if (!f.hasToAddress) out.push(NO_EMAIL);
  if (f.negativeFixedLine) out.push("A fixed-fee line can't be negative.");
  if (!f.hasClient) out.push("The project needs a client.");
  return out;
}
