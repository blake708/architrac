import { notFound } from "next/navigation";
import { TeamTab } from "@/components/projects/detail/team-tab";
import { getCompanyChoices, getProjectPage } from "@/server/projects/page-cache";

// Team tab (project-detail spec): everyone who can open the project sees it;
// hours only in the financial view, rate overrides only for owners/admins.
export default async function ProjectTeam({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getProjectPage(id);
  if (!p) notFound();
  const linkable = p.canEdit ? (await getCompanyChoices()).linkable : [];
  return <TeamTab p={p} linkable={linkable} />;
}
