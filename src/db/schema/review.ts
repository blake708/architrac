import { sql } from "drizzle-orm";
import {
  type PgTableExtraConfigValue,
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { archivedAt, id, timestamps } from "./columns";
import { reviewRowStatus, reviewStepKind } from "./enums";
import { firms } from "./firms";
import { memberships, users } from "./people";
import { timesheets } from "./time";

// Timesheet review (timesheet-approval spec, milestone 1.7 A, decision #23).
// review_steps is the firm's route; timesheet_review_steps is one sheet's
// copy of it, made at submit so later changes never move a waiting sheet.

/** The firm's review route: one or more ordered steps. */
export const reviewSteps = pgTable(
  "review_steps",
  {
    id: id(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    sortOrder: smallint("sort_order").notNull().default(0),
    kind: reviewStepKind("kind").notNull(),
    /** The named person, only for kind = person. */
    membershipId: uuid("membership_id"),
    ...timestamps,
    archivedAt: archivedAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique("review_steps_firm_id_id_unique").on(t.firmId, t.id),
    index("review_steps_firm_order_idx").on(t.firmId, t.sortOrder),
    // Each non-person kind once; each named person once.
    uniqueIndex("review_steps_kind_unique")
      .on(t.firmId, t.kind)
      .where(sql`${t.archivedAt} is null and ${t.kind} <> 'person'`),
    uniqueIndex("review_steps_person_unique")
      .on(t.firmId, t.membershipId)
      .where(sql`${t.archivedAt} is null and ${t.kind} = 'person'`),
    foreignKey({
      name: "review_steps_membership_same_firm_fk",
      columns: [t.firmId, t.membershipId],
      foreignColumns: [memberships.firmId, memberships.id],
    }),
    check("review_steps_person_has_member", sql`(${t.kind} = 'person') = (${t.membershipId} is not null)`),
  ],
);

/**
 * One sheet's review: one row per required approver per step. Two Principals
 * in Charge = two rows on that step; any_principal = one row with no
 * approver until a principal acts; a skipped step = one skipped row.
 */
export const timesheetReviewSteps = pgTable(
  "timesheet_review_steps",
  {
    id: id(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    timesheetId: uuid("timesheet_id").notNull(),
    stepNo: smallint("step_no").notNull(),
    kind: reviewStepKind("kind").notNull(),
    approverMembershipId: uuid("approver_membership_id"),
    status: reviewRowStatus("status").notNull().default("waiting"),
    /** no_team, no_projects, is_submitter, inactive, already_reviewing, principal_already_approved */
    skipReason: text("skip_reason"),
    actedBy: uuid("acted_by").references(() => users.id),
    actedAt: timestamp("acted_at", { withTimezone: true }),
    /** An owner/admin approved for the approver (rule 3f, 1.7 B). */
    onBehalf: boolean("on_behalf").notNull().default(false),
    ...timestamps,
    /** Set on Recall and Return; the next submit builds a new review. */
    archivedAt: archivedAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    index("timesheet_review_steps_sheet_idx").on(t.firmId, t.timesheetId, t.stepNo),
    index("timesheet_review_steps_approver_idx")
      .on(t.firmId, t.approverMembershipId)
      .where(sql`${t.archivedAt} is null and ${t.status} = 'waiting'`),
    foreignKey({
      name: "timesheet_review_steps_sheet_same_firm_fk",
      columns: [t.firmId, t.timesheetId],
      foreignColumns: [timesheets.firmId, timesheets.id],
    }),
    foreignKey({
      name: "timesheet_review_steps_approver_same_firm_fk",
      columns: [t.firmId, t.approverMembershipId],
      foreignColumns: [memberships.firmId, memberships.id],
    }),
    check("timesheet_review_steps_skip_reason", sql`(${t.status} = 'skipped') = (${t.skipReason} is not null)`),
    check("timesheet_review_steps_acted", sql`(${t.status} = 'approved') = (${t.actedAt} is not null)`),
  ],
);
