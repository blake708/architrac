"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SCOPE_LABELS } from "@/lib/projects/form";
import type { ProjectPage } from "@/server/projects/page";
import type { NewProjectOptions } from "@/server/projects/view";
import { HealthBadge } from "../project-bits";
import { EditProjectDrawer } from "./edit-project-drawer";

/** Number, name, client and address; health and Edit project on the right. */
export function ProjectHeader({
  p,
  edit,
}: {
  p: ProjectPage;
  edit: { options: NewProjectOptions; addressLookup: boolean } | null;
}) {
  const [editing, setEditing] = useState(false);
  const meta = [
    p.number,
    <span key="t" className="uppercase">{p.projectType}</span>,
    p.scopeKind && <span key="s" className="uppercase">{SCOPE_LABELS[p.scopeKind]}</span>,
    p.squareFeet && `${p.squareFeet.toLocaleString("en-US")} SF`,
  ].filter(Boolean);
  const place = [p.address.addressLine1, p.address.city, p.address.state].filter(Boolean).join(", ");
  return (
    <>
      <PageHeader
        eyebrow={
          <span data-testid="project-meta">
            {meta.map((m, i) => (
              <span key={i}>
                {i > 0 && " · "}
                {m}
              </span>
            ))}
          </span>
        }
        title={p.name}
        description={[p.client.name, place].filter(Boolean).join(" · ")}
        actions={
          <>
            {p.money && (
              <span className="flex items-center" data-testid="project-health">
                <HealthBadge health={p.money.health} />
              </span>
            )}
            {p.canEdit && edit && <Button onClick={() => setEditing(true)}>Edit project</Button>}
          </>
        }
      />
      {p.canEdit && edit && editing && (
        <EditProjectDrawer p={p} options={edit.options} addressLookup={edit.addressLookup} onClose={() => setEditing(false)} />
      )}
    </>
  );
}
