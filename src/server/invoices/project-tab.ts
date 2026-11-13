import { and, asc, eq, inArray, isNull, max } from "drizzle-orm";
import { consultants, invoiceLines, invoices, payments, projectPhases } from "@/db/schema";
import type { TenantDb } from "@/db/tenant";
import { type InvoiceStatus, hoursToHundredths, projectInvoiceSummary } from "@/lib/calc/invoice";
import { type ForLine, invoiceFor, projectStatusText } from "@/lib/calc/receivables";
import { type InvoiceActor, projectAccess } from "./draft";

// A project's Invoices tab (invoicing spec Layout B, rule 11): the summary
// line and every invoice on the project. No New invoice here (#29).

export type ProjectInvoiceRow = {
  id: string;
  number: string | null;
  status: InvoiceStatus;
  issueDate: string;
  /** What it billed, from its lines ("Schematic Design · 100%"). */
  forText: string;
  totalCents: number;
  statusText: string;
  /** Drafts open in the builder; the rest on their own page. */
  href: string;
};

export type ProjectInvoices = {
  summary: { billedCents: number; receivedCents: number; outstandingCents: number };
  rows: ProjectInvoiceRow[];
};

/** Null when the project isn't there or this person can't see its invoices. */
export async function loadProjectInvoices(db: TenantDb, actor: InvoiceActor, projectId: string): Promise<ProjectInvoices | null> {
  const access = await projectAccess(db, actor, projectId);
  if (!access || (!access.canDraft && !access.canReview)) return null;

  const list = await db
    .select({
      id: invoices.id,
      number: invoices.number,
      status: invoices.status,
      issueDate: invoices.issueDate,
      dueDate: invoices.dueDate,
      totalCents: invoices.totalCents,
      amountPaidCents: invoices.amountPaidCents,
    })
    .from(invoices)
    .where(and(eq(invoices.projectId, projectId), isNull(invoices.archivedAt)))
    .orderBy(asc(invoices.issueDate), asc(invoices.createdAt));
  const ids = list.map((i) => i.id);

  const [lines, lastPaid] = ids.length
    ? await Promise.all([
        db
          .select({
            invoiceId: invoiceLines.invoiceId,
            lineType: invoiceLines.lineType,
            phase: projectPhases.name,
            consultant: consultants.discipline,
            percentCompleteBp: invoiceLines.percentCompleteBp,
            quantity: invoiceLines.quantity,
            description: invoiceLines.description,
          })
          .from(invoiceLines)
          .leftJoin(projectPhases, eq(projectPhases.id, invoiceLines.projectPhaseId))
          .leftJoin(consultants, eq(consultants.id, invoiceLines.consultantId))
          .where(and(inArray(invoiceLines.invoiceId, ids), isNull(invoiceLines.archivedAt)))
          .orderBy(asc(invoiceLines.sortOrder), asc(invoiceLines.createdAt)),
        db
          .select({ invoiceId: payments.invoiceId, on: max(payments.receivedOn) })
          .from(payments)
          .where(and(inArray(payments.invoiceId, ids), isNull(payments.archivedAt)))
          .groupBy(payments.invoiceId),
      ])
    : [[], []];

  const forLines = new Map<string, ForLine[]>();
  for (const l of lines) {
    const arr = forLines.get(l.invoiceId) ?? [];
    arr.push({
      lineType: l.lineType,
      name: l.lineType === "consultant" ? l.consultant : l.phase,
      percentCompleteBp: l.percentCompleteBp,
      hoursHundredths: l.lineType === "hourly" ? hoursToHundredths(l.quantity) : null,
      description: l.description,
    });
    forLines.set(l.invoiceId, arr);
  }
  const paidOn = new Map(lastPaid.map((p) => [p.invoiceId, p.on]));

  // Drafts last, as they haven't gone out yet.
  const isDraft = (s: InvoiceStatus) => s === "draft" || s === "in_review";
  const ordered = [...list.filter((i) => !isDraft(i.status)), ...list.filter((i) => isDraft(i.status))];

  return {
    summary: projectInvoiceSummary(list),
    rows: ordered.map((i) => ({
      id: i.id,
      number: i.number,
      status: i.status,
      issueDate: i.issueDate,
      forText: invoiceFor(forLines.get(i.id) ?? []),
      totalCents: i.totalCents,
      statusText: projectStatusText(i.status, i.dueDate, paidOn.get(i.id) ?? null),
      href: isDraft(i.status) ? `/app/invoices/${i.id}/edit` : `/app/invoices/${i.id}`,
    })),
  };
}
