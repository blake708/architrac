"use client";

import { useMemo, useState, useTransition } from "react";
import { AddressFields } from "@/components/address/address-fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/field";
import type { ProjectStatus } from "@/lib/calc/projects";
import {
  PROJECT_MESSAGES,
  SCOPE_KINDS,
  SCOPE_LABELS,
  STANDARD_TYPES,
  STATUS_LABELS,
  type ScopeKind,
  moneyInput,
  parseMoney,
} from "@/lib/projects/form";
import { saveCompany } from "@/server/contacts/actions";

// The project's own fields, grouped (Blake, 2026-11-03): Project, Client,
// People, Site address, Size & schedule. Used by New project and Edit
// project so both ask the same things the same way.

export type ProjectDraft = {
  number: string;
  name: string;
  clientCompanyId: string;
  clientContactId: string;
  projectType: string;
  otherType: string;
  scopeKind: ScopeKind | "";
  status: ProjectStatus;
  principalMembershipId: string;
  pmMembershipId: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  squareFeet: string;
  construction: string;
  startDate: string;
  targetEndDate: string;
};

export const EMPTY_DRAFT: ProjectDraft = {
  number: "",
  name: "",
  clientCompanyId: "",
  clientContactId: "",
  projectType: "",
  otherType: "",
  scopeKind: "",
  status: "active",
  principalMembershipId: "",
  pmMembershipId: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  squareFeet: "",
  construction: "",
  startDate: "",
  targetEndDate: "",
};

export type FieldOptions = {
  clients: { id: string; name: string }[];
  contactsByClient: Record<string, { id: string; name: string }[]>;
  types: string[];
  principals: { membershipId: string; name: string }[];
  pms: { membershipId: string; name: string }[];
};

const OTHER = "__other";
const NEW_CLIENT = "__new";

/** A saved project → the form's text fields. */
export function draftFrom(p: {
  number: string;
  name: string;
  clientCompanyId: string;
  clientContactId: string | null;
  projectType: string;
  scopeKind: ScopeKind | null;
  status: ProjectStatus;
  principalMembershipId: string;
  pmMembershipId: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  squareFeet: number | null;
  constructionCostCents: number | null;
  startDate: string | null;
  targetEndDate: string | null;
}): ProjectDraft {
  return {
    number: p.number,
    name: p.name,
    clientCompanyId: p.clientCompanyId,
    clientContactId: p.clientContactId ?? "",
    projectType: p.projectType,
    otherType: "",
    scopeKind: p.scopeKind ?? "",
    status: p.status,
    principalMembershipId: p.principalMembershipId,
    pmMembershipId: p.pmMembershipId,
    addressLine1: p.addressLine1 ?? "",
    addressLine2: p.addressLine2 ?? "",
    city: p.city ?? "",
    state: p.state ?? "",
    postalCode: p.postalCode ?? "",
    squareFeet: p.squareFeet === null ? "" : String(p.squareFeet),
    construction: p.constructionCostCents === null ? "" : moneyInput(p.constructionCostCents),
    startDate: p.startDate ?? "",
    targetEndDate: p.targetEndDate ?? "",
  };
}

/** The form's text → what the server expects, plus problems found here. */
export function checkDraft(d: ProjectDraft) {
  const errors: Record<string, string> = {};
  const projectType = d.projectType === OTHER ? d.otherType.trim() : d.projectType;
  if (d.projectType === OTHER && (projectType.length < 1 || projectType.length > 60))
    errors.projectType = "Enter a type (up to 60 characters)";
  const construction = d.construction.trim() === "" ? null : parseMoney(d.construction);
  if (construction === null && d.construction.trim() !== "") errors.constructionCostCents = PROJECT_MESSAGES.money;
  const squareFeet = d.squareFeet.trim() === "" ? null : Number(d.squareFeet.replace(/,/g, ""));
  if (squareFeet !== null && !(Number.isInteger(squareFeet) && squareFeet > 0)) errors.squareFeet = PROJECT_MESSAGES.squareFeet;
  return {
    errors,
    fields: {
      number: d.number,
      name: d.name,
      clientCompanyId: d.clientCompanyId,
      clientContactId: d.clientContactId || null,
      projectType,
      scopeKind: d.scopeKind || null,
      status: d.status,
      principalMembershipId: d.principalMembershipId,
      pmMembershipId: d.pmMembershipId,
      addressLine1: d.addressLine1,
      addressLine2: d.addressLine2,
      city: d.city,
      state: d.state,
      postalCode: d.postalCode,
      squareFeet,
      constructionCostCents: construction,
      startDate: d.startDate,
      targetEndDate: d.targetEndDate,
    },
  };
}

export function ProjectFields({
  value: d,
  onChange: set,
  errors,
  options,
  statuses,
  addressLookup,
}: {
  value: ProjectDraft;
  onChange: (patch: Partial<ProjectDraft>) => void;
  errors: Record<string, string>;
  options: FieldOptions;
  statuses: readonly ProjectStatus[];
  addressLookup: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [clients, setClients] = useState(options.clients);
  const [newClient, setNewClient] = useState<{ open: boolean; name: string; error: string | null }>({
    open: false,
    name: "",
    error: null,
  });
  // The project's current type stays listed even if it's the firm's own.
  const types = useMemo(
    () =>
      [...new Set([...STANDARD_TYPES, ...options.types, ...(d.projectType && d.projectType !== OTHER ? [d.projectType] : [])])].sort((a, b) =>
        a.localeCompare(b),
      ),
    [options.types, d.projectType],
  );
  const contacts = d.clientCompanyId ? (options.contactsByClient[d.clientCompanyId] ?? []) : [];
  const { principals, pms } = options;
  const e = (k: string) => errors[k];

  function addClient() {
    const name = newClient.name.trim();
    if (!name) {
      setNewClient((x) => ({ ...x, error: "Enter a name" }));
      return;
    }
    startTransition(async () => {
      const r = await saveCompany({
        id: null,
        name,
        kind: "client",
        description: "",
        phone: "",
        website: "",
        addressLine1: "",
        addressLine2: "",
        city: "",
        state: "",
        postalCode: "",
        primaryContactId: null,
        billingContactId: null,
        notes: "",
      });
      if (!r.ok) {
        setNewClient((x) => ({ ...x, error: r.fieldErrors?.name ?? r.error ?? "Couldn't add the client." }));
        return;
      }
      setClients((c) => [...c, { id: r.data.id, name }].sort((a, b) => a.name.localeCompare(b.name)));
      set({ clientCompanyId: r.data.id, clientContactId: "" });
      setNewClient({ open: false, name: "", error: null });
    });
  }

  return (
    <>
        <fieldset className="m-0 border-0 p-0">
          <legend className="cap float-left mb-3 w-full text-xs font-semibold text-ink-2">Project</legend>
          <div className="clear-both grid grid-cols-1 gap-4 md:grid-cols-3">
            <Input label="Project number *" value={d.number} maxLength={20} onChange={(ev) => set({ number: ev.target.value })} error={e("number")} required />
          <Input label="Project name *" value={d.name} maxLength={200} onChange={(ev) => set({ name: ev.target.value })} error={e("name")} wrapperClassName="md:col-span-2" required />
          <Select label="Status" value={d.status} onChange={(ev) => set({ status: ev.target.value as ProjectStatus })}>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          <Select label="Project type *" value={d.projectType} error={d.projectType === OTHER ? undefined : e("projectType")} onChange={(ev) => set({ projectType: ev.target.value })}>
            <option value="">Choose a type…</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
            <option value={OTHER}>Other…</option>
          </Select>
          {d.projectType === OTHER && (
            <Input label="Other type *" value={d.otherType} maxLength={60} onChange={(ev) => set({ otherType: ev.target.value })} error={e("projectType")} />
          )}
          <Select label="Scope" value={d.scopeKind} onChange={(ev) => set({ scopeKind: ev.target.value as ScopeKind | "" })}>
            <option value="">—</option>
            {SCOPE_KINDS.map((s) => (
              <option key={s} value={s}>
                {SCOPE_LABELS[s]}
              </option>
            ))}
          </Select>
          </div>
        </fieldset>
        <fieldset className="m-0 mt-6 border-0 border-t border-line-soft p-0 pt-5">
          <legend className="cap float-left mb-3 w-full text-xs font-semibold text-ink-2">Client</legend>
          <div className="clear-both grid grid-cols-1 gap-4 md:grid-cols-2">
            <Select
            label="Client *"
            value={d.clientCompanyId}
            error={e("clientCompanyId")}
            onChange={(ev) => {
              if (ev.target.value === NEW_CLIENT) setNewClient({ open: true, name: "", error: null });
              else set({ clientCompanyId: ev.target.value, clientContactId: "" });
            }}
          >
            <option value="">Choose a client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value={NEW_CLIENT}>+ New client…</option>
          </Select>
          <Select
            label="Client contact"
            value={d.clientContactId}
            disabled={!d.clientCompanyId}
            error={e("clientContactId")}
            onChange={(ev) => set({ clientContactId: ev.target.value })}
          >
            <option value="">{d.clientCompanyId && contacts.length === 0 ? "No contacts at this client" : "None"}</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          </div>
        </fieldset>
        <fieldset className="m-0 mt-6 border-0 border-t border-line-soft p-0 pt-5">
          <legend className="cap float-left mb-3 w-full text-xs font-semibold text-ink-2">People</legend>
          <div className="clear-both grid grid-cols-1 gap-4 md:grid-cols-2">
            <Select label="Principal in charge *" value={d.principalMembershipId} error={e("principalMembershipId")} onChange={(ev) => set({ principalMembershipId: ev.target.value })}>
            <option value="">Choose…</option>
            {principals.map((p) => (
              <option key={p.membershipId} value={p.membershipId}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select label="Project manager *" value={d.pmMembershipId} error={e("pmMembershipId")} onChange={(ev) => set({ pmMembershipId: ev.target.value })}>
            <option value="">Choose…</option>
            {pms.map((p) => (
              <option key={p.membershipId} value={p.membershipId}>
                {p.name}
              </option>
            ))}
          </Select>
          </div>
        </fieldset>
        <fieldset className="m-0 mt-6 border-0 border-t border-line-soft p-0 pt-5">
          <legend className="cap float-left mb-3 w-full text-xs font-semibold text-ink-2">Site address</legend>
          <div className="clear-both">
            <AddressFields
              lookup={addressLookup}
              value={{ addressLine1: d.addressLine1, addressLine2: d.addressLine2, city: d.city, state: d.state, postalCode: d.postalCode }}
              onChange={(patch) => set(patch)}
              errors={{ addressLine1: e("addressLine1"), addressLine2: e("addressLine2"), city: e("city"), state: e("state"), postalCode: e("postalCode") }}
            />
          </div>
        </fieldset>
        <fieldset className="m-0 mt-6 border-0 border-t border-line-soft p-0 pt-5">
          <legend className="cap float-left mb-3 w-full text-xs font-semibold text-ink-2">Size & schedule</legend>
          <div className="clear-both grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input label="Square feet" value={d.squareFeet} inputMode="numeric" onChange={(ev) => set({ squareFeet: ev.target.value })} error={e("squareFeet")} />
          <Input label="Construction estimate" value={d.construction} inputMode="decimal" placeholder="$" onChange={(ev) => set({ construction: ev.target.value })} error={e("constructionCostCents")} />
          <Input label="Start date" type="date" value={d.startDate} onChange={(ev) => set({ startDate: ev.target.value })} error={e("startDate")} />
          <Input label="Target end" type="date" value={d.targetEndDate} onChange={(ev) => set({ targetEndDate: ev.target.value })} error={e("targetEndDate")} />
          </div>
        </fieldset>
      <Dialog open={newClient.open} onOpenChange={(o) => !o && setNewClient({ open: false, name: "", error: null })}>
        <DialogContent
          title="New client"
          footer={
            <>
              <Button type="button" onClick={() => setNewClient({ open: false, name: "", error: null })}>
                Cancel
              </Button>
              <Button type="button" variant="primary" disabled={pending} onClick={addClient}>
                Add client
              </Button>
            </>
          }
        >
          <Input
            label="Name"
            value={newClient.name}
            maxLength={200}
            error={newClient.error ?? undefined}
            onChange={(ev) => setNewClient((x) => ({ ...x, name: ev.target.value, error: null }))}
            onKeyDown={(ev) => {
              if (ev.key === "Enter") {
                ev.preventDefault();
                addClient();
              }
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
