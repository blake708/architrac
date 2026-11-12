import { and, asc, eq, isNull } from "drizzle-orm";
import {
  companies,
  consultants,
  invoiceLines,
  projectPhases,
} from "@/db/schema";
import type { TenantDb } from "@/db/tenant";
import {
  type InvoiceSections,
  invoiceSections,
  linesAsOf,
} from "@/lib/calc/invoice-sections";
import type { InvoiceRow } from "./draft";
import { linesForProjects } from "./facts";

// Reads what invoiceSections() needs for one invoice: its saved lines, the
// project's phases and billed-through consultants, and the project's other
// lines as they stood when this invoice was sent.

export async function loadSections(
  db: TenantDb,
  inv: Pick<InvoiceRow, "id" | "projectId" | "sentAt" | "subtotalCents">,
): Promise<InvoiceSections> {
  const [lines, phases, cons, prior] = await Promise.all([
    db
      .select()
      .from(invoiceLines)
      .where(
        and(
          eq(invoiceLines.invoiceId, inv.id),
          isNull(invoiceLines.archivedAt),
        ),
      )
      .orderBy(asc(invoiceLines.sortOrder), asc(invoiceLines.createdAt)),
    db
      .select()
      .from(projectPhases)
      .where(eq(projectPhases.projectId, inv.projectId))
      .orderBy(asc(projectPhases.sortOrder), asc(projectPhases.createdAt)),
    db
      .select({
        id: consultants.id,
        discipline: consultants.discipline,
        company: companies.name,
        feeCents: consultants.feeCents,
        markupBp: consultants.markupBp,
        billedThrough: consultants.billedThrough,
        archivedAt: consultants.archivedAt,
      })
      .from(consultants)
      .innerJoin(companies, eq(companies.id, consultants.companyId))
      .where(eq(consultants.projectId, inv.projectId))
      .orderBy(asc(consultants.discipline), asc(companies.name)),
    linesForProjects(db, [inv.projectId]),
  ]);
  return invoiceSections({
    invoiceId: inv.id,
    lines,
    phases: phases.map((p) => ({
      id: p.id,
      name: p.name,
      feeType: p.feeType,
      feeCents: p.feeCents,
      additional: p.isAdditionalService,
      archived: p.archivedAt !== null,
    })),
    consultants: cons.map((c) => ({
      id: c.id,
      label: `${c.discipline} · ${c.company}`,
      feeCents: c.feeCents,
      markupBp: c.markupBp,
      archived: c.archivedAt !== null || !c.billedThrough,
    })),
    priorLines: linesAsOf(prior, inv.id, inv.sentAt),
    subtotalCents: inv.subtotalCents,
  });
}
