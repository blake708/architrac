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
