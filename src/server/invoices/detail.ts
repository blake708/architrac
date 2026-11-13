import { and, asc, eq, isNull } from "drizzle-orm";
import { activityLog, companies, contacts, firms, invoices, payments, users } from "@/db/schema";
import type { TenantDb } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import { type InvoiceStatus, daysPastDue, invoiceDueDate } from "@/lib/calc/invoice";
import type { InvoiceSections } from "@/lib/calc/invoice-sections";
import { formatDate, formatMoney, todayIn } from "@/lib/format";
import { type ActivityItem, activityItems } from "@/lib/invoices/activity";
import { defaultSendMessage, invoiceRecipients } from "@/lib/invoices/builder";
import type { PaymentMethod } from "@/lib/invoices/payments";
import { firmDisplayName } from "@/lib/settings/firm-profile";
import { type InvoiceActor, type InvoiceRow, projectAccess } from "./draft";
import { peekNumber } from "./number";
import { loadSections } from "./sections";

// The invoice page after it's sent (invoicing spec Layout D): the invoice
// as billed, its payments, aging and activity; and the Send / Resend
// dialogs' starting values.

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
  /** today − due date (rule 10); shown while it's open. */
  daysPastDue: number;
  today: string;
  payments: { id: string; receivedOn: string; method: PaymentMethod; reference: string | null; amountCents: number }[];
  /** Newest first. `when` is in the firm's time zone. */
  activity: (Omit<ActivityItem, "at"> & { when: string })[];
  can: { download: boolean; resend: boolean; void: boolean; recordPayment: boolean; deletePayment: boolean };
  resend: EmailDefaults;
};

/** "Oct 16 · 2:15 PM" in the firm's time zone. */
function whenText(at: Date, timeZone: string) {
  const day = at.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone });
  const time = at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
  return `${day} · ${time}`;
}

async function invoicePayments(db: TenantDb, invoiceId: string) {
  return db
    .select({
      id: payments.id,
      receivedOn: payments.receivedOn,
      method: payments.method,
      reference: payments.reference,
      amountCents: payments.amountCents,
    })
    .from(payments)
    .where(and(eq(payments.invoiceId, invoiceId), isNull(payments.archivedAt)))
    .orderBy(asc(payments.receivedOn), asc(payments.createdAt));
}

async function invoiceActivity(db: TenantDb, invoiceId: string, timeZone: string) {
  const rows = await db
    .select({
      id: activityLog.id,
      action: activityLog.action,
      changes: activityLog.changes,
      first: users.firstName,
      last: users.lastName,
      at: activityLog.createdAt,
    })
    .from(activityLog)
    .leftJoin(users, eq(users.id, activityLog.actorUserId))
    .where(and(eq(activityLog.entityType, "invoice"), eq(activityLog.entityId, invoiceId)));
  return activityItems(
    rows.map((r) => ({
      id: r.id,
      action: r.action,
      changes: (r.changes ?? null) as Record<string, unknown> | null,
      who: `${r.first ?? ""} ${r.last ?? ""}`.trim() || "Someone",
      at: r.at,
    })),
  ).map(({ at, ...rest }) => ({ ...rest, when: whenText(at, timeZone) }));
}

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
  const [sections, p, paid, activity] = await Promise.all([
    loadSections(db, inv),
    people(db, inv, actor),
    invoicePayments(db, inv.id),
    invoiceActivity(db, inv.id, actor.timezone),
  ]);
  const today = todayIn(actor.timezone);
  const handlesPayments = can(actor.member, "payments.record");
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
    daysPastDue: daysPastDue(today, inv.dueDate),
    today,
    payments: paid,
    activity,
    can: {
      download: !!inv.pdfUrl && inv.status !== "draft" && inv.status !== "in_review",
      resend: access.canReview && sent && !!inv.pdfUrl,
      void: can(actor.member, "invoices.void") && inv.status === "sent",
      recordPayment: handlesPayments && (inv.status === "sent" || inv.status === "partially_paid"),
      deletePayment: handlesPayments && sent,
    },
    resend: emailDefaults(inv, inv.number ?? "", inv.dueDate, project, p),
  };
}
