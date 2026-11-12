import { and, eq, isNotNull } from "drizzle-orm";
import { firmSettings, invoices, projects } from "@/db/schema";
import type { TenantDb } from "@/db/tenant";
import { DEFAULT_INVOICE_NUMBER_FORMAT, formatNumber, usesProject } from "@/lib/calc/number-format";
import { INVOICE_MESSAGES } from "@/lib/invoices/builder";
import { InvoiceError, type InvoiceRow } from "./draft";

// Invoice numbers (invoicing spec rule 1, decision #5). A number is given
// out at send, inside the send transaction. The counter's row is locked
// first, so two invoices sent at the same moment queue up and get
// different numbers. A number already taken (typed in QuickBooks, an
// import, a format change) is skipped.

const MAX_TRIES = 5;

/** Give the invoice its number, and move the counter past it. Does nothing if it has one. */
export async function assignNumber(db: TenantDb, inv: InvoiceRow): Promise<string> {
  if (inv.number) return inv.number;
  const [settings] = await db
    .select({ firmId: firmSettings.firmId, format: firmSettings.invoiceNumberFormat, next: firmSettings.nextInvoiceNumber })
    .from(firmSettings)
    .where(eq(firmSettings.firmId, inv.firmId))
    .for("update");
  const format = settings?.format ?? DEFAULT_INVOICE_NUMBER_FORMAT;
  const year = Number(inv.issueDate.slice(0, 4));

  // {PROJECT} formats count per project; others count firm-wide, never resetting.
  const perProject = usesProject(format);
  const [project] = await db
    .select({ id: projects.id, number: projects.number, next: projects.nextInvoiceSeq })
    .from(projects)
    .where(eq(projects.id, inv.projectId))
    .for(perProject ? "update" : "no key update");
  if (!project) throw new InvoiceError(INVOICE_MESSAGES.notFound);
  if (!perProject && !settings) throw new InvoiceError(INVOICE_MESSAGES.numberFailed);

  let n = perProject ? project.next : settings!.next;
  for (let i = 0; i < MAX_TRIES; i++, n++) {
    const number = formatNumber(format, "invoice", { year, projectNumber: project.number, n });
    const [taken] = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.firmId, inv.firmId), eq(invoices.number, number), isNotNull(invoices.number)));
    if (taken) continue;
    await db.update(invoices).set({ number }).where(eq(invoices.id, inv.id));
    if (perProject) await db.update(projects).set({ nextInvoiceSeq: n + 1 }).where(eq(projects.id, project.id));
    else await db.update(firmSettings).set({ nextInvoiceNumber: n + 1 }).where(eq(firmSettings.firmId, settings!.firmId));
    return number;
  }
  throw new InvoiceError(INVOICE_MESSAGES.numberFailed);
}

/** What the next number would be right now (shown in the Send dialog; the real one is given at send). */
export async function peekNumber(db: TenantDb, inv: InvoiceRow, issueDate: string): Promise<string> {
  if (inv.number) return inv.number;
  const [settings] = await db
    .select({ format: firmSettings.invoiceNumberFormat, next: firmSettings.nextInvoiceNumber })
    .from(firmSettings)
    .where(eq(firmSettings.firmId, inv.firmId));
  const format = settings?.format ?? DEFAULT_INVOICE_NUMBER_FORMAT;
  const [project] = await db
    .select({ number: projects.number, next: projects.nextInvoiceSeq })
    .from(projects)
    .where(eq(projects.id, inv.projectId));
  const n = usesProject(format) ? (project?.next ?? 1) : (settings?.next ?? 1);
  return formatNumber(format, "invoice", { year: Number(issueDate.slice(0, 4)), projectNumber: project?.number ?? "", n });
}
