import { InvoicesPage } from "@/components/invoices/invoices-page";
import { AccessDenied } from "@/components/shell/access-denied";
import { ToastProvider } from "@/components/ui/toast";
import { withFirm } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";
import { firmDisplayName } from "@/lib/settings/firm-profile";
import { actorFrom } from "@/server/settings/common";
import { loadInvoicesPage } from "@/server/invoices/list";

// /app/invoices (invoicing spec Layout A; decision #29: the only place an
// invoice starts). Owners and admins see every invoice, PMs their own
// projects', staff get the no-access page.
export default async function InvoicesRoute() {
  const session = await requireSession();
  if (!can(session.membership, "invoices.view", { isProjectManager: true }))
    return <AccessDenied firmName={firmDisplayName(session.firm)} />;
  const actor = { ...actorFrom(session), timezone: session.firm.timezone };
  const data = await withFirm(session.firm.id, (db) => loadInvoicesPage(db, actor));
  return (
    <ToastProvider>
      <InvoicesPage data={data} />
    </ToastProvider>
  );
}
