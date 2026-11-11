import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or } from "drizzle-orm";
import {
  companies,
  contacts,
  firmRoles,
  firmSettings,
  invoiceExcludedEntries,
  invoiceLines,
  invoices,
  memberships,
  projects,
  timeEntries,
  timesheets,
  users,
} from "@/db/schema";
import type { TenantDb } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import { type InvoiceStatus, OPEN_STATUSES, hoursSuggestBp, hoursToHundredths, timeValueCents } from "@/lib/calc/invoice";
import { type ConsultantRow, type FixedRow, type HourlyRow, money, sumHundredths } from "@/lib/calc/invoice-plan";
import { formatDate } from "@/lib/format";
import { sendProblems } from "@/lib/invoices/builder";
import { loadRateBook } from "@/server/time/approval";
import { type Access, type InvoiceActor, type InvoiceRow, canEdit, planFor, projectAccess, projectPhaseRows, recalculate, versionOf } from "./draft";

// What the invoice pages read (invoicing spec, Layout A and C). Bill rates
// show to PMs who can build the invoice (decision #4); cost rates, cost and
// profit are never selected here.

export type BuilderEntry = {
  id: string;
  workDate: string;
  person: string;
  roleName: string;
  hours: string;
  rateCents: number;
  note: string | null;
  included: boolean;
};

export type Warning = { tone: "attention" | "danger"; message: string };

export type BuilderView = {
  id: string;
  version: string;
  status: InvoiceStatus;
  project: { id: string; number: string; name: string };
  client: { id: string; name: string };
  settings: {
    periodStart: string | null;
    periodEnd: string;
    issueDate: string;
    dueDate: string;
    billToContactId: string | null;
    memo: string;
    termsDays: number;
  };
  contacts: { id: string; name: string; email: string | null }[];
  fixed: (FixedRow & {
    /** Bill-rate value of time on the phase in this invoice's period. */
    wipCents: number;
    wipHundredths: number;
    /** All hours on the phase to date (drafts too, decision #20). */
    usedHundredths: number;
    budgetHours: string;
    /** Hours used ÷ budget, capped at 100 %; null with no budget. */
    suggestBp: number | null;
  })[];
  hourly: (HourlyRow & { entries: BuilderEntry[] })[];
  consultants: ConsultantRow[];
  adjustments: { id: string; description: string; amountCents: number }[];
  warnings: Warning[];
  totals: {
    subtotalCents: number;
    taxCents: number;
    totalCents: number;
    priorInvoices: { number: string; balanceCents: number }[];
    priorOutstandingCents: number;
  };
  /** Rule 14: what blocks Submit for review / Send. */
  problems: string[];
  can: { edit: boolean; submit: boolean; returnToDraft: boolean; delete: boolean };
};

const pct1 = (bp: number) => `${(Math.floor(bp / 10) / 10).toFixed(1).replace(/\.0$/, "")}%`;

/** The builder page for one draft (refreshed first), or null when it isn't there or isn't theirs. */
export async function loadBuilder(db: TenantDb, actor: InvoiceActor, invoiceId: string): Promise<BuilderView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) return null;
  const [inv] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), isNull(invoices.archivedAt)));
  if (!inv) return null;
  const access = await projectAccess(db, actor, inv.projectId);
  if (!access || (!access.canDraft && !access.canReview)) return null;
  // Opening a draft brings it up to date (time approved since, % changed on
  // the project page). Nothing is written when it's already current.
  if (canEdit(inv, access)) {
    const r = await recalculate(db, inv);
    if (r.changed) {
      const [fresh] = await db.select().from(invoices).where(eq(invoices.id, inv.id));
      return buildView(db, fresh, access);
    }
  }
  return buildView(db, inv, access);
}

export async function buildView(db: TenantDb, inv: InvoiceRow, access: Access): Promise<BuilderView> {
  const p = access.project;
  const [plan, client, settings, contactRows, lineRows] = await Promise.all([
    planFor(db, inv),
    db.select({ id: companies.id, name: companies.name }).from(companies).where(eq(companies.id, inv.clientCompanyId)),
    db.select({ terms: firmSettings.defaultPaymentTermsDays }).from(firmSettings),
    db
      .select({ id: contacts.id, first: contacts.firstName, last: contacts.lastName, email: contacts.email })
      .from(contacts)
      .where(and(eq(contacts.companyId, inv.clientCompanyId), isNull(contacts.archivedAt)))
      .orderBy(asc(contacts.lastName), asc(contacts.firstName)),
    db
      .select()
      .from(invoiceLines)
      .where(and(eq(invoiceLines.invoiceId, inv.id), isNull(invoiceLines.archivedAt)))
      .orderBy(asc(invoiceLines.sortOrder), asc(invoiceLines.createdAt)),
  ]);
  const contactList = contactRows.map((c) => ({ id: c.id, name: `${c.first} ${c.last ?? ""}`.trim(), email: c.email }));

  // Time entries on hourly phases: reserved on this draft, plus ones unticked here.
  const hourlyIds = plan.hourly.map((h) => h.phaseId);
  const excluded = await db
    .select({ id: invoiceExcludedEntries.timeEntryId })
    .from(invoiceExcludedEntries)
    .where(and(eq(invoiceExcludedEntries.invoiceId, inv.id), isNull(invoiceExcludedEntries.archivedAt)));
  const excludedIds = excluded.map((e) => e.id);
  const entryRows = hourlyIds.length
    ? await db
        .select({
          id: timeEntries.id,
          phaseId: timeEntries.projectPhaseId,
          workDate: timeEntries.workDate,
          first: users.firstName,
          last: users.lastName,
          roleName: firmRoles.name,
          hours: timeEntries.hours,
          rateCents: timeEntries.billRateCents,
          note: timeEntries.note,
          invoiceId: timeEntries.invoiceId,
        })
        .from(timeEntries)
        .innerJoin(timesheets, eq(timesheets.id, timeEntries.timesheetId))
        .innerJoin(memberships, eq(memberships.id, timesheets.membershipId))
        .innerJoin(users, eq(users.id, memberships.userId))
        .leftJoin(firmRoles, eq(firmRoles.id, timeEntries.firmRoleId))
        .where(
          and(
            inArray(timeEntries.projectPhaseId, hourlyIds),
            isNull(timeEntries.archivedAt),
            or(eq(timeEntries.invoiceId, inv.id), excludedIds.length ? inArray(timeEntries.id, excludedIds) : undefined),
          ),
        )
        .orderBy(asc(timeEntries.workDate), asc(users.lastName))
    : [];

  // Approved-but-not-yet billable time is reserved; what isn't approved yet is a warning.
  const unapproved = hourlyIds.length
    ? await db
        .select({ hours: timeEntries.hours })
        .from(timeEntries)
        .innerJoin(timesheets, eq(timesheets.id, timeEntries.timesheetId))
        .where(
          and(
            inArray(timeEntries.projectPhaseId, hourlyIds),
            eq(timeEntries.billable, true),
            isNull(timeEntries.archivedAt),
            isNull(timeEntries.invoiceId),
            lte(timeEntries.workDate, inv.periodEnd),
            ne(timesheets.status, "approved"),
          ),
        )
    : [];

  // Time on hourly phases marked non-billable in the period: never billed, worth a heads-up.
  const nonBillable = hourlyIds.length
    ? await db
        .select({ hours: timeEntries.hours })
        .from(timeEntries)
        .where(
          and(
            inArray(timeEntries.projectPhaseId, hourlyIds),
            eq(timeEntries.billable, false),
            isNull(timeEntries.archivedAt),
            lte(timeEntries.workDate, inv.periodEnd),
            inv.periodStart ? gte(timeEntries.workDate, inv.periodStart) : undefined,
          ),
        )
    : [];

  const wip = await fixedPhaseWip(db, inv);

  // Other open invoices on the project (account summary).
  const prior = await db
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
    .orderBy(asc(invoices.issueDate));
  const priorInvoices = prior.map((r) => ({ number: r.number ?? "—", balanceCents: r.total - r.paid }));

  const adjustments = lineRows
    .filter((l) => l.lineType === "adjustment" && l.projectPhaseId === null)
    .map((l) => ({ id: l.id, description: l.description, amountCents: l.amountCents }));

  // Warnings (Layout C.3).
  const warnings: Warning[] = [];
  const unapprovedHundredths = sumHundredths(unapproved.map((u) => u.hours));
  if (unapprovedHundredths > 0)
    warnings.push({
      tone: "attention",
      message: `${unapprovedHundredths / 100} h of billable time through ${formatDate(inv.periodEnd)} isn't approved yet, so it isn't on this invoice.`,
    });
  const nonBillableHundredths = sumHundredths(nonBillable.map((u) => u.hours));
  if (nonBillableHundredths > 0)
    warnings.push({
      tone: "attention",
      message: `${nonBillableHundredths / 100} h on hourly phases in this period is marked non-billable on timesheets, so it isn't on this invoice.`,
    });
  for (const f of plan.fixed) if (f.error) warnings.push({ tone: "danger", message: `${f.name}: ${f.error}` });
  for (const c of plan.consultants) if (c.error) warnings.push({ tone: "danger", message: `${c.label}: ${c.error}` });
  for (const h of plan.hourly) {
    if (h.warning === "reached")
      warnings.push({
        tone: "danger",
        message:
          h.writeDownCents > 0
            ? `${h.name}: limit reached; ${money(h.writeDownCents)} of time not billed.`
            : `${h.name}: the ${money(h.feeCents)} limit is reached.`,
      });
    else if (h.warning === "approaching")
      warnings.push({ tone: "attention", message: `${h.name}: approaching the ${money(h.feeCents)} limit (${pct1(h.pctOfCapBp ?? 0)} used).` });
  }
  const billTo = contactList.find((c) => c.id === inv.billToContactId);
  const hasToAddress = !!billTo?.email?.trim();
  if (!hasToAddress)
    warnings.push({
      tone: "attention",
      message: billTo
        ? `${billTo.name} has no email address. Add one in Contacts or pick another bill-to contact.`
        : "Pick a bill-to contact with an email address.",
    });

  const problems = sendProblems({
    totalCents: inv.totalCents,
    lineCount: lineRows.length,
    hasToAddress,
    negativeFixedLine: lineRows.some((l) => l.lineType === "phase_fee" && l.amountCents < 0),
    hasClient: !!client[0],
  });
  const editable = canEdit(inv, access);

  return {
    id: inv.id,
    version: versionOf(inv),
    status: inv.status,
    project: { id: p.id, number: p.number, name: p.name },
    client: client[0] ?? { id: inv.clientCompanyId, name: "—" },
    settings: {
      periodStart: inv.periodStart,
      periodEnd: inv.periodEnd,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      billToContactId: inv.billToContactId,
      memo: inv.memo ?? "",
      termsDays: settings[0]?.terms ?? 30,
    },
    contacts: contactList,
    fixed: plan.fixed.map((f) => {
      const w = wip.get(f.phaseId);
      const used = w?.usedHundredths ?? 0;
      return {
        ...f,
        wipCents: w?.wipCents ?? 0,
        wipHundredths: w?.wipHundredths ?? 0,
        usedHundredths: used,
        budgetHours: w?.budgetHours ?? "0",
        suggestBp: hoursSuggestBp(used, w?.budgetHours ?? "0"),
      };
    }),
    hourly: plan.hourly.map((h) => ({
      ...h,
      entries: entryRows
        .filter((e) => e.phaseId === h.phaseId)
        .map((e) => ({
          id: e.id,
          workDate: e.workDate,
          person: `${e.first ?? ""} ${e.last ?? ""}`.trim(),
          roleName: e.roleName ?? "Staff",
          hours: e.hours,
          rateCents: e.rateCents ?? 0,
          note: e.note,
          included: e.invoiceId === inv.id,
        })),
    })),
    consultants: plan.consultants,
    adjustments,
    warnings,
    totals: {
      subtotalCents: inv.subtotalCents,
      taxCents: inv.taxCents,
      totalCents: inv.totalCents,
      priorInvoices,
      priorOutstandingCents: priorInvoices.reduce((n, r) => n + r.balanceCents, 0),
    },
    problems,
    can: {
      edit: editable,
      submit: editable && inv.status === "draft",
      returnToDraft: access.canReview && inv.status === "in_review",
      delete: access.canDraft && inv.status === "draft",
    },
  };
}

/**
 * WIP on fixed-fee phases (Blake, 2026-11-11): the bill-rate value of time
 * on each phase in this invoice's period, and all hours to date against the
 * phase budget. Approved time uses its frozen rate; other time uses the
 * rate in force on the work date (as the snapshot does, decision #20).
 */
async function fixedPhaseWip(db: TenantDb, inv: InvoiceRow) {
  const phases = (await projectPhaseRows(db, inv.projectId)).filter((p) => p.feeType === "fixed");
  const out = new Map<string, { wipCents: number; wipHundredths: number; usedHundredths: number; budgetHours: string }>();
  if (!phases.length) return out;
  const rows = await db
    .select({
      phaseId: timeEntries.projectPhaseId,
      workDate: timeEntries.workDate,
      hours: timeEntries.hours,
      rateCents: timeEntries.billRateCents,
      membershipId: timesheets.membershipId,
      firmRoleId: memberships.firmRoleId,
    })
    .from(timeEntries)
    .innerJoin(timesheets, eq(timesheets.id, timeEntries.timesheetId))
    .innerJoin(memberships, eq(memberships.id, timesheets.membershipId))
    .where(
      and(
        inArray(timeEntries.projectPhaseId, phases.map((p) => p.id)),
        isNull(timeEntries.archivedAt),
      ),
    );
  const rateOf = await loadRateBook(
    db,
    rows.map((r) => ({ membershipId: r.membershipId, firmRoleId: r.firmRoleId })),
  );
  for (const p of phases) {
    const mine = rows.filter((r) => r.phaseId === p.id);
    const inPeriod = mine.filter((r) => r.workDate <= inv.periodEnd && (!inv.periodStart || r.workDate >= inv.periodStart));
    out.set(p.id, {
      wipCents: timeValueCents(
        inPeriod.map((r) => ({
          hours: r.hours,
          rateCents: r.rateCents ?? rateOf(r.membershipId, r.firmRoleId, r.workDate)?.billRateCents ?? 0,
        })),
      ),
      wipHundredths: inPeriod.reduce((n, r) => n + hoursToHundredths(r.hours), 0),
      usedHundredths: mine.reduce((n, r) => n + hoursToHundredths(r.hours), 0),
      budgetHours: p.budgetHours,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The Invoices page (Layout A, first version: decision #29)

export type InvoiceListRow = {
  id: string;
  number: string | null;
  status: InvoiceStatus;
  project: { id: string; number: string; name: string };
  client: string;
  periodEnd: string;
  totalCents: number;
  updatedAt: string;
};

export type BillableProject = { id: string; number: string; name: string; client: string; draftId: string | null };

/** Projects this person may start an invoice on (active or on hold). */
async function myBillableProjectIds(db: TenantDb, actor: InvoiceActor): Promise<Set<string> | "all"> {
  if (can(actor.member, "invoices.create_draft")) return "all";
  const me = actor.member.membershipId;
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(isNull(projects.archivedAt), or(eq(projects.pmMembershipId, me), eq(projects.principalMembershipId, me))));
  return new Set(rows.map((r) => r.id));
}

export async function loadInvoicesPage(
  db: TenantDb,
  actor: InvoiceActor,
): Promise<{ rows: InvoiceListRow[]; projects: BillableProject[] }> {
  const scope = await myBillableProjectIds(db, actor);
  const rows = await db
    .select({
      id: invoices.id,
      number: invoices.number,
      status: invoices.status,
      projectId: projects.id,
      projectNumber: projects.number,
      projectName: projects.name,
      client: companies.name,
      periodEnd: invoices.periodEnd,
      totalCents: invoices.totalCents,
      updatedAt: invoices.updatedAt,
    })
    .from(invoices)
    .innerJoin(projects, eq(projects.id, invoices.projectId))
    .innerJoin(companies, eq(companies.id, invoices.clientCompanyId))
    .where(isNull(invoices.archivedAt))
    .orderBy(desc(invoices.updatedAt));
  const projectRows = await db
    .select({ id: projects.id, number: projects.number, name: projects.name, client: companies.name })
    .from(projects)
    .innerJoin(companies, eq(companies.id, projects.clientCompanyId))
    .where(and(isNull(projects.archivedAt), inArray(projects.status, ["active", "on_hold"])))
    .orderBy(desc(projects.number));
  const inScope = (id: string) => scope === "all" || scope.has(id);
  const drafts = new Map(
    rows.filter((r) => r.status === "draft" || r.status === "in_review").map((r) => [r.projectId, r.id]),
  );
  return {
    rows: rows
      .filter((r) => inScope(r.projectId))
      .map((r) => ({
        id: r.id,
        number: r.number,
        status: r.status,
        project: { id: r.projectId, number: r.projectNumber, name: r.projectName },
        client: r.client,
        periodEnd: r.periodEnd,
        totalCents: r.totalCents,
        updatedAt: r.updatedAt.toISOString(),
      })),
    projects: projectRows.filter((p) => inScope(p.id)).map((p) => ({ ...p, draftId: drafts.get(p.id) ?? null })),
  };
}
