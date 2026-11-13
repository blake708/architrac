import { pgEnum } from "drizzle-orm/pg-core";

/** What a person can do inside a firm. Checked on the server by `can()` (milestone 0.3). */
export const appRole = pgEnum("app_role", [
  "owner",
  "admin",
  "project_manager",
  "staff",
]);

/** How a person is paid: an annual salary or an hourly wage. */
export const payType = pgEnum("pay_type", ["salary", "hourly"]);

export const employmentType = pgEnum("employment_type", [
  "full_time",
  "part_time",
  "contract",
]);

/** Where an invitation is (settings-firm spec, business rule 8). */
export const invitationStatus = pgEnum("invitation_status", [
  "pending",
  "accepted",
  "revoked",
  "expired",
]);

/** How a phase is billed (DATA_MODEL → project_phases.fee_type). */
export const feeType = pgEnum("fee_type", ["fixed", "hourly", "nte"]);

/** Which timesheet rows an activity is offered on (DATA_MODEL → activities). */
export const activityScope = pgEnum("activity_scope", ["project", "overhead"]);

/** What a company is to the firm (contacts spec; `agency` added in 1.2). */
export const companyKind = pgEnum("company_kind", [
  "client",
  "consultant",
  "contractor",
  "agency",
  "vendor",
  "other",
]);

/** Where a project is (DATA_MODEL → projects.status). */
export const projectStatus = pgEnum("project_status", [
  "pursuit",
  "active",
  "on_hold",
  "closed",
]);

/** Where a phase is. `closed` = no new time. */
export const phaseStatus = pgEnum("phase_status", [
  "upcoming",
  "current",
  "complete",
  "closed",
]);

/** Kind of building work, shown under the project type (1.4). */
export const scopeKind = pgEnum("scope_kind", ["ground_up", "tenant_upfit", "shell"]);

/**
 * Where a timesheet is: submitted = in review (who it waits on is in
 * timesheet_review_steps, 1.7 A); rejected = returned.
 */
export const timesheetStatus = pgEnum("timesheet_status", ["draft", "submitted", "approved", "rejected"]);

/**
 * A step on the firm's review route (decision #23): every Principal in
 * Charge of a project on the sheet, the team leader, any one principal, or a
 * named person.
 */
export const reviewStepKind = pgEnum("review_step_kind", [
  "principal_in_charge",
  "team_leader",
  "any_principal",
  "person",
]);

/** One required approval on a sheet's review. */
export const reviewRowStatus = pgEnum("review_row_status", ["waiting", "approved", "skipped"]);

/** What a timesheet row is for. Null on a row nobody has picked yet. */
export const timesheetRowType = pgEnum("timesheet_row_type", ["project", "overhead", "leave"]);

/**
 * When billable time needs a note before submit (decisions #17, #24):
 * never, only on hourly and not-to-exceed phases, or on all billable time.
 */
export const timesheetNotesRule = pgEnum("timesheet_notes_rule", ["optional", "hourly", "all"]);

/**
 * Where an invoice is (invoicing spec). in_review = a PM submitted it for an
 * owner/admin to send. written_off arrives with Accounting (Release 2).
 */
export const invoiceStatus = pgEnum("invoice_status", [
  "draft",
  "in_review",
  "sent",
  "partially_paid",
  "paid",
  "void",
  "written_off",
]);

/** What an invoice line bills. expense arrives in Release 2. */
export const invoiceLineType = pgEnum("invoice_line_type", ["phase_fee", "hourly", "consultant", "expense", "adjustment"]);

/** How a payment came in. */
export const paymentMethod = pgEnum("payment_method", ["check", "ach", "card", "other"]);
