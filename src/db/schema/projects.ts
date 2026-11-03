import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  type PgTableExtraConfigValue,
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { archivedAt, id, timestamps } from "./columns";
import { companies, contacts } from "./contacts";
import { feeType, phaseStatus, projectStatus, scopeKind } from "./enums";
import { firms } from "./firms";
import { memberships, users } from "./people";

// Projects and their phases (projects-list spec, milestone 1.4). Every link
// stays inside one firm (composite keys), so Firm A can never point at
// Firm B's client, contact or people.

export const projects = pgTable(
  "projects",
  {
    id: id(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    /** The firm's project number: "2026-014". Unique per firm, ignoring case. */
    number: text("number").notNull(),
    name: text("name").notNull(),
    clientCompanyId: uuid("client_company_id").notNull(),
    clientContactId: uuid("client_contact_id"),
    status: projectStatus("status").notNull().default("active"),
    /** "Medical office", "Restaurant", "Retail", "Office" or the firm's own. */
    projectType: text("project_type").notNull(),
    /** Ground-up / Tenant upfit / Shell building (shown under the type). */
    scopeKind: scopeKind("scope_kind"),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    state: text("state"),
    postalCode: text("postal_code"),
    squareFeet: integer("square_feet"),
    constructionCostCents: bigint("construction_cost_cents", { mode: "number" }),
    principalMembershipId: uuid("principal_membership_id").notNull(),
    pmMembershipId: uuid("pm_membership_id").notNull(),
    startDate: date("start_date"),
    targetEndDate: date("target_end_date"),
    /** Set when the status becomes closed ("closed this year", reports). */
    closedOn: date("closed_on"),
    /** QuickBooks sub-customer / job (1.9). */
    quickbooksCustomerId: text("quickbooks_customer_id"),
    createdBy: uuid("created_by").references((): AnyPgColumn => users.id),
    ...timestamps,
    archivedAt: archivedAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique("projects_firm_id_id_unique").on(t.firmId, t.id),
    uniqueIndex("projects_firm_number_unique").on(t.firmId, sql`lower(${t.number})`),
    index("projects_firm_client_idx").on(t.firmId, t.clientCompanyId),
    foreignKey({
      name: "projects_client_same_firm_fk",
      columns: [t.firmId, t.clientCompanyId],
      foreignColumns: [companies.firmId, companies.id],
    }),
    foreignKey({
      name: "projects_client_contact_same_firm_fk",
      columns: [t.firmId, t.clientContactId],
      foreignColumns: [contacts.firmId, contacts.id],
    }),
    foreignKey({
      name: "projects_principal_same_firm_fk",
      columns: [t.firmId, t.principalMembershipId],
      foreignColumns: [memberships.firmId, memberships.id],
    }),
    foreignKey({
      name: "projects_pm_same_firm_fk",
      columns: [t.firmId, t.pmMembershipId],
      foreignColumns: [memberships.firmId, memberships.id],
    }),
    check("projects_square_feet_positive", sql`${t.squareFeet} is null or ${t.squareFeet} > 0`),
    check(
      "projects_construction_cost_nonneg",
      sql`${t.constructionCostCents} is null or ${t.constructionCostCents} >= 0`,
    ),
    check(
      "projects_dates_in_order",
      sql`${t.startDate} is null or ${t.targetEndDate} is null or ${t.targetEndDate} >= ${t.startDate}`,
    ),
  ],
);

/** The backbone: time, budgets, invoices and the snapshot all hang off this. */
export const projectPhases = pgTable(
  "project_phases",
  {
    id: id(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    projectId: uuid("project_id").notNull(),
    /** Copied from the template, editable. */
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** Copied from the template's description, editable. */
    description: text("description"),
    sortOrder: smallint("sort_order").notNull(),
    feeType: feeType("fee_type").notNull(),
    /** fixed: the fee; nte: the cap; hourly: an estimate (may be 0). */
    feeCents: bigint("fee_cents", { mode: "number" }).notNull().default(0),
    budgetHours: numeric("budget_hours", { precision: 8, scale: 2 }).notNull().default("0"),
    status: phaseStatus("status").notNull().default("upcoming"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    /** For fixed-fee billing; the PM sets it. 2500 = 25%. */
    percentCompleteBp: integer("percent_complete_bp").notNull().default(0),
    ...timestamps,
    archivedAt: archivedAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique("project_phases_firm_id_id_unique").on(t.firmId, t.id),
    index("project_phases_project_idx").on(t.firmId, t.projectId, t.sortOrder),
    foreignKey({
      name: "project_phases_project_same_firm_fk",
      columns: [t.firmId, t.projectId],
      foreignColumns: [projects.firmId, projects.id],
    }),
    check("project_phases_fee_nonneg", sql`${t.feeCents} >= 0`),
    check("project_phases_hours_nonneg", sql`${t.budgetHours} >= 0`),
    check("project_phases_pct_range", sql`${t.percentCompleteBp} between 0 and 10000`),
  ],
);

/** Who is on a project's team. */
export const projectMembers = pgTable(
  "project_members",
  {
    id: id(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    projectId: uuid("project_id").notNull(),
    membershipId: uuid("membership_id").notNull(),
    /** "PM", "Principal", "PA", "Designer". */
    projectRole: text("project_role").notNull(),
    billRateOverrideCents: bigint("bill_rate_override_cents", { mode: "number" }),
    ...timestamps,
    archivedAt: archivedAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    uniqueIndex("project_members_one_active")
      .on(t.projectId, t.membershipId)
      .where(sql`${t.archivedAt} is null`),
    index("project_members_membership_idx").on(t.firmId, t.membershipId),
    foreignKey({
      name: "project_members_project_same_firm_fk",
      columns: [t.firmId, t.projectId],
      foreignColumns: [projects.firmId, projects.id],
    }),
    foreignKey({
      name: "project_members_membership_same_firm_fk",
      columns: [t.firmId, t.membershipId],
      foreignColumns: [memberships.firmId, memberships.id],
    }),
  ],
);

/**
 * Contractors, agencies and vendors on a project (contacts spec, decision 6).
 * Consultants use their own table (1.5), which also carries fees.
 */
export const projectContacts = pgTable(
  "project_contacts",
  {
    id: id(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    projectId: uuid("project_id").notNull(),
    companyId: uuid("company_id").notNull(),
    contactId: uuid("contact_id"),
    /** "General contractor", "Plan review", "Surveyor". */
    role: text("role"),
    ...timestamps,
    archivedAt: archivedAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    index("project_contacts_company_idx").on(t.firmId, t.companyId),
    index("project_contacts_project_idx").on(t.firmId, t.projectId),
    foreignKey({
      name: "project_contacts_project_same_firm_fk",
      columns: [t.firmId, t.projectId],
      foreignColumns: [projects.firmId, projects.id],
    }),
    foreignKey({
      name: "project_contacts_company_same_firm_fk",
      columns: [t.firmId, t.companyId],
      foreignColumns: [companies.firmId, companies.id],
    }),
    foreignKey({
      name: "project_contacts_contact_same_firm_fk",
      columns: [t.firmId, t.contactId],
      foreignColumns: [contacts.firmId, contacts.id],
    }),
  ],
);
