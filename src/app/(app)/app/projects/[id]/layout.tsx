import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { PhaseStepper } from "@/components/projects/detail/phase-stepper";
import { ProjectHeader } from "@/components/projects/detail/project-header";
import { ProjectNav } from "@/components/projects/detail/project-nav";
import { ToastProvider } from "@/components/ui/toast";
import { getEditOptions, getProjectPage } from "@/server/projects/page-cache";

// A project's page (project-detail spec): header, phase stepper and tabs,
// shared by Overview, Phases & fees and Team. Unknown ids, other firms'
// projects, archived projects and staff who aren't on it all get 404.
export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const p = await getProjectPage(id);
  if (!p) notFound();
  const edit = p.canEdit ? await getEditOptions() : null;
  return (
    <ToastProvider>
      <main>
        <ProjectHeader p={p} edit={edit} />
        <PhaseStepper phases={p.phases} />
        <ProjectNav projectId={p.id} financial={p.financial} />
        <div className="flex flex-col gap-5 px-4 pt-6 pb-8 md:px-page-x">{children}</div>
      </main>
    </ToastProvider>
  );
}
