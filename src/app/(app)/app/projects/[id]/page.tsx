import { notFound } from "next/navigation";
import { CreatedToast } from "@/components/projects/created-toast";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ToastProvider } from "@/components/ui/toast";
import { withFirm } from "@/db/tenant";
import { requireSession } from "@/lib/auth/session";
import { formatMoney } from "@/lib/format";
import { FEE_TYPE_LABELS, STATUS_LABELS } from "@/lib/projects/form";
import { loadProjectSummary } from "@/server/projects/view";

// A project's page. Until project-detail (1.5) it shows the name, client and
// phases. Staff not on the project get "not found" (projects-list, States).
export default async function ProjectRoute({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { firm, membership } = await requireSession();
  const { id } = await params;
  const sp = await searchParams;
  const viewer = { membershipId: membership.id, appRole: membership.appRole, active: membership.active };
  const p = await withFirm(firm.id, (db) => loadProjectSummary(db, viewer, id));
  if (!p) notFound();

  const th = "cap border-b border-line px-2.5 py-2 text-left text-2xs font-medium text-muted first:pl-[18px] last:pr-[18px]";
  const td = "border-b border-line-soft px-2.5 py-2 first:pl-[18px] last:pr-[18px]";
  return (
    <ToastProvider>
      <CreatedToast number={typeof sp.created === "string" ? sp.created : null} />
      <main>
        <PageHeader
          eyebrow={`${p.number} · ${STATUS_LABELS[p.status].toUpperCase()}`}
          title={p.name}
          description={`${p.clientName} · ${p.phaseText}`}
        />
        <div className="flex flex-col gap-5 px-4 pt-6 pb-8 md:px-page-x">
          <Card title="Phases" description={p.feeCents !== undefined ? `Fee ${formatMoney(p.feeCents)}` : undefined} padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead className="bg-surface-2">
                  <tr>
                    <th scope="col" className={th}>Code</th>
                    <th scope="col" className={th}>Phase</th>
                    <th scope="col" className={th}>Fee type</th>
                    {p.feeCents !== undefined && <th scope="col" className={`${th} text-right`}>Fee</th>}
                    <th scope="col" className={`${th} text-right`}>Budget hours</th>
                    <th scope="col" className={th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {p.phases.map((ph) => (
                    <tr key={ph.id}>
                      <td className={`${td} num text-xs`}>{ph.code}</td>
                      <td className={td}>
                        {ph.name}
                        {ph.description && <span className="block text-xs text-muted">{ph.description}</span>}
                      </td>
                      <td className={td}>{FEE_TYPE_LABELS[ph.feeType]}</td>
                      {ph.feeCents !== undefined && <td className={`${td} num text-right`}>{formatMoney(ph.feeCents)}</td>}
                      <td className={`${td} num text-right`}>{ph.budgetHours}</td>
                      <td className={`${td} capitalize`}>{ph.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <p className="m-0 text-sm text-muted">The full project page (team, consultants, hours vs budget) arrives in the next update.</p>
        </div>
      </main>
    </ToastProvider>
  );
}
