import { redirect } from "next/navigation";
import { InvoiceDetail } from "@/components/invoices/invoice-detail";
import { AccessDenied } from "@/components/shell/access-denied";
import { ToastProvider } from "@/components/ui/toast";
import { withFirm } from "@/db/tenant";
import { requireSession } from "@/lib/auth/session";
import { firmDisplayName } from "@/lib/settings/firm-profile";
import { loadInvoiceDetail } from "@/server/invoices/detail";
import { actorFrom } from "@/server/settings/common";

// /app/invoices/[invoiceId]: a sent or void invoice (invoicing spec Layout
// D). Drafts open in the builder instead.
export default async function InvoiceRoute({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  const session = await requireSession();
  const actor = { ...actorFrom(session), timezone: session.firm.timezone };
  const detail = await withFirm(session.firm.id, (db) => loadInvoiceDetail(db, actor, invoiceId));
  if (!detail) return <AccessDenied firmName={firmDisplayName(session.firm)} />;
  if (detail.status === "draft" || detail.status === "in_review") redirect(`/app/invoices/${invoiceId}/edit`);
  return (
    <ToastProvider>
      <InvoiceDetail detail={detail} />
    </ToastProvider>
  );
}
