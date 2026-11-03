"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DrawerContent } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import type { ProjectStatus } from "@/lib/calc/projects";
import { PROJECT_STATUSES } from "@/lib/projects/form";
import { updateProject } from "@/server/projects/actions";
import type { ProjectPage } from "@/server/projects/page";
import type { NewProjectOptions } from "@/server/projects/view";
import { ProjectFields, type ProjectDraft, checkDraft, draftFrom } from "../project-fields";

const STATUSES: ProjectStatus[] = ["active", "on_hold", "closed", "pursuit"];

/** Edit project (project-detail spec): the New project fields plus Closed. */
export function EditProjectDrawer({
  p,
  options,
  addressLookup,
  onClose,
}: {
  p: ProjectPage;
  options: NewProjectOptions;
  addressLookup: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [d, setD] = useState<ProjectDraft>(() =>
    draftFrom({
      ...p,
      ...p.address,
      clientCompanyId: p.client.id,
      clientContactId: p.clientContact?.id ?? null,
      principalMembershipId: p.principal?.membershipId ?? "",
      pmMembershipId: p.pm?.membershipId ?? "",
    }),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  // Keep the current principal and PM listed even if they'd no longer be offered.
  const keep = (list: { membershipId: string; name: string }[], who: ProjectPage["pm"]) =>
    who && !list.some((x) => x.membershipId === who.membershipId) ? [...list, who] : list;
  const fieldOptions = {
    ...options,
    principals: keep(options.principals, p.principal),
    pms: keep(options.pms, p.pm),
  };

  function save() {
    const { fields, errors: local } = checkDraft(d);
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    setFormError(null);
    startTransition(async () => {
      const result = await updateProject({ ...fields, id: p.id });
      setConfirmClose(false);
      if (!result.ok) {
        setErrors((result.fieldErrors ?? {}) as Record<string, string>);
        setFormError(result.error ?? "Fix the fields marked in red.");
        return;
      }
      toast(`${fields.number} saved`);
      onClose();
      router.refresh();
    });
  }

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DrawerContent
          title="Edit project"
          description={`${p.number} · ${p.name}`}
          className="max-w-[720px]!"
          footer={
            <>
              {formError && (
                <span role="alert" className="mr-auto text-sm text-red">
                  {formError}
                </span>
              )}
              <Button onClick={onClose}>Cancel</Button>
              <Button
                variant="primary"
                disabled={pending}
                onClick={() => (d.status === "closed" && p.status !== "closed" ? setConfirmClose(true) : save())}
              >
                {pending ? "Saving…" : "Save project"}
              </Button>
            </>
          }
        >
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <ProjectFields
              value={d}
              onChange={(patch) => setD((x) => ({ ...x, ...patch }))}
              errors={errors}
              options={fieldOptions}
              statuses={STATUSES.filter((s) => (PROJECT_STATUSES as readonly string[]).includes(s))}
              addressLookup={addressLookup}
            />
          </form>
        </DrawerContent>
      </Dialog>
      <Dialog open={confirmClose} onOpenChange={(o) => !o && setConfirmClose(false)}>
        <DialogContent
          title={`Close ${p.number}?`}
          description="No new time can be logged on this project."
          footer={
            <>
              <Button onClick={() => setConfirmClose(false)}>Cancel</Button>
              <Button variant="primary" disabled={pending} onClick={save}>
                Close project
              </Button>
            </>
          }
        />
      </Dialog>
    </>
  );
}
