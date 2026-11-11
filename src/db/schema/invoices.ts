import { sql } from "drizzle-orm";
import {
  type PgTableExtraConfigValue,
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { archivedAt, id, timestamps } from "./columns";
import { companies, contacts } from "./contacts";
import { invoiceLineType, invoiceStatus, paymentMethod } from "./enums";
import { firms } from "./firms";
import { users } from "./people";
import { consultants, projectPhases, projects } from "./projects";

// Invoices, their lines and payments (invoicing spec, milestone 1.8). Every
// link stays inside one firm (composite keys). Money is integer cents.
// Excluded time entries live in invoice-time.ts (they need time_entries,
// which itself points back here).

/** One progress invoice for one project. */
export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    projectId: uuid("project_id").notNull(),
    /** The client at the time; copied from the project. */
    clientCompanyId: uuid("client_company_id").notNull(),
    /** Who it's addressed to. Defaults to the project's client contact, else the company's billing contact. */
    billToContactId: uuid("bill_to_contact_id"),
    /** Assigned at send (rule 1); null while draft or in review. Never reused. */
    number: text("number"),
    status: invoiceStatus("status").notNull().default("draft"),
    issueDate: date("issue_date").notNull(),
    dueDate: date("due_date").notNull(),
    /** Time cutoff: the day after the last invoice's period, else the project start. */
    periodStart: date("period_start"),
    /** "Period through". */
    periodEnd: date("period_end").notNull(),
    subtotalCents: bigint("subtotal_cents", { mode: "number" }).notNull().default(0),
    taxCents: bigint("tax_cents", { mode: "number" }).notNull().default(0),
    totalCents: bigint("total_cents", { mode: "number" }).notNull().default(0),
    /** Σ non-archived payments, kept in the same transaction as each payment change. */
    amountPaidCents: bigint("amount_paid_cents", { mode: "number" }).notNull().default(0),
    /** Memo to the client, printed on the PDF. */
    memo: text("memo"),
    /** Who the email went to. */
    sentTo: text("sent_to").array(),
    /** Print the "Time detail" appendix. */
    includeTimeDetail: boolean("include_time_detail").notNull().default(true),
    quickbooksInvoiceId: text("quickbooks_invoice_id"),
    /** Storage key of the sent PDF (private bucket; served through signed URLs). */
    pdfUrl: text("pdf_url"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: uuid("voided_by").references(() => users.id),
    voidReason: text("void_reason"),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
    archivedAt: archivedAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique("invoices_firm_id_id_unique").on(t.firmId, t.id),
    // Numbers are unique per firm forever, archived or not (rule 1).
    uniqueIndex("invoices_firm_number_unique").on(t.firmId, t.number).where(sql`${t.number} is not null`),
    // One open draft per project (rule 12).
    uniqueIndex("invoices_one_open_draft")
      .on(t.projectId)
      .where(sql`${t.status} in ('draft', 'in_review') and ${t.archivedAt} is null`),
    index("invoices_project_idx").on(t.firmId, t.projectId),
    index("invoices_status_idx").on(t.firmId, t.status, t.dueDate),
    foreignKey({
      name: "invoices_project_same_firm_fk",
      columns: [t.firmId, t.projectId],
      foreignColumns: [projects.firmId, projects.id],
    }),
    foreignKey({
      name: "invoices_client_same_firm_fk",
      columns: [t.firmId, t.clientCompanyId],
      foreignColumns: [companies.firmId, companies.id],
    }),
    foreignKey({
      name: "invoices_bill_to_same_firm_fk",
      columns: [t.firmId, t.billToContactId],
      foreignColumns: [contacts.firmId, contacts.id],
    }),
    check("invoices_number_when_sent", sql`${t.status} in ('draft', 'in_review') or ${t.number} is not null`),
    check("invoices_void_reason", sql`${t.status} <> 'void' or ${t.voidReason} is not null`),
    check("invoices_paid_range", sql`${t.amountPaidCents} >= 0 and ${t.amountPaidCents} <= greatest(${t.totalCents}, 0)`),
    check("invoices_tax_nonneg", sql`${t.taxCents} >= 0`),
    check("invoices_total_adds_up", sql`${t.totalCents} = ${t.subtotalCents} + ${t.taxCents}`),
    check("invoices_due_after_issue", sql`${t.dueDate} >= ${t.issueDate}`),
    check("invoices_period_in_order", sql`${t.periodStart} is null or ${t.periodEnd} >= ${t.periodStart}`),
    check("invoices_memo_length", sql`${t.memo} is null or char_length(${t.memo}) <= 2000`),
  ],
);

/**
 * A line on an invoice. Fee, prior-billed and consultant figures are
 * snapshots, so a sent invoice reads the same even if the project changes.
 */
export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: id(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    invoiceId: uuid("invoice_id").notNull(),
    projectPhaseId: uuid("project_phase_id"),
    lineType: invoiceLineType("line_type").notNull(),
    description: text("description").notNull(),
    /** Hours on hourly lines, 1 otherwise. */
    quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull().default("1"),
    rateCents: bigint("rate_cents", { mode: "number" }).notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    /** Fixed-fee lines: the % complete billed to. 3025 = 30.25%. */
    percentCompleteBp: integer("percent_complete_bp"),
    sortOrder: smallint("sort_order").notNull().default(0),
    /** Fixed-fee lines: the phase fee when this was built. */
    phaseFeeCents: bigint("phase_fee_cents", { mode: "number" }),
    /** Fixed-fee lines: previously billed when this was built. */
    priorBilledCents: bigint("prior_billed_cents", { mode: "number" }),
    consultantId: uuid("consultant_id"),
    /** Consultant lines: their bill to us. */
    costCents: bigint("cost_cents", { mode: "number" }),
    /** Consultant lines: the markup applied. 1000 = 10%. */
    markupBp: integer("markup_bp"),
    /** Consultant lines: their invoice number. */
    vendorInvoiceRef: text("vendor_invoice_ref"),
    ...timestamps,
    archivedAt: archivedAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    index("invoice_lines_invoice_idx").on(t.firmId, t.invoiceId, t.sortOrder),
    index("invoice_lines_phase_idx").on(t.firmId, t.projectPhaseId),
    foreignKey({
      name: "invoice_lines_invoice_same_firm_fk",
      columns: [t.firmId, t.invoiceId],
      foreignColumns: [invoices.firmId, invoices.id],
    }),
    foreignKey({
      name: "invoice_lines_phase_same_firm_fk",
      columns: [t.firmId, t.projectPhaseId],
      foreignColumns: [projectPhases.firmId, projectPhases.id],
    }),
    foreignKey({
      name: "invoice_lines_consultant_same_firm_fk",
      columns: [t.firmId, t.consultantId],
      foreignColumns: [consultants.firmId, consultants.id],
    }),
    check(
      "invoice_lines_percent_range",
      sql`${t.percentCompleteBp} is null or ${t.percentCompleteBp} between 0 and 10000`,
    ),
    check("invoice_lines_markup_range", sql`${t.markupBp} is null or ${t.markupBp} between 0 and 10000`),
    check("invoice_lines_cost_nonneg", sql`${t.costCents} is null or ${t.costCents} >= 0`),
    check("invoice_lines_description", sql`char_length(trim(${t.description})) between 1 and 500`),
    check("invoice_lines_phase_fee_has_phase", sql`${t.lineType} <> 'phase_fee' or ${t.projectPhaseId} is not null`),
    check("invoice_lines_consultant_has_consultant", sql`${t.lineType} <> 'consultant' or ${t.consultantId} is not null`),
  ],
);

/** Money received against an invoice. Deleting one sets archived_at. */
export const payments = pgTable(
  "payments",
  {
    id: id(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    invoiceId: uuid("invoice_id").notNull(),
    receivedOn: date("received_on").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    method: paymentMethod("method").notNull(),
    /** Check number, ACH trace, etc. */
    reference: text("reference"),
    quickbooksPaymentId: text("quickbooks_payment_id"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
    archivedAt: archivedAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    index("payments_invoice_idx").on(t.firmId, t.invoiceId),
    index("payments_received_idx").on(t.firmId, t.receivedOn),
    foreignKey({
      name: "payments_invoice_same_firm_fk",
      columns: [t.firmId, t.invoiceId],
      foreignColumns: [invoices.firmId, invoices.id],
    }),
    check("payments_amount_positive", sql`${t.amountCents} > 0`),
    check("payments_reference_length", sql`${t.reference} is null or char_length(${t.reference}) <= 100`),
  ],
);
