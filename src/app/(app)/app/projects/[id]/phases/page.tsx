import { notFound } from "next/navigation";
import { ConsultantsCard } from "@/components/projects/detail/consultants-card";
import { PhasesEditor } from "@/components/projects/detail/phases-editor";
import { getCompanyChoices, getProjectPage } from "@/server/projects/page-cache";

// Phases & fees tab (project-detail spec). Financial view only: everyone
// else gets 404. Owners, admins and the project's own PM can edit phases,
// add and archive them, redistribute the fee and set role mixes.
export default async function ProjectPhases({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getProjectPage(id);
  if (!p || !p.financial || !p.money) notFound();
  const choices = p.canEdit ? (await getCompanyChoices()).consultants : [];

  return (
    <>
      <PhasesEditor p={p} />
      <ConsultantsCard
        projectId={p.id}
        rows={p.consultants}
        choices={choices}
        canEdit={p.canEdit}
        defaultMarkupBp={p.edit?.defaultMarkupBp ?? 1000}
      />
    </>
  );
}
