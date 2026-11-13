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
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { archivedAt, id, timestamps } from "./columns";
import { activityScope, feeType, payType, scopeKind } from "./enums";
import { firms } from "./firms";
import { firmRoles, memberships, users } from "./people";

// The firm's setup lists (settings-rates-phases spec, milestone 1.1):
// rates, phase templates, overhead categories and timesheet activities.

/**
 * Hourly bill and cost rates, effective-dated so old time keeps the rate in
 * force when it was worked. A role's rows never overlap in time (exclusion
 * constraint in migration 0003).
 */
export const rates = pgTable(
  "rates",
  {
    id: id(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    /** The role's default rate. Exactly one of role / membership is set. */
    firmRoleId: uuid("firm_role_id"),
    /** A per-person override (Team spec, later in Release 1). */
    membershipId: uuid("membership_id"),
    /** What clients pay per hour. 0 for roles that aren't billable. */
    billRateCents: bigint("bill_rate_cents", { mode: "number" }).notNull(),
    /** Salary plus burden per hour. Owner/admin only. */
    costRateCents: bigint("cost_rate_cents", { mode: "number" }).notNull(),
    effectiveFrom: date("effective_from").notNull(),
    /** Last day this rate applies. Null = still current. */
    effectiveTo: date("effective_to"),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t): PgTableExtraConfigValue[] => [
    index("rates_firm_role_idx").on(t.firmId, t.firmRoleId),
    foreignKey({
      name: "rates_firm_role_same_firm_fk",
      columns: [t.firmId, t.firmRoleId],
      foreignColumns: [firmRoles.firmId, firmRoles.id],
    }),
    foreignKey({
      name: "rates_membership_same_firm_fk",
      columns: [t.firmId, t.membershipId],
      foreignColumns: [memberships.firmId, memberships.id],
    }),
    check(
      "rates_role_xor_membership",
      sql`(${t.firmRoleId} is null) <> (${t.membershipId} is null)`,
    ),
    check(
      "rates_amounts_min",
      sql`${t.billRateCents} >= 0 and ${t.costRateCents} >= 0`,
    ),
    check(
      "rates_dates_order",
      sql`${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`,
    ),
  ],
);

/**
 * What a person is paid, effective-dated like rates. Their hourly cost is
 * worked out from it (src/lib/calc/pay.ts) and replaces their role's cost
 * rate. A person's periods never overlap (migration 0022). Owner/admin only.
 */
export const membershipPay = pgTable(
  "membership_pay",
  {
    id: id(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    membershipId: uuid("membership_id").notNull(),
    payType: payType("pay_type").notNull(),
    /** Annual salary (salary) or hourly wage (hourly). */
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    /** Taxes and benefits on top of pay, 2500 = 25%. */
    burdenBp: integer("burden_bp").notNull().default(0),
    effectiveFrom: date("effective_from").notNull(),
    /** Last day this pay applies. Null = still current. */
    effectiveTo: date("effective_to"),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t): PgTableExtraConfigValue[] => [
    index("membership_pay_membership_idx").on(t.firmId, t.membershipId),
    foreignKey({
      name: "membership_pay_membership_same_firm_fk",
      columns: [t.firmId, t.membershipId],
      foreignColumns: [memberships.firmId, memberships.id],
    }),
    check("membership_pay_amount_min", sql`${t.amountCents} >= 0`),
    check("membership_pay_burden_range", sql`${t.burdenBp} between 0 and 20000`),
    check(
      "membership_pay_dates_order",
      sql`${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`,
    ),
  ],
);

/**
 * The firm's standard phases. Default phases (is_optional = false) are copied
 * to every new project and their shares add up to 100%. Optional phases are
 * offered when adding a phase to a project and have no share.
 */
export const phaseTemplates = pgTable(
  "phase_templates",
  {
    id: id(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    /** Abbreviation, e.g. "SD". */
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** Copied to the project's phase when it's created; editable there. */
    description: text("description"),
    isOptional: boolean("is_optional").notNull().default(false),
    defaultFeeType: feeType("default_fee_type").notNull().default("fixed"),
    /** Share of the project fee, 1500 = 15%. Always 0 for optional phases. */
    defaultFeeShareBp: integer("default_fee_share_bp").notNull().default(0),
    /** Order within its own list (default or optional). */
    sortOrder: smallint("sort_order").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
    archivedAt: archivedAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique("phase_templates_firm_id_id_unique").on(t.firmId, t.id),
    // Codes and names are unique (ignoring case) across both lists.
    uniqueIndex("phase_templates_code_unique")
      .on(t.firmId, sql`lower(${t.code})`)
      .where(sql`${t.archivedAt} is null`),
    uniqueIndex("phase_templates_name_unique")
      .on(t.firmId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} is null`),
    check(
      "phase_templates_share_range",
      sql`${t.defaultFeeShareBp} between 0 and 10000`,
    ),
    check(
      "phase_templates_optional_no_share",
      sql`not ${t.isOptional} or ${t.defaultFeeShareBp} = 0`,
    ),
  ],
);

/**
 * Non-project "phases" on timesheets: overhead (Marketing, Administration…)
 * and leave (PTO, Holiday). Removing one sets active = false; old time keeps
 * pointing at it.
 */
export const overheadCategories = pgTable(
  "overhead_categories",
  {
    id: id(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    /** Set for the leave categories the app needs to find: "PTO", "HOL". */
    code: text("code"),
    name: text("name").notNull(),
    isLeave: boolean("is_leave").notNull().default(false),
    sortOrder: smallint("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t): PgTableExtraConfigValue[] => [
    unique("overhead_categories_firm_id_id_unique").on(t.firmId, t.id),
    uniqueIndex("overhead_categories_code_unique")
      .on(t.firmId, t.code)
      .where(sql`${t.code} is not null`),
  ],
);

/**
 * What a person picks on a timesheet row: project activities (any project
 * phase) or the activities of one overhead category.
 */
export const activities = pgTable(
  "activities",
  {
    id: id(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    name: text("name").notNull(),
    appliesTo: activityScope("applies_to").notNull(),
    /** Set for overhead and leave activities: which category they're in. */
    overheadCategoryId: uuid("overhead_category_id"),
    sortOrder: smallint("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t): PgTableExtraConfigValue[] => [
    unique("activities_firm_id_id_unique").on(t.firmId, t.id),
    index("activities_firm_category_idx").on(t.firmId, t.overheadCategoryId),
    foreignKey({
      name: "activities_category_same_firm_fk",
      columns: [t.firmId, t.overheadCategoryId],
      foreignColumns: [overheadCategories.firmId, overheadCategories.id],
    }),
    check(
      "activities_scope_category",
      sql`(${t.appliesTo} = 'overhead') = (${t.overheadCategoryId} is not null)`,
    ),
  ],
);

/**
 * Construction cost per SF and fee % ranges per project type (and optionally
 * scope), typed in Settings → Phases. New project's estimate uses them when
 * the firm has fewer than 3 similar past projects (Blake, 2026-11-04).
 * Null scope = any scope.
 */
export const projectTypeBenchmarks = pgTable(
  "project_type_benchmarks",
  {
    id: id(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    projectType: text("project_type").notNull(),
    scopeKind: scopeKind("scope_kind"),
    costPerSfLowCents: bigint("cost_per_sf_low_cents", { mode: "number" }).notNull(),
    costPerSfHighCents: bigint("cost_per_sf_high_cents", { mode: "number" }).notNull(),
    /** Architectural fee as a share of construction cost, 300 = 3%. */
    feeLowBp: integer("fee_low_bp").notNull(),
    feeHighBp: integer("fee_high_bp").notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
    archivedAt: archivedAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    // One active range per type for "any scope", and one per type + scope.
    uniqueIndex("project_type_benchmarks_any_scope_unique")
      .on(t.firmId, sql`lower(${t.projectType})`)
      .where(sql`${t.archivedAt} is null and ${t.scopeKind} is null`),
    uniqueIndex("project_type_benchmarks_scope_unique")
      .on(t.firmId, sql`lower(${t.projectType})`, t.scopeKind)
      .where(sql`${t.archivedAt} is null and ${t.scopeKind} is not null`),
    check(
      "project_type_benchmarks_cost_range",
      sql`${t.costPerSfLowCents} > 0 and ${t.costPerSfHighCents} >= ${t.costPerSfLowCents}`,
    ),
    check(
      "project_type_benchmarks_fee_range",
      sql`${t.feeLowBp} > 0 and ${t.feeHighBp} >= ${t.feeLowBp} and ${t.feeHighBp} <= 10000`,
    ),
  ],
);
