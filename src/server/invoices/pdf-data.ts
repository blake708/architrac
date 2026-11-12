import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import {
  companies,
  contacts,
  firmSettings,
  firms,
  invoiceLines,
  invoices,
  memberships,
  projectPhases,
  projects,
  timeEntries,
  timesheets,
  users,
} from "@/db/schema";
import type { TenantDb } from "@/db/tenant";
import { OPEN_STATUSES } from "@/lib/calc/invoice";
import { firmDisplayName } from "@/lib/settings/firm-profile";
import { type InvoiceRow, planFor } from "./draft";

// Everything the invoice PDF prints (invoicing spec rule 17), read in one
// go. The PDF itself (pdf.tsx) only lays this out; no math happens there.
// Only bill rates appear (they print on the client's invoice); cost and
// profit are never read here.

type Address = {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
};

/** "123 Main St", "Suite 4", "Charleston, SC 29401". */
export function addressLines(a: Address): string[] {
  const cityLine = [a.city, [a.state, a.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [a.addressLine1, a.addressLine2, cityLine].filter((x): x is string => !!x);
}

export type PdfMark = "DRAFT" | "VOID" | null;

export type InvoicePdfData = {
  mark: PdfMark;
  firm: { name: string; logoUrl: string | null; address: string[]; phone: string | null; email: string | null };
  /** Null on a draft preview (numbers are given at send). */
  number: string | null;
  issueDate: string;
  dueDate: string;
  termsDays: number;
  periodEnd: string;
  billTo: { company: string; contact: string | null; address: string[] };
  project: { number: string; name: string; address: string[] };
  memo: string | null;
  fixed: {
    phase: string;
    feeCents: number;
    percentCompleteBp: number;
    earnedCents: number;
    previousCents: number;
    thisCents: number;
  }[];
  hourly: { phase: string; role: string; hoursHundredths: number | null; rateCents: number | null; amountCents: number }[];
  consultants: {
    label: string;
    feeCents: number;
    percentCompleteBp: number;
    earnedCents: number;
    previousCents: number;
    thisCents: number;
  }[];
  adjustments: { description: string; amountCents: number }[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  prior: { number: string; balanceCents: number }[];
  timeDetail: { date: string; person: string; phase: string; hours: string; note: string | null }[];
  remittance: string | null;
};

export async function loadPdfData(db: TenantDb, inv: InvoiceRow, mark: PdfMark): Promise<InvoicePdfData> {
  const [[firm], [settings], [project], [client], billTo, plan, lineRows, prior, entries] = await Promise.all([
    db.select().from(firms).where(eq(firms.id, inv.firmId)),
    db
      .select({ terms: firmSettings.defaultPaymentTermsDays, remittance: firmSettings.invoiceRemittanceText })
      .from(firmSettings),
    db.select().from(projects).where(eq(projects.id, inv.projectId)),
    db.select().from(companies).where(eq(companies.id, inv.clientCompanyId)),
    inv.billToContactId
      ? db
          .select({ first: contacts.firstName, last: contacts.lastName })
          .from(contacts)
          .where(eq(contacts.id, inv.billToContactId))
      : Promise.resolve([]),
    planFor(db, inv),
    db
      .select()
      .from(invoiceLines)
      .where(and(eq(invoiceLines.invoiceId, inv.id), isNull(invoiceLines.archivedAt)))
      .orderBy(asc(invoiceLines.sortOrder), asc(invoiceLines.createdAt)),
    db
      .select({ number: invoices.number, total: invoices.totalCents, paid: invoices.amountPaidCents })
      .from(invoices)
      .where(
        and(
          eq(invoices.projectId, inv.projectId),
          ne(invoices.id, inv.id),
          isNull(invoices.archivedAt),
          inArray(invoices.status, [...OPEN_STATUSES]),
        ),
      )
      .orderBy(asc(invoices.issueDate)),
    db
      .select({
        date: timeEntries.workDate,
        first: users.firstName,
        last: users.lastName,
        phase: projectPhases.name,
        hours: timeEntries.hours,
        note: timeEntries.note,
      })
      .from(timeEntries)
      .innerJoin(timesheets, eq(timesheets.id, timeEntries.timesheetId))
      .innerJoin(memberships, eq(memberships.id, timesheets.membershipId))
      .innerJoin(users, eq(users.id, memberships.userId))
      .leftJoin(projectPhases, eq(projectPhases.id, timeEntries.projectPhaseId))
      .where(and(eq(timeEntries.invoiceId, inv.id), isNull(timeEntries.archivedAt)))
      .orderBy(asc(timeEntries.workDate), asc(users.lastName)),
  ]);

  const hourly: InvoicePdfData["hourly"] = [];
  for (const h of plan.hourly) {
    for (const g of h.groups)
      hourly.push({ phase: h.name, role: g.roleName, hoursHundredths: g.hoursHundredths, rateCents: g.rateCents, amountCents: g.amountCents });
    if (h.writeDownCents > 0)
      hourly.push({ phase: h.name, role: "Not-to-exceed limit reached", hoursHundredths: null, rateCents: null, amountCents: -h.writeDownCents });
  }
  const contact = billTo[0] ? `${billTo[0].first} ${billTo[0].last ?? ""}`.trim() : null;

  return {
    mark,
    firm: {
      name: firm ? firmDisplayName(firm) : "",
      logoUrl: firm?.logoUrl && /^https?:\/\//.test(firm.logoUrl) ? firm.logoUrl : null,
      address: firm ? addressLines(firm) : [],
      phone: firm?.phone ?? null,
      email: firm?.email ?? null,
    },
    number: inv.number,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    termsDays: settings?.terms ?? 30,
    periodEnd: inv.periodEnd,
    billTo: { company: client?.name ?? "", contact, address: client ? addressLines(client) : [] },
    project: { number: project?.number ?? "", name: project?.name ?? "", address: project ? addressLines(project) : [] },
    memo: inv.memo,
    fixed: plan.fixed.map((f) => ({
      phase: f.name,
      feeCents: f.feeCents,
      percentCompleteBp: f.percentCompleteBp,
      earnedCents: f.earnedToDateCents,
      previousCents: f.previouslyBilledCents,
      thisCents: f.thisInvoiceCents,
    })),
    hourly,
    consultants: plan.consultants.map((c) => ({
      label: c.label,
      feeCents: c.clientFeeCents,
      percentCompleteBp: c.percentCompleteBp,
      earnedCents: c.earnedToDateCents,
      previousCents: c.previouslyBilledCents,
      thisCents: c.thisInvoiceCents,
    })),
    adjustments: lineRows
      .filter((l) => l.lineType === "adjustment" && l.projectPhaseId === null)
      .map((l) => ({ description: l.description, amountCents: l.amountCents })),
    subtotalCents: inv.subtotalCents,
    taxCents: inv.taxCents,
    totalCents: inv.totalCents,
    prior: prior.map((p) => ({ number: p.number ?? "—", balanceCents: p.total - p.paid })),
    timeDetail:
      inv.includeTimeDetail && entries.length
        ? entries.map((e) => ({
            date: e.date,
            person: `${e.first ?? ""} ${e.last ?? ""}`.trim(),
            phase: e.phase ?? "",
            hours: String(Number(e.hours)),
            note: e.note,
          }))
        : [],
    remittance: settings?.remittance ?? null,
  };
}
