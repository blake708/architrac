import { notFound } from "next/navigation";
import { ProjectInvoicesTab } from "@/components/invoices/project-invoices";
import { withFirm } from "@/db/tenant";
import { requireSession } from "@/lib/auth/session";
import { loadProjectInvoices } from "@/server/invoices/project-tab";
import { getProjectPage } from "@/server/projects/page-cache";
import { actorFrom } from "@/server/settings/common";

// A project's Invoices tab (invoicing spec Layout B; the folder is "billing"
// per ARCHITECTURE §3). Owners, admins and the project's own PM or
// principal; everyone else gets 404, like Phases & fees.
export default async function ProjectBilling({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getProjectPage(id);
  if (!p || !p.financial) notFound();
  const session = await requireSession();
  const actor = { ...actorFrom(session), timezone: session.firm.timezone };
  const data = await withFirm(session.firm.id, (db) => loadProjectInvoices(db, actor, id));
  if (!data) notFound();
  return <ProjectInvoicesTab data={data} />;
}
