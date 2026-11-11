import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { invoiceMoneyByCompany } from "@/server/invoices/facts";
import { companies, consultants, contacts, projectContacts, projectPhases, projects } from "@/db/schema";
import type { TenantDb } from "@/db/tenant";
import { type Member, can } from "@/lib/auth/permissions";
import {
  type InvoiceMoney,
  companyBilled,
  companyOpen,
  consultantFees,
  missingBillingContact,
} from "@/lib/calc/contacts";
import { phaseText } from "@/lib/calc/projects";
import type { CompanyKind } from "@/lib/contacts/form";

// Contacts page data (contacts spec, Data shown and business rules 1–13).
// Billed, open, fees and QuickBooks status are only computed and sent for
// owners/admins (rule 12): for everyone else they're left out here.

export const MAX_ROWS = 1000;

export type ProjectLink = { id: string; name: string; note: string };

export type CompanyRow = {
  id: string;
  name: string;
  kind: CompanyKind;
  description: string | null;
  phone: string | null;
  website: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  notes: string | null;
  primaryContactId: string | null;
  billingContactId: string | null;
  missingBilling: boolean;
  projects: ProjectLink[];
  /** Owner/admin only. */
  money?:
    | { kind: "client"; billedCents: number; openCents: number }
    | { kind: "consultant"; feesCents: number }
    | null;
  quickbooksLinked?: boolean;
};

export type ContactRow = {
  id: string;
  firstName: string;
  lastName: string;
  designations: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  tags: string[];
  notes: string | null;
  companyId: string | null;
  /** Set when the company is archived ("(archived company)"). */
  companyArchived: boolean;
};

export type ContactsView = {
  companies: CompanyRow[];
  contacts: ContactRow[];
  /** Names of archived companies that still have contacts. */
  archivedCompanyNames: Record<string, string>;
  kpis: {
    companies: number;
    clients: number;
    consultants: number;
    people: number;
    missingBilling: number;
    /** Owner/admin only. */
    openClients?: number;
    openCents?: number;
  };
  canEdit: boolean;
  canArchive: boolean;
  seesMoney: boolean;
};

/** Invoices per client company (billed and open come from these). */
function invoicesByCompany(db: TenantDb): Promise<Map<string, InvoiceMoney[]>> {
  return invoiceMoneyByCompany(db);
}

/**
 * Projects linked to each company (rule 3) and consultant fee rows (rule 5).
 * Clients: projects they're the client on (note: where it stands).
 * Contractors, agencies, vendors: project_contacts links (note: their role).
 * Consultants: projects they're on (note: discipline) and their fees. Archived projects
 * are left out; closed ones stay.
 */
async function projectsByCompany(db: TenantDb): Promise<{
  projects: Map<string, ProjectLink[]>;
  fees: Map<string, { feeCents: number; projectArchived: boolean }[]>;
}> {
  const out = new Map<string, ProjectLink[]>();
  const add = (companyId: string, link: ProjectLink) => {
    const list = out.get(companyId) ?? [];
    if (!list.some((l) => l.id === link.id)) list.push(link);
    out.set(companyId, list);
  };

  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      number: projects.number,
      status: projects.status,
      clientCompanyId: projects.clientCompanyId,
    })
    .from(projects)
    .where(isNull(projects.archivedAt))
    .orderBy(desc(projects.number));
  const ids = rows.map((r) => r.id);
  const phases = ids.length
    ? await db
        .select({
          projectId: projectPhases.projectId,
          name: projectPhases.name,
          sortOrder: projectPhases.sortOrder,
          status: projectPhases.status,
        })
        .from(projectPhases)
        .where(and(inArray(projectPhases.projectId, ids), isNull(projectPhases.archivedAt)))
    : [];
  const byProject = new Map<string, typeof phases>();
  for (const ph of phases) byProject.set(ph.projectId, [...(byProject.get(ph.projectId) ?? []), ph]);
  for (const r of rows)
    add(r.clientCompanyId, { id: r.id, name: r.name, note: phaseText(r.status, byProject.get(r.id) ?? []) });

  const links = await db
    .select({
      companyId: projectContacts.companyId,
      projectId: projects.id,
      name: projects.name,
      role: projectContacts.role,
    })
    .from(projectContacts)
    .innerJoin(projects, eq(projects.id, projectContacts.projectId))
    .where(and(isNull(projectContacts.archivedAt), isNull(projects.archivedAt)))
    .orderBy(desc(projects.number));
  for (const l of links) add(l.companyId, { id: l.projectId, name: l.name, note: l.role ?? "" });

  // Consultants (rule 3: their projects with the discipline; rule 5: fees).
  const fees = new Map<string, { feeCents: number; projectArchived: boolean }[]>();
  const consultantRows = await db
    .select({
      companyId: consultants.companyId,
      projectId: projects.id,
      name: projects.name,
      discipline: consultants.discipline,
      feeCents: consultants.feeCents,
    })
    .from(consultants)
    .innerJoin(projects, eq(projects.id, consultants.projectId))
    .where(and(isNull(consultants.archivedAt), isNull(projects.archivedAt)))
    .orderBy(desc(projects.number));
  for (const c of consultantRows) {
    add(c.companyId, { id: c.projectId, name: c.name, note: c.discipline });
    fees.set(c.companyId, [...(fees.get(c.companyId) ?? []), { feeCents: c.feeCents, projectArchived: false }]);
  }

  return { projects: out, fees };
}

const byName = (a: string, b: string) =>
  a.localeCompare(b, "en", { sensitivity: "base" });

export async function loadContacts(db: TenantDb, viewer: Member): Promise<ContactsView> {
  const seesMoney = can(viewer, "financials.view");

  const companyRows = await db
    .select()
    .from(companies)
    .orderBy(asc(companies.name))
    .limit(MAX_ROWS * 2);
  const contactRows = await db
    .select()
    .from(contacts)
    .where(isNull(contacts.archivedAt))
    .orderBy(asc(contacts.lastName), asc(contacts.firstName))
    .limit(MAX_ROWS);

  const contactById = new Map(contactRows.map((c) => [c.id, c]));
  const archivedCompanyIds = new Set(
    companyRows.filter((c) => c.archivedAt).map((c) => c.id),
  );
  const archivedCompanyNames: Record<string, string> = {};
  for (const c of companyRows)
    if (c.archivedAt && contactRows.some((p) => p.companyId === c.id))
      archivedCompanyNames[c.id] = c.name;

  const invoices = seesMoney ? await invoicesByCompany(db) : new Map();
  const { projects, fees } = await projectsByCompany(db);

  const rows: CompanyRow[] = companyRows
    .filter((c) => !c.archivedAt)
    .sort((a, b) => byName(a.name, b.name))
    .slice(0, MAX_ROWS)
    .map((c) => {
      const billing = c.billingContactId ? contactById.get(c.billingContactId) : undefined;
      const row: CompanyRow = {
        id: c.id,
        name: c.name,
        kind: c.kind,
        description: c.description,
        phone: c.phone,
        website: c.website,
        addressLine1: c.addressLine1,
        addressLine2: c.addressLine2,
        city: c.city,
        state: c.state,
        postalCode: c.postalCode,
        notes: c.notes,
        // Archived contacts aren't loaded, so these drop to null for them.
        primaryContactId:
          c.primaryContactId && contactById.has(c.primaryContactId)
            ? c.primaryContactId
            : null,
        billingContactId: billing ? billing.id : null,
        missingBilling: missingBillingContact(
          c.kind,
          billing ? { archived: false, email: billing.email } : null,
        ),
        projects: projects.get(c.id) ?? [],
      };
      if (seesMoney) {
        row.quickbooksLinked = Boolean(c.quickbooksCustomerId);
        if (c.kind === "client") {
          const inv = invoices.get(c.id) ?? [];
          row.money = {
            kind: "client",
            billedCents: companyBilled(inv),
            openCents: companyOpen(inv),
          };
        } else if (c.kind === "consultant") {
          row.money = { kind: "consultant", feesCents: consultantFees(fees.get(c.id) ?? []) };
        } else row.money = null;
      }
      return row;
    });

  const people: ContactRow[] = contactRows.map((p) => ({
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    designations: p.designations,
    title: p.title,
    email: p.email,
    phone: p.phone,
    mobile: p.mobile,
    tags: p.tags,
    notes: p.notes,
    companyId: p.companyId,
    companyArchived: p.companyId ? archivedCompanyIds.has(p.companyId) : false,
  }));

  const clients = rows.filter((c) => c.kind === "client");
  const kpis: ContactsView["kpis"] = {
    companies: rows.length,
    clients: clients.length,
    consultants: rows.filter((c) => c.kind === "consultant").length,
    people: people.length,
    missingBilling: rows.filter((c) => c.missingBilling).length,
  };
  if (seesMoney) {
    const open = clients.filter(
      (c) => c.money?.kind === "client" && c.money.openCents > 0,
    );
    kpis.openClients = open.length;
    kpis.openCents = open.reduce(
      (n, c) => n + (c.money?.kind === "client" ? c.money.openCents : 0),
      0,
    );
  }

  return {
    companies: rows,
    contacts: people,
    archivedCompanyNames,
    kpis,
    canEdit: can(viewer, "contacts.edit"),
    canArchive: can(viewer, "contacts.archive"),
    seesMoney,
  };
}
