import { redirect } from "next/navigation";
import { InvoiceBuilder } from "@/components/invoices/invoice-builder";
import { AccessDenied } from "@/components/shell/access-denied";
import { withFirm } from "@/db/tenant";
import { requireSession } from "@/lib/auth/session";
import { firmDisplayName } from "@/lib/settings/firm-profile";
import { loadBuilder } from "@/server/invoices/view";
import { actorFrom } from "@/server/settings/common";

// /app/invoices/[invoiceId]/edit: the builder (invoicing spec Layout C).
// Drafts and invoices in review only. Someone without access to the
// project gets the no-access page (spec: 403, not 404).
export default async function InvoiceEditRoute({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  const session = await requireSession();
  const actor = { ...actorFrom(session), timezone: session.firm.timezone };
  const view = await withFirm(session.firm.id, (db) => loadBuilder(db, actor, invoiceId));
  if (!view) return <AccessDenied firmName={firmDisplayName(session.firm)} />;
  if (view.status !== "draft" && view.status !== "in_review") redirect("/app/invoices");
  // Keyed by invoice, not version: a save refreshes this page, and the
  // builder must keep its open dialogs and typing (it takes newer data itself).
  return <InvoiceBuilder key={view.id} initial={view} />;
}
