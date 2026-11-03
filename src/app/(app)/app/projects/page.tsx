import { ProjectsPage } from "@/components/projects/projects-page";
import { withFirm } from "@/db/tenant";
import { requireSession } from "@/lib/auth/session";
import { parseListParams } from "@/lib/projects/display";
import { loadProjects } from "@/server/projects/view";

// Projects (projects-list spec). Staff see only projects they're on; fee,
// billed and health are left out on the server for anyone who may not see
// them.
export default async function ProjectsRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { firm, membership } = await requireSession();
  const viewer = { membershipId: membership.id, appRole: membership.appRole, active: membership.active };
  const view = await withFirm(firm.id, (db) => loadProjects(db, viewer));
  const initial = parseListParams(await searchParams, view.showMoneyColumns);
  return <ProjectsPage view={view} initial={initial} />;
}
