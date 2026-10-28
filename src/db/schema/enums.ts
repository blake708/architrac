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
