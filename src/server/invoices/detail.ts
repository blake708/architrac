import { and, eq, isNull } from "drizzle-orm";
import { companies, contacts, firms, invoices, users } from "@/db/schema";
import type { TenantDb } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import { type InvoiceStatus, invoiceDueDate } from "@/lib/calc/invoice";
import type { InvoiceSections } from "@/lib/calc/invoice-sections";
import { formatDate, formatMoney, todayIn } from "@/lib/format";
import { defaultSendMessage, invoiceRecipients } from "@/lib/invoices/builder";
import { firmDisplayName } from "@/lib/settings/firm-profile";
import { type InvoiceActor, type InvoiceRow, projectAccess } from "./draft";
import { peekNumber } from "./number";
import { loadSections } from "./sections";

// The invoice page after it's sent (invoicing spec Layout D, first
// version: payments, aging and the activity timeline come in 1.8 D), and
// the Send / Resend dialogs' starting values.

export type EmailDefaults = { to: string; cc: string; subject: string; message: string };

export type InvoiceDetail = {
  id: string;
  number: string | null;
  status: InvoiceStatus;
  project: { id: string; number: string; name: string };
  client: string;
  issueDate: string;
  dueDate: string;
  periodEnd: string;
  sentAt: string | null;
  sentTo: string[];
  emailed: boolean;
  /** The tables and adjustments, laid out like the PDF (rule 17). */
  sections: InvoiceSections;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  paidCents: number;
  void: { at: string; reason: string } | null;
  can: { download: boolean; resend: boolean; void: boolean };
  resend: EmailDefaults;
};

const plain = (cents: number) => formatMoney(cents, { cents: true });

async function people(db: TenantDb, inv: InvoiceRow, actor: InvoiceActor) {
  const [[client], [billTo], [firm], [me]] = await Promise.all([
    db.select({ name: companies.name, billingEmail: companies.billingEmail }).from(companies).where(eq(companies.id, inv.clientCompanyId)),
    inv.billToContactId
      ? db.select({ email: contacts.email }).from(contacts).where(eq(contacts.id, inv.billToContactId))
      : Promise.resolve([]),
    db.select({ name: firms.name, displayName: firms.displayName }).from(firms).where(eq(firms.id, inv.firmId)),
    db.select({ first: users.firstName, last: users.lastName }).from(users).where(eq(users.id, actor.userId)),
  ]);
  return {
    client: client?.name ?? "—",
    recipients: invoiceRecipients(client?.billingEmail ?? null, billTo?.email ?? null),
    firm: firm ? firmDisplayName(firm) : "",
    me: `${me?.first ?? ""} ${me?.last ?? ""}`.trim(),
  };
}

function emailDefaults(
  inv: Pick<InvoiceRow, "periodEnd" | "totalCents">,
  number: string,
  dueDate: string,
  project: { name: string },
  p: Awaited<ReturnType<typeof people>>,
): EmailDefaults {
  return {
    to: p.recipients.to ?? "",
    cc: p.recipients.cc ?? "",
    subject: `Invoice ${number} · ${project.name}`,
    message: defaultSendMessage({
      number,
      projectName: project.name,
      periodEnd: formatDate(inv.periodEnd),
      total: plain(inv.totalCents),
      dueDate: formatDate(dueDate),
      sender: p.me,
      firmName: p.firm,
    }),
  };
}

export type SendDefaults = EmailDefaults & { expectedNumber: string; issueDate: string };

/** The Send dialog: today's date (firm time zone), the number it should get, and the email. */
export async function loadSendDefaults(db: TenantDb, actor: InvoiceActor, invoiceId: string): Promise<SendDefaults | null> {
  const [inv] = await db.select().from(invoices).where(and(eq(invoices.id, invoiceId), isNull(invoices.archivedAt)));
  if (!inv) return null;
  const access = await projectAccess(db, actor, inv.projectId);
  if (!access?.canReview) return null;
  // A retry keeps the date it was numbered with.
  const issueDate = inv.number ? inv.issueDate : todayIn(actor.timezone);
  const gap = Math.round((Date.parse(inv.dueDate) - Date.parse(inv.issueDate)) / 86_400_000);
  const number = await peekNumber(db, inv, issueDate);
  const p = await people(db, inv, actor);
  return { ...emailDefaults(inv, number, invoiceDueDate(issueDate, gap), access.project, p), expectedNumber: number, issueDate };
}

/** A sent (or void) invoice's page, or null when it isn't there or isn't theirs. */
export async function loadInvoiceDetail(db: TenantDb, actor: InvoiceActor, invoiceId: string): Promise<InvoiceDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) return null;
  const [inv] = await db.select().from(invoices).where(and(eq(invoices.id, invoiceId), isNull(invoices.archivedAt)));
  if (!inv) return null;
  const access = await projectAccess(db, actor, inv.projectId);
  if (!access || (!access.canDraft && !access.canReview)) return null;
  const [sections, p] = await Promise.all([loadSections(db, inv), people(db, inv, actor)]);
  const project = { id: access.project.id, number: access.project.number, name: access.project.name };
  const sent = inv.status === "sent" || inv.status === "partially_paid" || inv.status === "paid";
  return {
    id: inv.id,
    number: inv.number,
    status: inv.status,
    project,
    client: p.client,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    periodEnd: inv.periodEnd,
    sentAt: inv.sentAt?.toISOString() ?? null,
    sentTo: inv.sentTo ?? [],
    emailed: inv.emailedAt !== null,
    sections,
    subtotalCents: inv.subtotalCents,
    taxCents: inv.taxCents,
    totalCents: inv.totalCents,
    paidCents: inv.amountPaidCents,
    void: inv.voidedAt ? { at: inv.voidedAt.toISOString(), reason: inv.voidReason ?? "" } : null,
    can: {
      download: !!inv.pdfUrl && inv.status !== "draft" && inv.status !== "in_review",
      resend: access.canReview && sent && !!inv.pdfUrl,
      void: can(actor.member, "invoices.void") && inv.status === "sent",
    },
    resend: emailDefaults(inv, inv.number ?? "", inv.dueDate, project, p),
  };
}
