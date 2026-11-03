import { NewProjectForm } from "@/components/projects/new-project-form";
import { AccessDenied } from "@/components/shell/access-denied";
import { PageHeader } from "@/components/ui/page-header";
import { withFirm } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";
import { PROJECT_MESSAGES } from "@/lib/projects/form";
import { firmDisplayName } from "@/lib/settings/firm-profile";
import { loadNewProjectOptions } from "@/server/projects/view";

// New project (projects-list spec, "New project flow"): owners, admins, PMs.
export default async function NewProjectRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { firm, membership } = await requireSession();
  if (!can(membership, "projects.create"))
    return <AccessDenied firmName={firmDisplayName(firm)} title={PROJECT_MESSAGES.forbidden} />;
  const sp = await searchParams;
  const options = await withFirm(firm.id, (db) => loadNewProjectOptions(db, firm.timezone));
  return (
    <main>
      <PageHeader eyebrow="PROJECTS" title="New project" />
      <NewProjectForm
        options={options}
        viewerMembershipId={membership.appRole === "project_manager" ? membership.id : ""}
        presetClientId={typeof sp.client === "string" ? sp.client : null}
      />
    </main>
  );
}
