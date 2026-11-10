import { sql } from "drizzle-orm";
import {
  type PgTableExtraConfigValue,
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
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
import { timesheetRowType, timesheetStatus } from "./enums";
import { activities, overheadCategories } from "./firm-setup";
import { firms } from "./firms";
import { memberships, users } from "./people";
import { projectPhases, projects } from "./projects";

// Timesheets (timesheet spec, milestone 1.6). One timesheet per person per
// week; rows are what the person picked (project phase + activity, overhead
// or leave); entries are the hours, one per row per day. Every link stays
// inside one firm (composite keys).

/** One per person per week. Created on the first write for that week. */
export const timesheets = pgTable(
  "timesheets",
  {
    id: id(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    membershipId: uuid("membership_id").notNull(),
    /** The firm's week-start day (firm_settings.week_starts_on). */
    weekStart: date("week_start").notNull(),
    status: timesheetStatus("status").notNull().default("draft"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    // Who reviews it lives in timesheet_review_steps (1.7 A, decision #23).
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectedBy: uuid("rejected_by").references(() => users.id),
    rejectionNote: text("rejection_note"),
    ...timestamps,
  },
  (t): PgTableExtraConfigValue[] => [
    unique("timesheets_firm_id_id_unique").on(t.firmId, t.id),
    unique("timesheets_membership_week_unique").on(t.membershipId, t.weekStart),
    index("timesheets_firm_week_idx").on(t.firmId, t.weekStart),
    foreignKey({
      name: "timesheets_membership_same_firm_fk",
      columns: [t.firmId, t.membershipId],
      foreignColumns: [memberships.firmId, memberships.id],
    }),
  ],
);

/**
 * A line on the weekly grid. Exists before it has hours ("Add row", "Copy
 * last week"). An unset row has row_type null and no selection.
 */
export const timesheetRows = pgTable(
  "timesheet_rows",
  {
    id: id(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    timesheetId: uuid("timesheet_id").notNull(),
    sortOrder: smallint("sort_order").notNull().default(0),
    rowType: timesheetRowType("row_type"),
    projectId: uuid("project_id"),
    projectPhaseId: uuid("project_phase_id"),
    /** Overhead phase or leave category. */
    overheadCategoryId: uuid("overhead_category_id"),
    activityId: uuid("activity_id"),
    billable: boolean("billable").notNull().default(false),
    ...timestamps,
    archivedAt: archivedAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique("timesheet_rows_firm_id_id_unique").on(t.firmId, t.id),
    index("timesheet_rows_timesheet_idx").on(t.firmId, t.timesheetId, t.sortOrder),
    foreignKey({
      name: "timesheet_rows_timesheet_same_firm_fk",
      columns: [t.firmId, t.timesheetId],
      foreignColumns: [timesheets.firmId, timesheets.id],
    }),
    foreignKey({
      name: "timesheet_rows_project_same_firm_fk",
      columns: [t.firmId, t.projectId],
      foreignColumns: [projects.firmId, projects.id],
    }),
    foreignKey({
      name: "timesheet_rows_phase_same_firm_fk",
      columns: [t.firmId, t.projectPhaseId],
      foreignColumns: [projectPhases.firmId, projectPhases.id],
    }),
    foreignKey({
      name: "timesheet_rows_category_same_firm_fk",
      columns: [t.firmId, t.overheadCategoryId],
      foreignColumns: [overheadCategories.firmId, overheadCategories.id],
    }),
    foreignKey({
      name: "timesheet_rows_activity_same_firm_fk",
      columns: [t.firmId, t.activityId],
      foreignColumns: [activities.firmId, activities.id],
    }),
    // What each row type may point at (rule 3). Completeness is checked at submit.
    check(
      "timesheet_rows_type_links",
      sql`case ${t.rowType}
        when 'project' then ${t.overheadCategoryId} is null
        when 'overhead' then ${t.projectId} is null and ${t.projectPhaseId} is null
        when 'leave' then ${t.projectId} is null and ${t.projectPhaseId} is null
        else ${t.projectId} is null and ${t.projectPhaseId} is null and ${t.overheadCategoryId} is null and ${t.activityId} is null
      end`,
    ),
    check("timesheet_rows_billable_project_only", sql`not ${t.billable} or ${t.rowType} = 'project'`),
  ],
);

/**
 * Hours: one per row per day. Copies the row's selection so reports read
 * this table alone. While a timesheet is a draft, phase and activity may be
 * empty (decision #19); submit enforces completeness. Rates stay null until
 * approval (1.7) freezes them.
 */
export const timeEntries = pgTable(
  "time_entries",
  {
    id: id(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    timesheetId: uuid("timesheet_id").notNull(),
    timesheetRowId: uuid("timesheet_row_id").notNull(),
    workDate: date("work_date").notNull(),
    projectId: uuid("project_id"),
    projectPhaseId: uuid("project_phase_id"),
    overheadCategoryId: uuid("overhead_category_id"),
    activityId: uuid("activity_id"),
    hours: numeric("hours", { precision: 5, scale: 2 }).notNull(),
    note: text("note"),
    billable: boolean("billable").notNull().default(false),
    /** Frozen on approval (1.7) from the rate lookup. Owner/admin only. */
    billRateCents: bigint("bill_rate_cents", { mode: "number" }),
    costRateCents: bigint("cost_rate_cents", { mode: "number" }),
    ...timestamps,
    archivedAt: archivedAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    uniqueIndex("time_entries_row_day_unique")
      .on(t.timesheetRowId, t.workDate)
      .where(sql`${t.archivedAt} is null`),
    index("time_entries_timesheet_idx").on(t.firmId, t.timesheetId),
    index("time_entries_phase_idx").on(t.firmId, t.projectPhaseId),
    index("time_entries_project_idx").on(t.firmId, t.projectId),
    foreignKey({
      name: "time_entries_timesheet_same_firm_fk",
      columns: [t.firmId, t.timesheetId],
      foreignColumns: [timesheets.firmId, timesheets.id],
    }),
    foreignKey({
      name: "time_entries_row_same_firm_fk",
      columns: [t.firmId, t.timesheetRowId],
      foreignColumns: [timesheetRows.firmId, timesheetRows.id],
    }),
    foreignKey({
      name: "time_entries_project_same_firm_fk",
      columns: [t.firmId, t.projectId],
      foreignColumns: [projects.firmId, projects.id],
    }),
    foreignKey({
      name: "time_entries_phase_same_firm_fk",
      columns: [t.firmId, t.projectPhaseId],
      foreignColumns: [projectPhases.firmId, projectPhases.id],
    }),
    foreignKey({
      name: "time_entries_category_same_firm_fk",
      columns: [t.firmId, t.overheadCategoryId],
      foreignColumns: [overheadCategories.firmId, overheadCategories.id],
    }),
    foreignKey({
      name: "time_entries_activity_same_firm_fk",
      columns: [t.firmId, t.activityId],
      foreignColumns: [activities.firmId, activities.id],
    }),
    check("time_entries_not_phase_and_category", sql`${t.projectPhaseId} is null or ${t.overheadCategoryId} is null`),
    check("time_entries_project_xor_category", sql`${t.projectId} is null or ${t.overheadCategoryId} is null`),
    // > 0, ≤ 24, in quarter hours (rule 6).
    check(
      "time_entries_hours_range",
      sql`${t.hours} > 0 and ${t.hours} <= 24 and (${t.hours} * 4) = trunc(${t.hours} * 4)`,
    ),
    check("time_entries_note_length", sql`${t.note} is null or char_length(${t.note}) <= 500`),
    check("time_entries_billable_project_only", sql`not ${t.billable} or ${t.projectId} is not null`),
  ],
);
