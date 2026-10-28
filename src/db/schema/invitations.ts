import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { citext, id, timestamps } from "./columns";
import { appRole, invitationStatus } from "./enums";
import { firms } from "./firms";
import { memberships, users } from "./people";

/**
 * Someone invited to a firm who hasn't joined yet (settings-firm spec).
 *
 * A separate table (not a half-filled membership) because the person has no
 * `users` row until they accept, and `memberships.user_id` stays required.
 * Clerk sends the email; we keep the app role and title Clerk doesn't know.
 * Rows are never deleted: revoked and accepted invites keep their status.
 */
export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    email: citext("email").notNull(),
    appRole: appRole("app_role").notNull(),
    title: text("title"),
    /** Billing role. Becomes a foreign key to firm_roles in milestone 1.1. */
    firmRoleId: uuid("firm_role_id"),
    status: invitationStatus("status").notNull().default("pending"),
    /** Clerk's id for the invitation. Null only if the Clerk call failed. */
    clerkInvitationId: text("clerk_invitation_id").unique(),
    invitedBy: uuid("invited_by").references(() => users.id),
    invitedAt: timestamp("invited_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    /** The membership made when they accepted. */
    membershipId: uuid("membership_id"),
    ...timestamps,
  },
  (t) => [
    // At most one open invitation per email per firm.
    uniqueIndex("invitations_one_pending_per_email")
      .on(t.firmId, t.email)
      .where(sql`${t.status} = 'pending'`),
    index("invitations_firm_status_idx").on(t.firmId, t.status),
    // The membership must be in the same firm (a plain foreign key ignores
    // row-level security).
    foreignKey({
      name: "invitations_membership_same_firm_fk",
      columns: [t.firmId, t.membershipId],
      foreignColumns: [memberships.firmId, memberships.id],
    }),
  ],
);
