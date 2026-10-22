import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  type PgTableExtraConfigValue,
  boolean,
  check,
  foreignKey,
  integer,
  numeric,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { archivedAt, citext, id, timestamps } from "./columns";
import { appRole, employmentType } from "./enums";
import { firms } from "./firms";

// users, memberships and teams live in one file because memberships and
// teams point at each other (a member's team; a team's leader).

/**
 * One row per person who can sign in. Not owned by a firm (a person can
 * belong to several), so it has no firm_id and no row-level security.
 * Reach users through `memberships`.
 */
export const users = pgTable("users", {
  id: id(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  email: citext("email").notNull().unique(),
  firstName: text("first_name").notNull().default(""),
  lastName: text("last_name").notNull().default(""),
  initials: text("initials").notNull().default(""),
  avatarUrl: text("avatar_url"),
  ...timestamps,
  archivedAt: archivedAt(),
});

/** A person's role inside one firm. */
export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    appRole: appRole("app_role").notNull().default("staff"),
    title: text("title"),
    /** Billing role. Becomes a foreign key to firm_roles in milestone 1.1. */
    firmRoleId: uuid("firm_role_id"),
    teamId: uuid("team_id"),
    employmentType: employmentType("employment_type")
      .notNull()
      .default("full_time"),
    weeklyCapacityHours: numeric("weekly_capacity_hours", {
      precision: 5,
      scale: 2,
    })
      .notNull()
      .default("40"),
    targetUtilizationBp: integer("target_utilization_bp"),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by").references((): AnyPgColumn => users.id),
    ...timestamps,
    archivedAt: archivedAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique("memberships_firm_user_unique").on(t.firmId, t.userId),
    // Lets teams point at a membership *in the same firm*.
    unique("memberships_firm_id_id_unique").on(t.firmId, t.id),
    // The team must belong to the same firm. A plain foreign key ignores
    // row-level security, so it would let Firm A point at Firm B's team.
    foreignKey({
      name: "memberships_team_same_firm_fk",
      columns: [t.firmId, t.teamId],
      foreignColumns: [teams.firmId, teams.id],
    }),
    check(
      "memberships_target_utilization_bp_range",
      sql`${t.targetUtilizationBp} between 0 and 10000`,
    ),
  ],
);

export const teams = pgTable(
  "teams",
  {
    id: id(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    name: text("name").notNull(),
    leaderMembershipId: uuid("leader_membership_id"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
    archivedAt: archivedAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique("teams_firm_id_id_unique").on(t.firmId, t.id),
    foreignKey({
      name: "teams_leader_same_firm_fk",
      columns: [t.firmId, t.leaderMembershipId],
      foreignColumns: [memberships.firmId, memberships.id],
    }),
  ],
);
