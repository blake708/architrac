import { sql } from "drizzle-orm";
import { type PgTableExtraConfigValue, foreignKey, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { archivedAt, id, timestamps } from "./columns";
import { firms } from "./firms";
import { memberships } from "./people";

// In-app notifications (timesheet-approval spec rule 13, decision #25). One
// row per recipient, written by notify() inside the caller's transaction.
// Row security limits rows to the firm; the server only ever returns the
// signed-in person's own (membership_id = theirs).

export const NOTIFICATION_KINDS = [
  "review_waiting",
  "timesheet_returned",
  "timesheet_approved",
  "timesheet_reminder",
  "approver_nudge",
  "review_summary",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    /** The recipient. */
    membershipId: uuid("membership_id").notNull(),
    kind: text("kind").$type<NotificationKind>().notNull(),
    title: text("title").notNull(),
    body: text("body"),
    /** In-app path to open, e.g. /app/time/approvals/<id>. */
    link: text("link"),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    readAt: timestamp("read_at", { withTimezone: true }),
    ...timestamps,
    archivedAt: archivedAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    index("notifications_recipient_idx").on(t.firmId, t.membershipId, t.createdAt),
    index("notifications_unread_idx")
      .on(t.firmId, t.membershipId)
      .where(sql`${t.readAt} is null and ${t.archivedAt} is null`),
    foreignKey({
      name: "notifications_membership_same_firm_fk",
      columns: [t.firmId, t.membershipId],
      foreignColumns: [memberships.firmId, memberships.id],
    }),
  ],
);
