import { NewProjectForm } from "@/components/projects/new-project-form";
import { AccessDenied } from "@/components/shell/access-denied";
import { PageHeader } from "@/components/ui/page-header";
import { withFirm } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";
import { PROJECT_MESSAGES } from "@/lib/projects/form";
import { firmDisplayName } from "@/lib/settings/firm-profile";
import { lookupEnabled } from "@/server/address/google";
import { loadCompanyChoices } from "@/server/projects/page";
import { loadNewProjectOptions } from "@/server/projects/view";

// New project (projects-list spec, "New project flow"): owners, admins, PMs.
// Two steps (Blake, 2026-11-04): project details and phases, then fees,
// roles and consultants.
export default async function NewProjectRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { firm, membership } = await requireSession();
  if (!can(membership, "projects.create"))
    return <AccessDenied firmName={firmDisplayName(firm)} title={PROJECT_MESSAGES.forbidden} />;
  const sp = await searchParams;
  const { options, consultants } = await withFirm(firm.id, async (db) => ({
    options: await loadNewProjectOptions(db, firm.id, firm.timezone),
    consultants: (await loadCompanyChoices(db)).consultants,
  }));
  return (
    <main>
      <PageHeader eyebrow="PROJECTS" title="New project" />
      <NewProjectForm
        options={options}
        consultantChoices={consultants}
        viewerMembershipId={membership.appRole === "project_manager" ? membership.id : ""}
        presetClientId={typeof sp.client === "string" ? sp.client : null}
        addressLookup={lookupEnabled()}
        canEditSettings={can(membership, "settings.edit")}
      />
    </main>
  );
}
