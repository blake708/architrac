"use client";

import Link from "next/link";
import { Button, buttonClasses } from "@/components/ui/button";
import { Dialog, DrawerContent } from "@/components/ui/dialog";
import { addressLines, moneyCell, personName } from "@/lib/contacts/display";
import {
  CONTACT_MESSAGES,
  type CompanyKind,
  KIND_COLORS,
  KIND_LABELS,
  monogram,
  personInitials,
} from "@/lib/contacts/form";
import type { CompanyRow, ContactRow, ContactsView } from "@/server/contacts/view";

export function KindPill({ kind }: { kind: CompanyKind }) {
  const c = KIND_COLORS[kind];
  return (
    <span
      className="inline-flex h-[22px] items-center rounded-sm px-2 text-[10.5px] font-medium tracking-[0.07em] uppercase"
      style={{ background: c.bg, color: c.fg }}
    >
      {KIND_LABELS[kind]}
    </span>
  );
}

export function MonogramBadge({
  text,
  kind,
  round,
  size,
}: {
  text: string;
  kind: CompanyKind;
  round?: boolean;
  size: number;
}) {
  const c = KIND_COLORS[kind];
  return (
    <span
      aria-hidden="true"
      className="num inline-flex shrink-0 items-center justify-center text-xs font-semibold"
      style={{
        width: size,
        height: size,
        background: c.bg,
        color: c.fg,
        borderRadius: round ? 9999 : 2,
      }}
    >
      {text}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-3 border-b border-line-soft py-2.5 text-sm last:border-b-0">
      <dt className="cap text-2xs font-medium text-muted">{label}</dt>
      <dd className="m-0 min-w-0 break-words">{children}</dd>
    </div>
  );
}

const dash = <span className="text-muted">—</span>;

function Projects({ projects }: { projects: CompanyRow["projects"] }) {
  return (
    <section className="mt-6">
      <h3 className="cap m-0 mb-2 text-xs font-semibold">Projects</h3>
      {projects.length === 0 ? (
        <p className="m-0 text-sm text-muted">No projects yet</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
          {projects.map((p) => (
            <li key={p.id}>
              <Link href={`/app/projects/${p.id}`} className="text-blue underline">
                {p.name}
              </Link>{" "}
              <span className="text-muted">{p.note}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The company or person panel (contacts spec, Layout §6). */
export function ContactsDrawer({
  open,
  loading,
  view,
  company,
  contact,
  onClose,
  onEditCompany,
  onEditContact,
  onAddContact,
  onArchiveCompany,
  onArchiveContact,
}: {
  open: { type: "company" | "contact"; id: string } | null;
  /** Fresh data is on its way (just saved a new row). */
  loading: boolean;
  view: ContactsView;
  company: CompanyRow | null;
  contact: ContactRow | null;
  onClose: () => void;
  onEditCompany: (c: CompanyRow) => void;
  onEditContact: (p: ContactRow) => void;
  onAddContact: (companyId: string) => void;
  onArchiveCompany: (c: CompanyRow) => void;
  onArchiveContact: (p: ContactRow) => void;
}) {
  if (!open) return null;
  const byId = new Map(view.contacts.map((p) => [p.id, p]));

  if (open.type === "company") {
    if (!company)
      return (
        <Dialog open onOpenChange={(o) => !o && onClose()}>
          <DrawerContent title="Company" className="max-w-[440px]!">
            <p className="m-0 text-sm">{loading ? "Loading…" : CONTACT_MESSAGES.notFound}</p>
          </DrawerContent>
        </Dialog>
      );
    const c = company;
    const main = c.primaryContactId ? byId.get(c.primaryContactId) : undefined;
    const billing = c.billingContactId ? byId.get(c.billingContactId) : undefined;
    const copyOn = view.contacts.filter(
      (p) => p.companyId === c.id && p.tags.some((t) => t.toLowerCase() === "copy on letters"),
    ).length;
    const money = moneyCell(c);
    const address = addressLines(c);
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DrawerContent
          title={c.name}
          description={c.description ?? undefined}
          className="max-w-[440px]!"
          footer={
            <>
              {view.canArchive && (
                <Button variant="danger" className="mr-auto" onClick={() => onArchiveCompany(c)}>
                  Archive
                </Button>
              )}
              {view.canEdit && (
                <Button onClick={() => onEditCompany(c)}>Edit</Button>
              )}
              {view.canEdit &&
                (c.kind === "client" ? (
                  <Link href={`/app/projects/new?client=${c.id}`} className={buttonClasses("primary")}>
                    New project
                  </Link>
                ) : (
                  <Button variant="primary" onClick={() => onAddContact(c.id)}>
                    Add contact
                  </Button>
                ))}
            </>
          }
        >
          <div className="mb-4 flex items-center gap-3">
            <MonogramBadge text={monogram(c.name)} kind={c.kind} size={48} />
            <KindPill kind={c.kind} />
          </div>
          <dl className="m-0">
            <Row label="Address">{address.length ? address.map((l) => <div key={l}>{l}</div>) : dash}</Row>
            <Row label="Phone">{c.phone ?? dash}</Row>
            <Row label="Website">
              {c.website ? (
                <a href={c.website} target="_blank" rel="noreferrer" className="text-blue underline">
                  {c.website.replace(/^https?:\/\//, "")}
                </a>
              ) : (
                dash
              )}
            </Row>
            <Row label="Main contact">{main ? personName(main) : dash}</Row>
            {c.kind === "client" && (
              <Row label="Billing contact">
                {billing ? (
                  <>
                    {personName(billing)}
                    {billing.email && <div className="text-xs text-muted">{billing.email}</div>}
                  </>
                ) : null}
                {c.missingBilling && (
                  <div className="text-orange-strong">◆ {billing ? "Billing contact has no email" : "No billing contact"}</div>
                )}
              </Row>
            )}
            <Row label="Copy on letters">{copyOn > 0 ? `${copyOn} ${copyOn === 1 ? "person" : "people"}` : dash}</Row>
            {c.money !== undefined && (
              <Row label={c.kind === "consultant" ? "Fees" : "Billed"}>
                {money ? (
                  <>
                    <span className="num">{money.main}</span>
                    <div className={money.open ? "text-orange-strong" : "text-muted"}>{money.note}</div>
                  </>
                ) : (
                  dash
                )}
              </Row>
            )}
            {c.quickbooksLinked !== undefined && (
              <Row label="QuickBooks">{c.quickbooksLinked ? "Linked" : "Not linked"}</Row>
            )}
            <Row label="Notes">{c.notes ? <span className="whitespace-pre-wrap">{c.notes}</span> : dash}</Row>
          </dl>
          <Projects projects={c.projects} />
        </DrawerContent>
      </Dialog>
    );
  }

  if (!contact)
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DrawerContent title="Contact" className="max-w-[440px]!">
          <p className="m-0 text-sm">{loading ? "Loading…" : CONTACT_MESSAGES.contactNotFound}</p>
        </DrawerContent>
      </Dialog>
    );
  const p = contact;
  const company2 = p.companyId ? view.companies.find((x) => x.id === p.companyId) : undefined;
  const companyName = company2?.name ?? (p.companyId ? view.archivedCompanyNames[p.companyId] : undefined);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DrawerContent
        title={personName(p)}
        description={p.title ?? undefined}
        className="max-w-[440px]!"
        footer={
          <>
            {view.canArchive && (
              <Button variant="danger" className="mr-auto" onClick={() => onArchiveContact(p)}>
                Archive
              </Button>
            )}
            {view.canEdit && <Button onClick={() => onEditContact(p)}>Edit</Button>}
            {p.email ? (
              <a href={`mailto:${p.email}`} className={buttonClasses("primary")}>
                Send email
              </a>
            ) : (
              <Button variant="primary" disabled title="No email on file">
                Send email
              </Button>
            )}
          </>
        }
      >
        <div className="mb-4 flex items-center gap-3">
          <MonogramBadge text={personInitials(p.firstName, p.lastName)} kind={company2?.kind ?? "vendor"} round size={48} />
          {company2 && <KindPill kind={company2.kind} />}
        </div>
        <dl className="m-0">
          <Row label="Email">
            {p.email ? (
              <a href={`mailto:${p.email}`} className="text-blue underline">
                {p.email}
              </a>
            ) : (
              dash
            )}
          </Row>
          <Row label="Phone">{p.phone ?? dash}</Row>
          <Row label="Mobile">{p.mobile ?? dash}</Row>
          <Row label="Company">
            {companyName ? (
              <>
                {companyName}
                {p.companyArchived && <span className="text-muted"> (archived company)</span>}
              </>
            ) : (
              dash
            )}
          </Row>
          <Row label="Tags">{p.tags.length ? p.tags.join(", ") : dash}</Row>
          <Row label="Notes">{p.notes ? <span className="whitespace-pre-wrap">{p.notes}</span> : dash}</Row>
        </dl>
        <Projects projects={company2?.projects ?? []} />
      </DrawerContent>
    </Dialog>
  );
}
