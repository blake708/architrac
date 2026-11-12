import { and, count, eq, isNull } from "drizzle-orm";
import { firms, invoices, payments, timeEntries, users } from "@/db/schema";
import { type TenantDb, withFirm } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import { invoiceDueDate } from "@/lib/calc/invoice";
import { EmailNotConfigured, mailer } from "@/lib/integrations/email";
import { StorageNotConfigured, storage } from "@/lib/integrations/storage";
import { INVOICE_MESSAGES, NO_EMAIL, resendInput, sendInput, voidInput } from "@/lib/invoices/builder";
import { firmDisplayName } from "@/lib/settings/firm-profile";
import type { ActionResult } from "@/server/settings/common";
import {
  type Access,
  Forbidden,
  type InvoiceActor,
  InvoiceError,
  type InvoiceRow,
  logInvoice,
  projectAccess,
  recalculate,
  runInvoice,
  versionOf,
} from "./draft";
import { assignNumber } from "./number";
import { loadPdfData } from "./pdf-data";
import { pdfFileName, renderInvoicePdf } from "./pdf";
import { queueQuickbooksInvoice } from "./quickbooks";
import { buildView } from "./view";

// Send, resend and void (invoicing spec rules 15 and 16, decision #26).
//
// Sending runs in steps, each saved as it finishes:
//   1. number the invoice (one transaction, counters locked)
//   2. build the PDF and save it to file storage
//   3. email it (unless "mark sent without emailing")
//   4. mark it sent
// If step 2 or 3 fails, the invoice stays unsent with its number, and
// Retry (the same action again) skips whatever already finished. The email
// is recorded before step 4, so a retry never sends it twice.

type SendResult = ActionResult<string, { id: string; number: string }> & { retry?: boolean };

const bad = (error: string, field?: string): ActionResult<string, never> =>
  field ? { ok: false, error, fieldErrors: { [field]: error } } : { ok: false, error };

const SENT_STATUSES = new Set(["sent", "partially_paid", "paid"]);

/** Who's sending: their name and email (Reply-To). */
async function sender(db: TenantDb, actor: InvoiceActor) {
  const [me] = await db
    .select({ first: users.firstName, last: users.lastName, email: users.email })
    .from(users)
    .where(eq(users.id, actor.userId));
  return { name: `${me?.first ?? ""} ${me?.last ?? ""}`.trim(), email: me?.email ?? null };
}

async function firmName(db: TenantDb, firmId: string) {
  const [f] = await db.select({ name: firms.name, displayName: firms.displayName }).from(firms).where(eq(firms.id, firmId));
  return f ? firmDisplayName(f) : "";
}

/** Lock an invoice and check this person may send / resend it (owner, admin, or the project's PIC: #26). */
async function lockForSend(db: TenantDb, actor: InvoiceActor, invoiceId: string): Promise<{ inv: InvoiceRow; access: Access }> {
  const [inv] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), isNull(invoices.archivedAt)))
    .for("update");
  if (!inv) throw new InvoiceError(INVOICE_MESSAGES.notFound);
  const access = await projectAccess(db, actor, inv.projectId);
  if (!access?.canReview) throw new Forbidden();
  return { inv, access };
}

const describe = (err: unknown) => (err instanceof Error && err.message ? err.message : String(err));

/** Send… (rule 15). Safe to call again after a failure: that's Retry. */
export async function sendInvoiceCore(actor: InvoiceActor, raw: unknown): Promise<SendResult> {
  const parsed = sendInput.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const field = typeof first?.path[0] === "string" ? first.path[0] : undefined;
    return bad(first?.message ?? INVOICE_MESSAGES.notFound, field === "invoiceId" || field === "version" ? undefined : field);
  }
  const v = parsed.data;
  if (v.mode === "email" && v.to.length === 0) return bad(INVOICE_MESSAGES.toRequired, "to");

  // Step 1: number it.
  const step1 = await runInvoice(actor, "sendInvoice", async (db) => {
    const { inv, access } = await lockForSend(db, actor, v.invoiceId);
    if (SENT_STATUSES.has(inv.status)) return { inv, done: true };
    if (inv.status !== "draft" && inv.status !== "in_review") throw new InvoiceError(INVOICE_MESSAGES.notSendable);
    if (inv.number) return { inv, done: false }; // a retry: already numbered and frozen

    if (versionOf(inv) !== v.version) throw new InvoiceError(INVOICE_MESSAGES.stale);
    // The Send dialog's issue date; the due date keeps its gap (rule 8).
    if (v.issueDate !== inv.issueDate) {
      const gap = Math.round((Date.parse(inv.dueDate) - Date.parse(inv.issueDate)) / 86_400_000);
      await db.update(invoices).set({ issueDate: v.issueDate, dueDate: invoiceDueDate(v.issueDate, gap) }).where(eq(invoices.id, inv.id));
    }
    // Send exactly what the page showed: anything new (time approved since) means reload first.
    const [current] = await db.select().from(invoices).where(eq(invoices.id, inv.id));
    if ((await recalculate(db, current)).changed) throw new InvoiceError(INVOICE_MESSAGES.stale);
    const view = await buildView(db, current, access);
    // Marking sent without emailing doesn't need an address.
    const problems = view.problems.filter((p) => v.mode === "email" || p !== NO_EMAIL);
    if (problems.length) throw new InvoiceError(problems.join(" "));

    const number = await assignNumber(db, current);
    await db
      .update(invoices)
      .set({ reviewedBy: current.reviewedBy ?? actor.userId, reviewedAt: current.reviewedAt ?? new Date() })
      .where(eq(invoices.id, inv.id));
    await logInvoice(db, actor, inv.id, "numbered", { number });
    const [after] = await db.select().from(invoices).where(eq(invoices.id, inv.id));
    return { inv: after, done: false };
  });
  if (!step1.ok) return step1;
  let inv = step1.data.inv;
  const number = inv.number!;
  if (step1.data.done) return { ok: true, data: { id: inv.id, number } };

  // Step 2: the PDF, saved once. Later downloads and resends use this file.
  let pdf: Uint8Array | null = null;
  const key = `firms/${inv.firmId}/invoices/${inv.id}/${pdfFileName(number)}`;
  try {
    if (!inv.pdfUrl) {
      const data = await withFirm(actor.firmId, (db) => loadPdfData(db, inv, null));
      pdf = await renderInvoicePdf(data);
      await storage().put(key, pdf, "application/pdf");
      inv = await withFirm(actor.firmId, async (db) => {
        const [row] = await db.update(invoices).set({ pdfUrl: key }).where(eq(invoices.id, inv.id)).returning();
        return row;
      });
    }
  } catch (err) {
    if (!(err instanceof StorageNotConfigured)) console.error("sendInvoice: PDF failed", err);
    return { ok: false, retry: true, error: err instanceof StorageNotConfigured ? err.message : `The PDF couldn't be saved. ${describe(err)}` };
  }

  // Step 3: the email.
  if (v.mode === "email" && !inv.emailedAt) {
    try {
      const { firm, me } = await withFirm(actor.firmId, async (db) => ({ firm: await firmName(db, actor.firmId), me: await sender(db, actor) }));
      pdf ??= await storage().get(inv.pdfUrl!);
      // The dialog showed the number we expected; if someone else took it, use the real one.
      const fix = (t: string) => (v.expectedNumber && v.expectedNumber !== number ? t.split(v.expectedNumber).join(number) : t);
      await mailer().send({
        fromName: firm,
        to: v.to,
        cc: v.cc.filter((c) => !v.to.includes(c)),
        replyTo: me.email,
        subject: fix(v.subject),
        text: fix(v.message),
        attachments: [{ name: pdfFileName(number), content: pdf, contentType: "application/pdf" }],
      });
      inv = await withFirm(actor.firmId, async (db) => {
        const [row] = await db
          .update(invoices)
          .set({ emailedAt: new Date(), sentTo: [...v.to, ...v.cc.filter((c) => !v.to.includes(c))] })
          .where(eq(invoices.id, inv.id))
          .returning();
        return row;
      });
    } catch (err) {
      if (!(err instanceof EmailNotConfigured)) console.error("sendInvoice: email failed", err);
      return { ok: false, retry: true, error: err instanceof EmailNotConfigured ? err.message : `The email didn't go out. ${describe(err)}` };
    }
  }

  // Step 4: mark it sent.
  const step4 = await runInvoice(actor, "sendInvoice", async (db) => {
    const { inv: row } = await lockForSend(db, actor, v.invoiceId);
    if (SENT_STATUSES.has(row.status)) return;
    await db.update(invoices).set({ status: "sent", sentAt: new Date() }).where(eq(invoices.id, row.id));
    await logInvoice(db, actor, row.id, "status_changed", {
      status: { before: row.status, after: "sent" },
      number,
      emailed: v.mode === "email" ? { to: v.to, cc: v.cc } : false,
    });
    await queueQuickbooksInvoice(db, row.id, "create");
  });
  if (!step4.ok) return { ...step4, retry: true };
  return { ok: true, data: { id: inv.id, number } };
}

/** Email the saved PDF again; the status doesn't change. */
export async function resendInvoiceCore(actor: InvoiceActor, raw: unknown): Promise<ActionResult<string, { id: string }>> {
  const parsed = resendInput.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const field = typeof first?.path[0] === "string" ? first.path[0] : undefined;
    return bad(first?.message ?? INVOICE_MESSAGES.notFound, field === "invoiceId" ? undefined : field);
  }
  const v = parsed.data;
  if (v.to.length === 0) return bad(INVOICE_MESSAGES.toRequired, "to");
  const found = await runInvoice(actor, "resendInvoice", async (db) => {
    const { inv } = await lockForSend(db, actor, v.invoiceId);
    if (!SENT_STATUSES.has(inv.status)) throw new InvoiceError(INVOICE_MESSAGES.notSent);
    if (!inv.pdfUrl || !inv.number) throw new InvoiceError(INVOICE_MESSAGES.noPdf);
    return { inv, firm: await firmName(db, actor.firmId), me: await sender(db, actor) };
  });
  if (!found.ok) return found;
  const { inv, firm, me } = found.data;
  const cc = v.cc.filter((c) => !v.to.includes(c));
  try {
    const pdf = await storage().get(inv.pdfUrl!);
    await mailer().send({
      fromName: firm,
      to: v.to,
      cc,
      replyTo: me.email,
      subject: v.subject,
      text: v.message,
      attachments: [{ name: pdfFileName(inv.number), content: pdf, contentType: "application/pdf" }],
    });
  } catch (err) {
    if (!(err instanceof EmailNotConfigured) && !(err instanceof StorageNotConfigured)) console.error("resendInvoice failed", err);
    return bad(
      err instanceof EmailNotConfigured || err instanceof StorageNotConfigured ? err.message : `The email didn't go out. ${describe(err)}`,
    );
  }
  return runInvoice(actor, "resendInvoice", async (db) => {
    await logInvoice(db, actor, inv.id, "resent", { to: v.to, cc });
    return { id: inv.id };
  });
}

/**
 * Void (rule 16): owner/admin, a sent invoice with no payments. Its time
 * and % are free to bill again; the number is never reused; the saved PDF
 * stays as it was.
 */
export async function voidInvoiceCore(actor: InvoiceActor, raw: unknown): Promise<ActionResult<string, { id: string; projectId: string }>> {
  const parsed = voidInput.safeParse(raw);
  if (!parsed.success) return bad(INVOICE_MESSAGES.notFound);
  const reason = parsed.data.reason.trim();
  if (reason.length < 3) return bad(INVOICE_MESSAGES.voidReason, "reason");
  if (reason.length > 500) return bad("Keep the reason to 500 characters or fewer.", "reason");
  return runInvoice(actor, "voidInvoice", async (db) => {
    const [inv] = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, parsed.data.invoiceId), isNull(invoices.archivedAt)))
      .for("update");
    if (!inv) throw new InvoiceError(INVOICE_MESSAGES.notFound);
    const access = await projectAccess(db, actor, inv.projectId);
    if (!access || !can(actor.member, "invoices.void")) throw new Forbidden();
    const [paid] = await db
      .select({ n: count() })
      .from(payments)
      .where(and(eq(payments.invoiceId, inv.id), isNull(payments.archivedAt)));
    if ((paid?.n ?? 0) > 0) throw new InvoiceError(INVOICE_MESSAGES.hasPayments);
    if (inv.status !== "sent") throw new InvoiceError(INVOICE_MESSAGES.notSent);
    const now = new Date();
    await db
      .update(invoices)
      .set({ status: "void", voidedAt: now, voidedBy: actor.userId, voidReason: reason })
      .where(eq(invoices.id, inv.id));
    const freed = await db
      .update(timeEntries)
      .set({ invoiceId: null })
      .where(eq(timeEntries.invoiceId, inv.id))
      .returning({ id: timeEntries.id });
    await logInvoice(db, actor, inv.id, "status_changed", {
      status: { before: "sent", after: "void" },
      reason,
      timeEntriesReleased: freed.length,
    });
    await queueQuickbooksInvoice(db, inv.id, "void");
    return { id: inv.id, projectId: inv.projectId };
  });
}
