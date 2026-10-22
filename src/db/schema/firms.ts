import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgTable,
  smallint,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { archivedAt, id, timestamps } from "./columns";

/** One row per firm (one Clerk organization). */
export const firms = pgTable(
  "firms",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    clerkOrgId: text("clerk_org_id").notNull().unique(),
    logoUrl: text("logo_url"),
    timezone: text("timezone").notNull().default("America/New_York"),
    fiscalYearStartMonth: smallint("fiscal_year_start_month")
      .notNull()
      .default(1),
    ...timestamps,
    archivedAt: archivedAt(),
  },
  (t) => [
    check(
      "firms_fiscal_year_start_month_range",
      sql`${t.fiscalYearStartMonth} between 1 and 12`,
    ),
  ],
);

/** Firm-wide settings. Exactly one row per firm. */
export const firmSettings = pgTable(
  "firm_settings",
  {
    firmId: uuid("firm_id")
      .primaryKey()
      .references(() => firms.id),
    overheadRateBp: integer("overhead_rate_bp").notNull().default(6000),
    includeOverheadDefault: boolean("include_overhead_default")
      .notNull()
      .default(true),
    /** 0 = Sunday, 1 = Monday */
    weekStartsOn: smallint("week_starts_on").notNull().default(1),
    timesheetIncrementMinutes: smallint("timesheet_increment_minutes")
      .notNull()
      .default(15),
    /** Day of week timesheets are due (0 = Sunday). */
    timesheetLockDay: smallint("timesheet_lock_day").notNull().default(1),
    invoicePrefix: text("invoice_prefix").notNull().default(""),
    nextInvoiceNumber: integer("next_invoice_number").notNull().default(1),
    defaultPaymentTermsDays: smallint("default_payment_terms_days")
      .notNull()
      .default(30),
    /** Add-on modules switched on. New firms start with none. */
    modulesEnabled: text("modules_enabled")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ...timestamps,
  },
  (t) => [
    check(
      "firm_settings_week_starts_on_range",
      sql`${t.weekStartsOn} between 0 and 6`,
    ),
    check(
      "firm_settings_timesheet_lock_day_range",
      sql`${t.timesheetLockDay} between 0 and 6`,
    ),
    check("firm_settings_overhead_rate_bp_min", sql`${t.overheadRateBp} >= 0`),
  ],
);
