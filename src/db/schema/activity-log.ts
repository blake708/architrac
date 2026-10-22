import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { id } from "./columns";
import { firms } from "./firms";
import { users } from "./people";

/**
 * History of changes to business records. Append-only: written by server
 * actions (not database triggers) so we know who made the change.
 */
export const activityLog = pgTable(
  "activity_log",
  {
    id: id(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    /** Null for system actions (cron jobs, webhooks). */
    actorUserId: uuid("actor_user_id").references(() => users.id),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    /** created, updated, status_changed, deleted (more added per milestone). */
    action: text("action").notNull(),
    /** Before/after values for the fields that changed. */
    changes: jsonb("changes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("activity_log_entity_idx").on(t.firmId, t.entityType, t.entityId),
  ],
);
