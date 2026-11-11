import { sql } from "drizzle-orm";
import { type PgTableExtraConfigValue, foreignKey, pgTable, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { archivedAt, id, timestamps } from "./columns";
import { firms } from "./firms";
import { invoices } from "./invoices";
import { timeEntries } from "./time";

/**
 * Time entries someone unticked on a draft, so Recalculate doesn't pull
 * them back in (invoicing spec, open question 5). Ticking one again sets
 * archived_at (rows are never deleted).
 */
export const invoiceExcludedEntries = pgTable(
  "invoice_excluded_entries",
  {
    id: id(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    invoiceId: uuid("invoice_id").notNull(),
    timeEntryId: uuid("time_entry_id").notNull(),
    ...timestamps,
    archivedAt: archivedAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    uniqueIndex("invoice_excluded_entries_unique")
      .on(t.invoiceId, t.timeEntryId)
      .where(sql`${t.archivedAt} is null`),
    foreignKey({
      name: "invoice_excluded_entries_invoice_same_firm_fk",
      columns: [t.firmId, t.invoiceId],
      foreignColumns: [invoices.firmId, invoices.id],
    }),
    foreignKey({
      name: "invoice_excluded_entries_entry_same_firm_fk",
      columns: [t.firmId, t.timeEntryId],
      foreignColumns: [timeEntries.firmId, timeEntries.id],
    }),
  ],
);
