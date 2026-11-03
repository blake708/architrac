"use client";

import { useId, useState, useTransition } from "react";
import { AddressFields } from "@/components/address/address-fields";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Select, Textarea, controlClasses } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { personName } from "@/lib/contacts/display";
import {
  COMPANY_KINDS,
  type CompanyKind,
  KIND_LABELS,
  TAG_SUGGESTIONS,
  normalizeWebsite,
} from "@/lib/contacts/form";
import { saveCompany, saveContact } from "@/server/contacts/actions";
import type { CompanyRow, ContactRow } from "@/server/contacts/view";

type Errors = Record<string, string | undefined>;
const ZIP = /^\d{5}(-\d{4})?$/;

function Warning({ children }: { children: React.ReactNode }) {
  return <p className="m-0 -mt-2 text-[12.5px] text-orange-strong">{children}</p>;
}

// ---------- Company ----------

/** New company / Edit company (contacts spec, Company form fields). */
export function CompanyDialog({
  open,
  company,
  companies,
  people,
  addressLookup,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** Null = New company. */
  company: CompanyRow | null;
  companies: CompanyRow[];
  people: ContactRow[];
  /** Google address lookup is set up. */
  addressLookup: boolean;
  onClose: () => void;
  onSaved: (id: string, message: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {open && (
        <CompanyBody
          key={company?.id ?? "new"}
          company={company}
          companies={companies}
          people={people}
          addressLookup={addressLookup}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
    </Dialog>
  );
}

function CompanyBody({
  company,
  companies,
  people,
  addressLookup,
  onClose,
  onSaved,
}: {
  company: CompanyRow | null;
  companies: CompanyRow[];
  people: ContactRow[];
  addressLookup: boolean;
  onClose: () => void;
  onSaved: (id: string, message: string) => void;
}) {
  const [v, setV] = useState({
    name: company?.name ?? "",
    kind: (company?.kind ?? "client") as CompanyKind,
    description: company?.description ?? "",
    phone: company?.phone ?? "",
    website: company?.website ?? "",
    addressLine1: company?.addressLine1 ?? "",
    addressLine2: company?.addressLine2 ?? "",
    city: company?.city ?? "",
    state: company?.state ?? "",
    postalCode: company?.postalCode ?? "",
    primaryContactId: company?.primaryContactId ?? "",
    billingContactId: company?.billingContactId ?? "",
    notes: company?.notes ?? "",
  });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (patch: Partial<typeof v>) => setV((x) => ({ ...x, ...patch }));

  const staff = company ? people.filter((p) => p.companyId === company.id) : [];
  const duplicate = companies.find(
    (c) => c.id !== company?.id && c.name.trim().toLowerCase() === v.name.trim().toLowerCase(),
  );
  // Checked as you type, so Save waits for a valid ZIP and website.
  const zipBad = v.postalCode.trim() !== "" && !ZIP.test(v.postalCode.trim());
  const webBad = normalizeWebsite(v.website) === null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (zipBad || webBad) return;
    setFormError(null);
    startTransition(async () => {
      const result = await saveCompany({
        id: company?.id ?? null,
        ...v,
        primaryContactId: v.primaryContactId || null,
        billingContactId: v.kind === "client" ? v.billingContactId || null : null,
      });
      if (!result.ok) {
        setErrors((result.fieldErrors ?? {}) as Errors);
        setFormError(result.error ?? null);
        return;
      }
      onSaved(result.data.id, company ? `${v.name.trim()} saved` : `${v.name.trim()} added`);
    });
  }

  return (
    <DialogContent
      title={company ? "Edit company" : "New company"}
      className="max-w-[640px]!"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            type="submit"
            form="company-form"
            disabled={pending || zipBad || webBad}
          >
            {pending ? "Saving…" : company ? "Save company" : "Add company"}
          </Button>
        </>
      }
    >
      <form id="company-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {formError && (
          <p role="alert" className="m-0 text-[12.5px] text-red">
            {formError}
          </p>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_180px]">
          <Input label="Name" autoFocus maxLength={200} value={v.name} onChange={(e) => set({ name: e.target.value })} error={errors.name} />
          <Select label="Type" value={v.kind} onChange={(e) => set({ kind: e.target.value as CompanyKind })}>
            {COMPANY_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        </div>
        {duplicate && <Warning>A company named {duplicate.name} already exists. You can still save.</Warning>}
        <Input label="Description" maxLength={200} placeholder="e.g. Medical developer" value={v.description} onChange={(e) => set({ description: e.target.value })} error={errors.description} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Phone" type="tel" value={v.phone} onChange={(e) => set({ phone: e.target.value })} error={errors.phone} />
          <Input label="Website" value={v.website} onChange={(e) => set({ website: e.target.value })} error={webBad ? "Enter a website like www.example.com" : errors.website} />
        </div>
        <AddressFields
          lookup={addressLookup}
          streetLabel="Address"
          value={{ addressLine1: v.addressLine1, addressLine2: v.addressLine2, city: v.city, state: v.state, postalCode: v.postalCode }}
          onChange={(patch) => set(patch.state === undefined ? patch : { ...patch, state: patch.state.toUpperCase() })}
          errors={{ state: errors.state, postalCode: zipBad ? "Enter a 5-digit ZIP or ZIP+4" : errors.postalCode }}
        />
        {company ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select label="Main contact" value={v.primaryContactId} onChange={(e) => set({ primaryContactId: e.target.value })} error={errors.primaryContactId}>
              <option value="">None</option>
              {staff.map((p) => (
                <option key={p.id} value={p.id}>
                  {personName(p)}
                </option>
              ))}
            </Select>
            {v.kind === "client" && (
              <Select
                label="Billing contact"
                value={v.billingContactId}
                onChange={(e) => set({ billingContactId: e.target.value })}
                error={errors.billingContactId}
                hint="Invoices are emailed here"
              >
                <option value="">None</option>
                {staff.map((p) => (
                  <option key={p.id} value={p.id}>
                    {personName(p)}
                  </option>
                ))}
              </Select>
            )}
          </div>
        ) : (
          <p className="m-0 text-[12.5px] text-muted">Add people, then set the main and billing contact.</p>
        )}
        <Textarea label="Notes" rows={3} value={v.notes} onChange={(e) => set({ notes: e.target.value })} />
      </form>
    </DialogContent>
  );
}

// ---------- Contact ----------

/** Tags: chips plus an input with suggestions. Enter or comma adds. */
function TagInput({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  function add(raw: string) {
    const t = raw.trim();
    if (!t) return;
    if (t.length > 30) return setError("Tags can be up to 30 characters");
    if (tags.some((x) => x.toLowerCase() === t.toLowerCase())) return setError("Already added");
    onChange([...tags, t]);
    setDraft("");
    setError(null);
  }
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="cap text-xs font-medium text-muted">
        Tags
      </label>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((t) => (
          <Chip key={t} label={t} onRemove={() => onChange(tags.filter((x) => x !== t))} />
        ))}
        <input
          id={id}
          list={`${id}-suggest`}
          value={draft}
          placeholder="Add a tag…"
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(draft);
            }
          }}
          onBlur={() => add(draft)}
          className={cn(controlClasses, "h-7 w-[170px]! text-sm")}
        />
        <datalist id={`${id}-suggest`}>
          {TAG_SUGGESTIONS.filter((s) => !tags.includes(s)).map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>
      {error && <p className="m-0 text-xs text-red">{error}</p>}
    </div>
  );
}

/** New contact / Edit contact (contacts spec, Contact form fields). */
export function ContactDialog({
  open,
  contact,
  presetCompanyId,
  companies,
  people,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** Null = New contact. */
  contact: ContactRow | null;
  /** "Add contact" from a company panel. */
  presetCompanyId: string | null;
  companies: CompanyRow[];
  people: ContactRow[];
  onClose: () => void;
  onSaved: (id: string, message: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {open && (
        <ContactBody
          key={contact?.id ?? `new-${presetCompanyId ?? ""}`}
          contact={contact}
          presetCompanyId={presetCompanyId}
          companies={companies}
          people={people}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
    </Dialog>
  );
}

function ContactBody({
  contact,
  presetCompanyId,
  companies,
  people,
  onClose,
  onSaved,
}: {
  contact: ContactRow | null;
  presetCompanyId: string | null;
  companies: CompanyRow[];
  people: ContactRow[];
  onClose: () => void;
  onSaved: (id: string, message: string) => void;
}) {
  const startCompany = contact?.companyId ?? presetCompanyId ?? "";
  const startCo = companies.find((c) => c.id === startCompany);
  const [v, setV] = useState({
    firstName: contact?.firstName ?? "",
    lastName: contact?.lastName ?? "",
    designations: contact?.designations ?? "",
    title: contact?.title ?? "",
    companyId: startCompany,
    email: contact?.email ?? "",
    phone: contact?.phone ?? "",
    mobile: contact?.mobile ?? "",
    tags: contact?.tags ?? [],
    notes: contact?.notes ?? "",
    isMain: Boolean(contact && startCo?.primaryContactId === contact.id),
    isBilling: Boolean(contact && startCo?.billingContactId === contact.id),
  });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (patch: Partial<typeof v>) => setV((x) => ({ ...x, ...patch }));

  const company = companies.find((c) => c.id === v.companyId);
  const email = v.email.trim().toLowerCase();
  const duplicate =
    email !== "" &&
    people.find((p) => p.id !== contact?.id && p.email?.toLowerCase() === email);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    startTransition(async () => {
      const result = await saveContact({
        id: contact?.id ?? null,
        ...v,
        companyId: v.companyId || null,
        isMain: Boolean(company) && v.isMain,
        isBilling: company?.kind === "client" && v.isBilling,
      });
      if (!result.ok) {
        setErrors((result.fieldErrors ?? {}) as Errors);
        setFormError(result.error ?? null);
        return;
      }
      const name = `${v.firstName} ${v.lastName}`.trim();
      onSaved(result.data.id, contact ? `${name} saved` : `${name} added`);
    });
  }

  return (
    <DialogContent
      title={contact ? "Edit contact" : "New contact"}
      className="max-w-[640px]!"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="contact-form" disabled={pending}>
            {pending ? "Saving…" : contact ? "Save contact" : "Add contact"}
          </Button>
        </>
      }
    >
      <form id="contact-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {formError && (
          <p role="alert" className="m-0 text-[12.5px] text-red">
            {formError}
          </p>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr_110px]">
          <Input label="First name" autoFocus maxLength={100} value={v.firstName} onChange={(e) => set({ firstName: e.target.value })} error={errors.firstName} />
          <Input label="Last name" maxLength={100} value={v.lastName} onChange={(e) => set({ lastName: e.target.value })} error={errors.lastName} />
          <Input label="Designations" maxLength={40} placeholder="PE" value={v.designations} onChange={(e) => set({ designations: e.target.value })} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Title" maxLength={100} value={v.title} onChange={(e) => set({ title: e.target.value })} />
          <Select label="Company" value={v.companyId} onChange={(e) => set({ companyId: e.target.value, isMain: false, isBilling: false })} error={errors.companyId}>
            <option value="">No company</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        {company && (
          <div className="-mt-1 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={v.isMain} onChange={(e) => set({ isMain: e.target.checked })} className="size-4 accent-ink" />
              Main contact for {company.name}
            </label>
            {company.kind === "client" && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={v.isBilling} onChange={(e) => set({ isBilling: e.target.checked })} className="size-4 accent-ink" />
                Billing contact for {company.name}
              </label>
            )}
          </div>
        )}
        <Input label="Email" type="email" value={v.email} onChange={(e) => set({ email: e.target.value })} error={errors.email} />
        {duplicate && (
          <Warning>
            {personName(duplicate)} already has this email. You can still save.
          </Warning>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Phone" type="tel" value={v.phone} onChange={(e) => set({ phone: e.target.value })} />
          <Input label="Mobile" type="tel" value={v.mobile} onChange={(e) => set({ mobile: e.target.value })} />
        </div>
        <TagInput tags={v.tags} onChange={(tags) => set({ tags })} />
        <Textarea label="Notes" rows={3} value={v.notes} onChange={(e) => set({ notes: e.target.value })} />
      </form>
    </DialogContent>
  );
}
