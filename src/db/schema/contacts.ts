import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  type PgTableExtraConfigValue,
  foreignKey,
  index,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { archivedAt, id, timestamps } from "./columns";
import { companyKind } from "./enums";
import { firms } from "./firms";
import { users } from "./people";

// The address book (contacts spec, milestone 1.2). Companies and contacts
// point at each other: a contact's company, and a company's main and
// billing contact. Every link stays inside one firm (composite keys).

export const companies = pgTable(
  "companies",
  {
    id: id(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    name: text("name").notNull(),
    kind: companyKind("kind").notNull(),
    /** Grey line under the name: "Medical developer". */
    description: text("description"),
    phone: text("phone"),
    /** Stored with its scheme: https://example.com */
    website: text("website"),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    /** 2-letter state code. */
    state: text("state"),
    postalCode: text("postal_code"),
    /** Main contact (contacts spec, "Main contact" column). */
    primaryContactId: uuid("primary_contact_id"),
    /** Who invoices go to (clients). */
    billingContactId: uuid("billing_contact_id"),
    /**
     * A shared accounts-payable address (ap@client.com). Invoices are emailed
     * here, copying the billing contact (decision #32). Clients only. Lowercase.
     */
    billingEmail: text("billing_email"),
    /** QuickBooks customer this maps to (1.9). */
    quickbooksCustomerId: text("quickbooks_customer_id"),
    notes: text("notes"),
    createdBy: uuid("created_by").references((): AnyPgColumn => users.id),
    ...timestamps,
    archivedAt: archivedAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique("companies_firm_id_id_unique").on(t.firmId, t.id),
    check("companies_billing_email_length", sql`${t.billingEmail} is null or char_length(${t.billingEmail}) <= 254`),
    index("companies_firm_name_idx").on(t.firmId, sql`lower(${t.name})`),
    foreignKey({
      name: "companies_primary_contact_same_firm_fk",
      columns: [t.firmId, t.primaryContactId],
      foreignColumns: [contacts.firmId, contacts.id],
    }),
    foreignKey({
      name: "companies_billing_contact_same_firm_fk",
      columns: [t.firmId, t.billingContactId],
      foreignColumns: [contacts.firmId, contacts.id],
    }),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    companyId: uuid("company_id"),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull().default(""),
    /** "PE", "LEED AP": shown after the name. */
    designations: text("designations"),
    title: text("title"),
    email: text("email"),
    phone: text("phone"),
    mobile: text("mobile"),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    notes: text("notes"),
    createdBy: uuid("created_by").references((): AnyPgColumn => users.id),
    ...timestamps,
    archivedAt: archivedAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique("contacts_firm_id_id_unique").on(t.firmId, t.id),
    index("contacts_firm_company_idx").on(t.firmId, t.companyId),
    index("contacts_firm_email_idx").on(t.firmId, sql`lower(${t.email})`),
    foreignKey({
      name: "contacts_company_same_firm_fk",
      columns: [t.firmId, t.companyId],
      foreignColumns: [companies.firmId, companies.id],
    }),
  ],
);
