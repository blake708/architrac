import {
  type ContactsParams,
  ContactsPage,
} from "@/components/contacts/contacts-page";
import { ToastProvider } from "@/components/ui/toast";
import { withFirm } from "@/db/tenant";
import { requireSession } from "@/lib/auth/session";
import { COMPANY_KINDS, type CompanyKind } from "@/lib/contacts/form";
import { lookupEnabled } from "@/server/address/google";
import { loadContacts } from "@/server/contacts/view";

// Contacts (contacts spec): everyone can look things up; owners, admins and
// PMs edit; owners and admins archive and see money.
export default async function ContactsRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { firm, membership } = await requireSession();
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");

  const view = await withFirm(firm.id, (db) =>
    loadContacts(db, { appRole: membership.appRole, active: membership.active }),
  );
  const kind = one("kind");
  const initial: ContactsParams = {
    tab: one("tab") === "people" ? "people" : "companies",
    kind: (COMPANY_KINDS as readonly string[]).includes(kind) ? (kind as CompanyKind) : "all",
    q: one("q"),
    company: one("company") || null,
    contact: one("contact") || null,
  };
  return (
    <ToastProvider>
      <ContactsPage view={view} initial={initial} addressLookup={lookupEnabled()} />
    </ToastProvider>
  );
}
