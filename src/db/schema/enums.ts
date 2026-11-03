import { pgEnum } from "drizzle-orm/pg-core";

/** What a person can do inside a firm. Checked on the server by `can()` (milestone 0.3). */
export const appRole = pgEnum("app_role", [
  "owner",
  "admin",
  "project_manager",
  "staff",
]);

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
