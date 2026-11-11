import { and, eq, inArray, isNull } from "drizzle-orm";
import { invoiceLines, invoices, projectPhases } from "@/db/schema";
import type { TenantDb } from "@/db/tenant";
import { type InvoiceMoney, type PriorLine, OPEN_STATUSES, lastBilledBp, previouslyBilled } from "@/lib/calc/invoice";

// Invoice facts other pages read: billed per phase and project, balances
// per client, last billed %. Only non-archived invoices and lines; which
// statuses count is decided by the calc functions (rule 2).

export type ProjectPriorLine = PriorLine & { projectId: string };

/** Every live line on these projects' live invoices, any status. */
export async function linesForProjects(db: TenantDb, projectIds: readonly string[]): Promise<ProjectPriorLine[]> {
  if (!projectIds.length) return [];
  const rows = await db
    .select({
      projectId: invoices.projectId,
      invoiceId: invoices.id,
      invoiceStatus: invoices.status,
      issueDate: invoices.issueDate,
      projectPhaseId: invoiceLines.projectPhaseId,
      lineType: invoiceLines.lineType,
      amountCents: invoiceLines.amountCents,
      percentCompleteBp: invoiceLines.percentCompleteBp,
    })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .where(and(inArray(invoices.projectId, [...projectIds]), isNull(invoices.archivedAt), isNull(invoiceLines.archivedAt)));
  return rows;
}

/** Lines grouped by project, for billed totals on the projects list. */
export async function linesByProject(db: TenantDb, projectIds: readonly string[]): Promise<Map<string, ProjectPriorLine[]>> {
  const out = new Map<string, ProjectPriorLine[]>();
  for (const l of await linesForProjects(db, projectIds)) (out.get(l.projectId) ?? out.set(l.projectId, []).get(l.projectId)!).push(l);
  return out;
}

/** A project's invoices' money (status, total, paid). */
export async function invoiceMoneyForProject(db: TenantDb, projectId: string): Promise<InvoiceMoney[]> {
  return db
    .select({ status: invoices.status, totalCents: invoices.totalCents, amountPaidCents: invoices.amountPaidCents })
    .from(invoices)
    .where(and(eq(invoices.projectId, projectId), isNull(invoices.archivedAt)));
}

/** Σ balance of a project's open invoices. */
export const outstandingCents = (money: readonly InvoiceMoney[]) =>
  money.filter((m) => OPEN_STATUSES.has(m.status)).reduce((n, m) => n + m.totalCents - m.amountPaidCents, 0);

/** Each client company's invoices' money (contacts list). */
export async function invoiceMoneyByCompany(db: TenantDb): Promise<Map<string, InvoiceMoney[]>> {
  const rows = await db
    .select({
      companyId: invoices.clientCompanyId,
      status: invoices.status,
      totalCents: invoices.totalCents,
      amountPaidCents: invoices.amountPaidCents,
    })
    .from(invoices)
    .where(isNull(invoices.archivedAt));
  const out = new Map<string, InvoiceMoney[]>();
  for (const { companyId, ...m } of rows) (out.get(companyId) ?? out.set(companyId, []).get(companyId)!).push(m);
  return out;
}

export type PhaseBilling = { billedCents: number; lastBilledPctBp: number; hasInvoiceLines: boolean };

/**
 * Per phase: billed so far (rule 2), the last billed % (fixed phases), and
 * whether any live invoice (drafts too) has a line on it.
 */
export async function phaseBilling(db: TenantDb, phaseIds: readonly string[]): Promise<Map<string, PhaseBilling>> {
  const out = new Map<string, PhaseBilling>();
  if (!phaseIds.length) return out;
  const phases = await db
    .select({ id: projectPhases.id, projectId: projectPhases.projectId, feeType: projectPhases.feeType })
    .from(projectPhases)
    .where(inArray(projectPhases.id, [...phaseIds]));
  const lines = await linesForProjects(db, [...new Set(phases.map((p) => p.projectId))]);
  for (const p of phases) {
    const mine = lines.filter((l) => l.projectPhaseId === p.id);
    if (!mine.length) continue;
    out.set(p.id, {
      billedCents: previouslyBilled(mine, p.id, p.feeType, null),
      lastBilledPctBp: p.feeType === "fixed" ? lastBilledBp(mine, p.id, null) : 0,
      hasInvoiceLines: true,
    });
  }
  return out;
}
