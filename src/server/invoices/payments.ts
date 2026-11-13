import { and, eq, isNull, sum } from "drizzle-orm";
import { invoices, payments } from "@/db/schema";
import type { TenantDb } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import { paymentProblem, statusFromPaid } from "@/lib/calc/invoice";
import { todayIn } from "@/lib/format";
import { INVOICE_MESSAGES } from "@/lib/invoices/builder";
import {
  PAYMENT_MESSAGES,
  deletePaymentInput,
  recordPaymentInput,
} from "@/lib/invoices/payments";
import type { ActionResult } from "@/server/settings/common";
import {
  Forbidden,
  type InvoiceActor,
  InvoiceError,
  logInvoice,
  projectAccess,
  runInvoice,
} from "./draft";
import { queueQuickbooksPayment } from "./quickbooks";

// Record and delete payments (invoicing spec rule 9; owner and admin only,
// decision #26). The invoice row is locked, and its amount paid and status
// are recomputed from the payments in the same transaction as the change.

type PaymentResult = ActionResult<
  string,
  { invoiceId: string; projectId: string; status: string }
>;

/** Lock the invoice and check this person may handle its payments. */
async function lockInvoice(
  db: TenantDb,
  actor: InvoiceActor,
  invoiceId: string,
) {
  if (!can(actor.member, "payments.record")) throw new Forbidden();
  const [inv] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), isNull(invoices.archivedAt)))
    .for("update");
  if (!inv) throw new InvoiceError(INVOICE_MESSAGES.notFound);
  if (!(await projectAccess(db, actor, inv.projectId))) throw new Forbidden();
  return inv;
}

/** Σ live payments → amount paid and status, saved on the invoice. */
async function settle(db: TenantDb, inv: { id: string; totalCents: number }) {
  const [row] = await db
    .select({ paid: sum(payments.amountCents).mapWith(Number) })
    .from(payments)
    .where(and(eq(payments.invoiceId, inv.id), isNull(payments.archivedAt)));
  const paid = row?.paid ?? 0;
  const status = statusFromPaid(inv.totalCents, paid);
  await db
    .update(invoices)
    .set({ amountPaidCents: paid, status })
    .where(eq(invoices.id, inv.id));
  return { paid, status };
}

export async function recordPaymentCore(
  actor: InvoiceActor,
  raw: unknown,
): Promise<PaymentResult> {
  const parsed = recordPaymentInput.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = String(issue?.path[0] ?? "");
    const message = issue?.message ?? INVOICE_MESSAGES.notFound;
    return field && field !== "invoiceId"
      ? { ok: false, error: message, fieldErrors: { [field]: message } }
      : { ok: false, error: INVOICE_MESSAGES.notFound };
  }
  const v = parsed.data;
  return runInvoice(actor, "recordPayment", async (db) => {
    const inv = await lockInvoice(db, actor, v.invoiceId);
    if (inv.status !== "sent" && inv.status !== "partially_paid")
      throw new InvoiceError(PAYMENT_MESSAGES.notOpen);
    const problem = paymentProblem(
      v.amountCents,
      inv.totalCents - inv.amountPaidCents,
      v.receivedOn,
      todayIn(actor.timezone),
    );
    if (problem)
      throw new InvoiceError(
        problem,
        problem.includes("date") ? "receivedOn" : "amountCents",
      );
    const [p] = await db
      .insert(payments)
      .values({
        firmId: actor.firmId,
        invoiceId: inv.id,
        receivedOn: v.receivedOn,
        amountCents: v.amountCents,
        method: v.method,
        reference: v.reference || null,
        createdBy: actor.userId,
      })
      .returning({ id: payments.id });
    const after = await settle(db, inv);
    await logInvoice(db, actor, inv.id, "payment_recorded", {
      paymentId: p!.id,
      amountCents: v.amountCents,
      receivedOn: v.receivedOn,
      method: v.method,
      reference: v.reference || null,
      ...(after.status !== inv.status
        ? { status: { before: inv.status, after: after.status } }
        : {}),
    });
    await queueQuickbooksPayment(db, p!.id, "create");
    return {
      invoiceId: inv.id,
      projectId: inv.projectId,
      status: after.status,
    };
  });
}

/** Delete = archive (no hard deletes); the invoice's paid amount and status recompute. */
export async function deletePaymentCore(
  actor: InvoiceActor,
  raw: unknown,
): Promise<PaymentResult> {
  const parsed = deletePaymentInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: PAYMENT_MESSAGES.notFound };
  return runInvoice(actor, "deletePayment", async (db) => {
    if (!can(actor.member, "payments.record")) throw new Forbidden();
    const [pay] = await db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.id, parsed.data.paymentId),
          isNull(payments.archivedAt),
        ),
      );
    if (!pay) throw new InvoiceError(PAYMENT_MESSAGES.notFound);
    const inv = await lockInvoice(db, actor, pay.invoiceId);
    const archived = await db
      .update(payments)
      .set({ archivedAt: new Date() })
      .where(and(eq(payments.id, pay.id), isNull(payments.archivedAt)))
      .returning({ id: payments.id });
    if (archived.length === 0)
      throw new InvoiceError(PAYMENT_MESSAGES.notFound);
    const after = await settle(db, inv);
    await logInvoice(db, actor, inv.id, "payment_deleted", {
      paymentId: pay.id,
      amountCents: pay.amountCents,
      receivedOn: pay.receivedOn,
      ...(after.status !== inv.status
        ? { status: { before: inv.status, after: after.status } }
        : {}),
    });
    await queueQuickbooksPayment(db, pay.id, "delete");
    return {
      invoiceId: inv.id,
      projectId: inv.projectId,
      status: after.status,
    };
  });
}
