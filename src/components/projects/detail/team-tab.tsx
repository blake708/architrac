"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/field";
import { PlusIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { fmtHours } from "@/lib/calc/project-detail";
import { KIND_LABELS, type CompanyKind } from "@/lib/contacts/form";
import { formatMoney } from "@/lib/format";
import { PROJECT_MESSAGES, PROJECT_ROLES, moneyInput, parseMoney } from "@/lib/projects/form";
import { addLink, removeLink, removeMember, saveMember } from "@/server/projects/actions";
import type { CompanyChoice, LinkedCompany, ProjectPage, TeamMember } from "@/server/projects/page";

const OTHER = "__other";

/** Team tab (project-detail spec): firm team, then client and outside companies. */
export function TeamTab({ p, linkable }: { p: ProjectPage; linkable: CompanyChoice[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [member, setMember] = useState<TeamMember | "new" | null>(null);
  const [linking, setLinking] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: "member"; row: TeamMember } | { kind: "link"; row: LinkedCompany } | null>(null);

  const saved = (msg: string) => {
    toast(msg);
    router.refresh();
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Card
        title="Firm team"
        actions={
          p.canEdit && (
            <Button icon={<PlusIcon />} onClick={() => setMember("new")}>
              Add person
            </Button>
          )
        }
      >
        <ul className="m-0 flex list-none flex-col p-0 text-sm" aria-label="Firm team">
          {p.team.map((m) => {
            const locked = m.isPm || m.isPrincipal;
            return (
              <li key={m.id} data-member={m.name} className="flex items-center gap-3 border-b border-line-soft py-2.5 last:border-b-0">
                <Avatar name={m.name} initials={m.initials} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">
                    {m.initials} · {m.projectRole}
                  </span>
                  <span className="block text-xs text-muted">
                    {m.name}
                    {m.title && ` · ${m.title}`}
                  </span>
                  {m.rateOverrideCents != null && (
                    <span className="block text-xs text-muted">Rate override {formatMoney(m.rateOverrideCents)}/h</span>
                  )}
                </span>
                {m.hours !== undefined && <span className="num text-xs text-muted">{fmtHours(m.hours)} h</span>}
                {p.canEdit && (
                  <span className="flex gap-1">
                    <Button variant="ghost" onClick={() => setMember(m)} aria-label={`Edit ${m.name}`}>
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={locked}
                      title={locked ? PROJECT_MESSAGES.keepPmPrincipal : undefined}
                      onClick={() => setConfirm({ kind: "member", row: m })}
                      aria-label={`Remove ${m.name}`}
                    >
                      Remove
                    </Button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card
        title="Client & consultants"
        actions={
          p.canEdit && (
            <Button icon={<PlusIcon />} onClick={() => setLinking(true)}>
              Add company
            </Button>
          )
        }
      >
        <ul className="m-0 flex list-none flex-col p-0 text-sm" aria-label="Client and consultants">
          <Outside role="Client" company={p.client.name} contact={p.clientContact} />
          {p.consultants.map((c) => (
            <Outside key={c.id} role={c.discipline} company={c.companyName} contact={c.contact} />
          ))}
          {p.linked.map((l) => (
            <Outside
              key={l.id}
              role={l.role || KIND_LABELS[l.kind as CompanyKind] || "Company"}
              company={l.companyName}
              contact={l.contact}
              onRemove={p.canEdit ? () => setConfirm({ kind: "link", row: l }) : undefined}
            />
          ))}
        </ul>
        {p.canEdit && (
          <p className="m-0 mt-3 text-xs text-muted">Consultants and their fees are managed on Phases &amp; fees.</p>
        )}
      </Card>

      {member && (
        <MemberDialog
          p={p}
          row={member === "new" ? null : member}
          onClose={() => setMember(null)}
          onSaved={(msg) => {
            setMember(null);
            saved(msg);
          }}
        />
      )}
      {linking && (
        <LinkDialog
          projectId={p.id}
          choices={linkable.filter((c) => !p.linked.some((l) => l.companyId === c.id))}
          onClose={() => setLinking(false)}
          onSaved={(msg) => {
            setLinking(false);
            saved(msg);
          }}
        />
      )}
      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        {confirm && (
          <DialogContent
            title={`Remove ${confirm.kind === "member" ? confirm.row.name : confirm.row.companyName}?`}
            description={
              confirm.kind === "member"
                ? "They come off this project's team. Time they've logged stays."
                : "It comes off this project. The company stays in Contacts."
            }
            footer={
              <>
                <Button onClick={() => setConfirm(null)}>Cancel</Button>
                <Button
                  variant="danger"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const c = confirm;
                      const r =
                        c.kind === "member"
                          ? await removeMember({ projectId: p.id, id: c.row.id })
                          : await removeLink({ projectId: p.id, id: c.row.id });
                      setConfirm(null);
                      if (!r.ok) return toast(r.error ?? "Couldn't remove.", "error");
                      saved(`${c.kind === "member" ? c.row.name : c.row.companyName} removed`);
                    })
                  }
                >
                  Remove
                </Button>
              </>
            }
          />
        )}
      </Dialog>
    </div>
  );
}

function Outside({
  role,
  company,
  contact,
  onRemove,
}: {
  role: string;
  company: string;
  contact: { name: string; title: string | null; email: string | null } | null;
  onRemove?: () => void;
}) {
  return (
    <li data-company={company} className="grid grid-cols-[130px_1fr_auto] items-start gap-3 border-b border-line-soft py-2.5 last:border-b-0">
      <span className="cap pt-0.5 text-2xs font-medium text-muted">{role}</span>
      <span className="min-w-0">
        <span className="block font-medium">{company}</span>
        {contact && (
          <span className="block text-xs text-muted">
            {contact.name}
            {contact.title && ` · ${contact.title}`}
          </span>
        )}
      </span>
      <span className="flex gap-1">
        {contact?.email && (
          <a href={`mailto:${contact.email}`} className="text-sm text-blue underline">
            Email
          </a>
        )}
        {onRemove && (
          <Button variant="ghost" onClick={onRemove} aria-label={`Remove ${company}`}>
            Remove
          </Button>
        )}
      </span>
    </li>
  );
}

function MemberDialog({
  p,
  row,
  onClose,
  onSaved,
}: {
  p: ProjectPage;
  row: TeamMember | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const known = row ? PROJECT_ROLES.includes(row.projectRole) : true;
  const [v, setV] = useState({
    membershipId: row?.membershipId ?? "",
    role: row ? (known ? row.projectRole : OTHER) : "",
    otherRole: row && !known ? row.projectRole : "",
    override: row?.rateOverrideCents != null ? moneyInput(row.rateOverrideCents) : "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (x: Partial<typeof v>) => setV((s) => ({ ...s, ...x }));
  const choices = (p.edit?.people ?? []).filter((x) => !p.team.some((m) => m.membershipId === x.membershipId));

  function save() {
    const projectRole = v.role === OTHER ? v.otherRole : v.role;
    const override = v.override.trim() === "" ? null : parseMoney(v.override);
    if (p.canSetOverride && v.override.trim() !== "" && override === null)
      return setErrors({ billRateOverrideCents: "Enter an hourly rate" });
    startTransition(async () => {
      const r = await saveMember({
        id: row?.id ?? null,
        projectId: p.id,
        membershipId: v.membershipId,
        projectRole,
        // Only owners and admins send a rate (PMs never see the field).
        ...(p.canSetOverride ? { billRateOverrideCents: override } : {}),
      });
      if (!r.ok) return setErrors({ ...(r.fieldErrors ?? {}), ...(r.error ? { form: r.error } : {}) } as Record<string, string>);
      const name = row?.name ?? choices.find((c) => c.membershipId === v.membershipId)?.name ?? "Person";
      onSaved(row ? `${name} saved` : `${name} added`);
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={row ? `Edit ${row.name}` : "Add person"}
        footer={
          <>
            {errors.form && <span role="alert" className="mr-auto text-sm text-red">{errors.form}</span>}
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={pending} onClick={save}>
              {row ? "Save" : "Add person"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {!row && (
            <Select label="Person *" value={v.membershipId} error={errors.membershipId} onChange={(e) => set({ membershipId: e.target.value })}>
              <option value="">{choices.length ? "Choose…" : "Everyone is already on this project"}</option>
              {choices.map((c) => (
                <option key={c.membershipId} value={c.membershipId}>
                  {c.name}
                  {c.title ? ` · ${c.title}` : ""}
                </option>
              ))}
            </Select>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Select label="Project role *" value={v.role} error={v.role === OTHER ? undefined : errors.projectRole} onChange={(e) => set({ role: e.target.value })}>
              <option value="">Choose…</option>
              {PROJECT_ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
              <option value={OTHER}>Other…</option>
            </Select>
            {v.role === OTHER && (
              <Input label="Other role *" value={v.otherRole} maxLength={40} error={errors.projectRole} onChange={(e) => set({ otherRole: e.target.value })} />
            )}
          </div>
          {p.canSetOverride && (
            <Input
              label="Bill rate override ($/h)"
              hint="Leave blank to use their role's rate"
              value={v.override}
              inputMode="decimal"
              error={errors.billRateOverrideCents}
              onChange={(e) => set({ override: e.target.value })}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LinkDialog({
  projectId,
  choices,
  onClose,
  onSaved,
}: {
  projectId: string;
  choices: CompanyChoice[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState({ companyId: "", contactId: "", role: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (x: Partial<typeof v>) => setV((s) => ({ ...s, ...x }));
  const company = choices.find((c) => c.id === v.companyId);

  function save() {
    startTransition(async () => {
      const r = await addLink({ projectId, companyId: v.companyId, contactId: v.contactId || null, role: v.role });
      if (!r.ok) return setErrors({ ...(r.fieldErrors ?? {}), ...(r.error ? { form: r.error } : {}) } as Record<string, string>);
      onSaved(`${company?.name ?? "Company"} added`);
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Add company"
        description="A contractor, agency or vendor on this project. Consultants are added on Phases & fees."
        footer={
          <>
            {errors.form && <span role="alert" className="mr-auto text-sm text-red">{errors.form}</span>}
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={pending} onClick={save}>
              Add company
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Select label="Company *" value={v.companyId} error={errors.companyId} onChange={(e) => set({ companyId: e.target.value, contactId: "" })}>
            <option value="">{choices.length ? "Choose…" : "No contractors, agencies or vendors in Contacts yet"}</option>
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {KIND_LABELS[c.kind as CompanyKind]}
              </option>
            ))}
          </Select>
          <Select label="Contact" value={v.contactId} disabled={!company} error={errors.contactId} onChange={(e) => set({ contactId: e.target.value })}>
            <option value="">{company && company.contacts.length === 0 ? "No people at this company" : "Their billing contact"}</option>
            {company?.contacts.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          <Input
            label="Role on this project"
            placeholder="e.g. General contractor"
            value={v.role}
            maxLength={60}
            error={errors.role}
            onChange={(e) => set({ role: e.target.value })}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
