import { z } from "zod";
import { isIsoDate } from "@/lib/calc/timesheet";

// Recording and deleting payments (invoicing spec, Actions; rule 9): input
// shapes and messages shared by the server actions and the payment dialog.

export const PAYMENT_METHODS = [
  { value: "check", label: "Check" },
  { value: "ach", label: "ACH" },
  { value: "card", label: "Card" },
  { value: "other", label: "Other" },
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number]["value"];

export const methodLabel = (m: PaymentMethod) =>
  PAYMENT_METHODS.find((x) => x.value === m)?.label ?? m;

export const PAYMENT_MESSAGES = {
  notOpen:
    "Payments can only be recorded on a sent invoice that isn't fully paid.",
  date: "Enter the date the payment was received.",
  method: "Pick how it was paid.",
  reference: "Keep the reference to 100 characters or fewer.",
  notFound: "That payment isn't available.",
  recorded: "Payment recorded.",
  deleted: "Payment deleted.",
} as const;

export const recordPaymentInput = z.object({
  invoiceId: z.uuid(),
  receivedOn: z.string().refine(isIsoDate, PAYMENT_MESSAGES.date),
  amountCents: z.number().int(),
  method: z.enum(["check", "ach", "card", "other"], PAYMENT_MESSAGES.method),
  reference: z.string().trim().max(100, PAYMENT_MESSAGES.reference).optional(),
});
export type RecordPaymentInput = z.input<typeof recordPaymentInput>;

export const deletePaymentInput = z.object({ paymentId: z.uuid() });
