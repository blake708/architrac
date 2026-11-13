import { and, desc, eq, gte, inArray, isNull, or } from "drizzle-orm";
import { companies, invoices, payments, projects } from "@/db/schema";
import type { TenantDb } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import { type InvoiceStatus, daysPastDue } from "@/lib/calc/invoice";
import {
  type ReceivablesKpis,
  balanceCents,
  monthStart,
  receivablesKpis,
} from "@/lib/calc/receivables";
import { todayIn } from "@/lib/format";
import type { InvoiceActor } from "./draft";

// The Invoices page (invoicing spec Layout A): every invoice this person
// may see, the KPIs, and the projects they may start an invoice on.
// Owners and admins see the whole firm; a PM sees their own projects.

export type InvoiceListRow = {
  id: string;
  number: string | null;
  status: InvoiceStatus;
  project: { id: string; number: string; name: string };
  client: { id: string; name: string };
  issueDate: string;
  /** The day it was sent, in the firm's time zone. */
  sentOn: string | null;
  dueDate: string;
  periodEnd: string;
  totalCents: number;
  amountPaidCents: number;
  balanceCents: number;
  /** today − due date; negative while not yet due (rule 10). */
  daysPastDue: number;
};

export type BillableProject = {
  id: string;
  number: string;
  name: string;
  client: string;
  draftId: string | null;
};

export type InvoicesPageData = {
  rows: InvoiceListRow[];
  projects: BillableProject[];
  kpis: ReceivablesKpis;
  today: string;
  can: { recordPayment: boolean };
};

/** Projects this person may see invoices on: all, or the ones they're PM or principal of. */
async function myProjectIds(
  db: TenantDb,
  actor: InvoiceActor,
): Promise<Set<string> | "all"> {
  if (can(actor.member, "invoices.create_draft")) return "all";
  const me = actor.member.membershipId;
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        isNull(projects.archivedAt),
        or(
          eq(projects.pmMembershipId, me),
          eq(projects.principalMembershipId, me),
        ),
      ),
    );
  return new Set(rows.map((r) => r.id));
}

export async function loadInvoicesPage(
  db: TenantDb,
  actor: InvoiceActor,
  now: Date = new Date(),
): Promise<InvoicesPageData> {
  const today = todayIn(actor.timezone, now);
  const scope = await myProjectIds(db, actor);
  const inScope = (id: string) => scope === "all" || scope.has(id);

  const [rows, projectRows, monthPayments] = await Promise.all([
    db
      .select({
        id: invoices.id,
        number: invoices.number,
        status: invoices.status,
        projectId: projects.id,
        projectNumber: projects.number,
        projectName: projects.name,
        clientId: companies.id,
        client: companies.name,
        issueDate: invoices.issueDate,
        sentAt: invoices.sentAt,
        dueDate: invoices.dueDate,
        periodEnd: invoices.periodEnd,
        totalCents: invoices.totalCents,
        amountPaidCents: invoices.amountPaidCents,
      })
      .from(invoices)
      .innerJoin(projects, eq(projects.id, invoices.projectId))
      .innerJoin(companies, eq(companies.id, invoices.clientCompanyId))
      .where(isNull(invoices.archivedAt))
      .orderBy(desc(invoices.updatedAt)),
    db
      .select({
        id: projects.id,
        number: projects.number,
        name: projects.name,
        client: companies.name,
      })
      .from(projects)
      .innerJoin(companies, eq(companies.id, projects.clientCompanyId))
      .where(
        and(
          isNull(projects.archivedAt),
          inArray(projects.status, ["active", "on_hold"]),
        ),
      )
      .orderBy(desc(projects.number)),
    db
      .select({
        amountCents: payments.amountCents,
        receivedOn: payments.receivedOn,
        projectId: invoices.projectId,
      })
      .from(payments)
      .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
      .where(
        and(
          isNull(payments.archivedAt),
          isNull(invoices.archivedAt),
          gte(payments.receivedOn, monthStart(today)),
        ),
      ),
  ]);

  const list: InvoiceListRow[] = rows
    .filter((r) => inScope(r.projectId))
    .map((r) => ({
      id: r.id,
      number: r.number,
      status: r.status,
      project: {
        id: r.projectId,
        number: r.projectNumber,
        name: r.projectName,
      },
      client: { id: r.clientId, name: r.client },
      issueDate: r.issueDate,
      sentOn: r.sentAt ? todayIn(actor.timezone, r.sentAt) : null,
      dueDate: r.dueDate,
      periodEnd: r.periodEnd,
      totalCents: r.totalCents,
      amountPaidCents: r.amountPaidCents,
      balanceCents: balanceCents(r),
      daysPastDue: daysPastDue(today, r.dueDate),
    }));
  const drafts = new Map(
    rows
      .filter((r) => r.status === "draft" || r.status === "in_review")
      .map((r) => [r.projectId, r.id]),
  );

  return {
    rows: list,
    projects: projectRows
      .filter((p) => inScope(p.id))
      .map((p) => ({ ...p, draftId: drafts.get(p.id) ?? null })),
    kpis: receivablesKpis(
      list,
      monthPayments.filter((p) => inScope(p.projectId)),
      today,
    ),
    today,
    can: { recordPayment: can(actor.member, "payments.record") },
  };
}
