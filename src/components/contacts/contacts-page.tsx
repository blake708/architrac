"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { PlusIcon, SearchIcon } from "@/components/ui/icons";
import { KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import {
  type KindFilter,
  filterCompanies,
  filterPeople,
  moneyCell,
  personName,
} from "@/lib/contacts/display";
import {
  COMPANY_KINDS,
  KIND_FILTER_LABELS,
  monogram,
  personInitials,
} from "@/lib/contacts/form";
import { formatMoney } from "@/lib/format";
import { archiveCompany, archiveContact } from "@/server/contacts/actions";
import type { CompanyRow, ContactRow, ContactsView } from "@/server/contacts/view";
import { CompanyDialog, ContactDialog } from "./contact-forms";
import { ContactsDrawer, KindPill, MonogramBadge } from "./contacts-drawer";

export type ContactsParams = {
  tab: "companies" | "people";
  kind: KindFilter;
  q: string;
  company: string | null;
  contact: string | null;
};

const th =
  "border-b border-line px-2.5 py-2.5 text-2xs font-medium whitespace-nowrap text-muted first:pl-[18px] last:pr-[18px] text-left";

/** The Contacts page (contacts spec). */
export function ContactsPage({
  view,
  initial,
  addressLookup,
}: {
  view: ContactsView;
  initial: ContactsParams;
  /** Google address lookup is set up. */
  addressLookup: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState(initial.tab);
  const [kind, setKind] = useState<KindFilter>(initial.kind);
  const [q, setQ] = useState(initial.q);
  const [debounced, setDebounced] = useState(initial.q);
  const [open, setOpen] = useState<{ type: "company" | "contact"; id: string } | null>(
    initial.company
      ? { type: "company", id: initial.company }
      : initial.contact
        ? { type: "contact", id: initial.contact }
        : null,
  );
  const [companyForm, setCompanyForm] = useState<{ open: boolean; company: CompanyRow | null }>({ open: false, company: null });
  const [contactForm, setContactForm] = useState<{ open: boolean; contact: ContactRow | null; preset: string | null }>({
    open: false,
    contact: null,
    preset: null,
  });
  const [confirm, setConfirm] = useState<
    { type: "company"; row: CompanyRow } | { type: "contact"; row: ContactRow } | null
  >(null);
  const [pending, startTransition] = useTransition();
  /** True while fresh data loads after a save (a new row isn't in the list yet). */
  const [refreshing, startRefresh] = useTransition();

  // Search waits 250 ms after typing (spec, Search).
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  // Tab, filter, search and the open panel live in the address.
  useEffect(() => {
    const sp = new URLSearchParams();
    if (tab !== "companies") sp.set("tab", tab);
    if (kind !== "all") sp.set("kind", kind);
    if (debounced) sp.set("q", debounced);
    if (open) sp.set(open.type, open.id);
    const qs = sp.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [tab, kind, debounced, open]);

  const companyById = useMemo(() => new Map(view.companies.map((c) => [c.id, c])), [view.companies]);
  const contactById = useMemo(() => new Map(view.contacts.map((p) => [p.id, p])), [view.contacts]);
  const companies = useMemo(
    () => filterCompanies(view.companies, view.contacts, debounced, kind),
    [view.companies, view.contacts, debounced, kind],
  );
  const people = useMemo(
    () => filterPeople(view.contacts, companyById, debounced, kind),
    [view.contacts, companyById, debounced, kind],
  );
  const kindsShown = COMPANY_KINDS.filter(
    (k) => k !== "other" || view.companies.some((c) => c.kind === "other"),
  );

  function done(message: string) {
    toast(message);
    startRefresh(() => router.refresh());
  }
  function runArchive() {
    if (!confirm) return;
    const c = confirm;
    startTransition(async () => {
      const result =
        c.type === "company" ? await archiveCompany(c.row.id) : await archiveContact(c.row.id);
      setConfirm(null);
      if (!result.ok) {
        toast(result.error ?? "Couldn't archive.", "error");
        return;
      }
      setOpen(null);
      done(`${result.data.name} archived`);
    });
  }

  const tabButton = (key: "companies" | "people", label: string, count: number) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === key}
      onClick={() => {
        setTab(key);
        setOpen(null);
      }}
      className={cn(
        "-mb-px cursor-pointer border-0 border-b-2 bg-transparent px-1 pb-2.5 text-base",
        tab === key ? "border-ink font-semibold text-ink" : "border-transparent text-ink-3 hover:text-ink",
      )}
    >
      {label} <span className="num text-xs text-muted">{count}</span>
    </button>
  );

  const shown = tab === "companies" ? companies.length : people.length;
  const empty = view.companies.length === 0 && view.contacts.length === 0;

  return (
    <main>
      <PageHeader
        eyebrow="CLIENTS · CONSULTANTS · CONTRACTORS · AGENCIES"
        title="Contacts"
        actions={
          view.canEdit && (
            <>
              <Button onClick={() => setCompanyForm({ open: true, company: null })}>New company</Button>
              <Button
                variant="primary"
                icon={<PlusIcon />}
                onClick={() => setContactForm({ open: true, contact: null, preset: null })}
              >
                New contact
              </Button>
            </>
          )
        }
      />
      <div className="flex flex-col gap-5 px-4 pt-6 pb-8 md:px-page-x">
        <section aria-label="Contacts summary" className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
          <KpiTile
            label="Companies"
            value={view.kpis.companies}
            note={`${view.kpis.clients} ${view.kpis.clients === 1 ? "client" : "clients"} · ${view.kpis.consultants} ${view.kpis.consultants === 1 ? "consultant" : "consultants"}`}
          />
          <KpiTile label="People" value={view.kpis.people} note="Across all companies" />
          {view.kpis.openClients !== undefined && (
            <KpiTile
              label="Clients with open balances"
              value={view.kpis.openClients}
              note={`${formatMoney(view.kpis.openCents ?? 0)} outstanding`}
            />
          )}
          <KpiTile
            label="Missing billing contact"
            value={view.kpis.missingBilling}
            tone={view.kpis.missingBilling > 0 ? "orange" : "default"}
            note="Invoices to these clients can't be emailed"
          />
        </section>

        <div role="tablist" aria-label="Contact views" className="flex gap-6 border-b border-line">
          {tabButton("companies", "Companies", view.companies.length)}
          {tabButton("people", "People", view.contacts.length)}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="relative flex-[0_1_300px]">
            <span className="sr-only">Search</span>
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={q}
              placeholder={tab === "companies" ? "Search companies" : "Search people, titles or tags"}
              onChange={(e) => setQ(e.target.value)}
              className="h-[var(--height-control)] w-full rounded-sm border border-line-input bg-surface pr-2.5 pl-8 text-base focus:outline-2 focus:-outline-offset-1 focus:outline-blue"
            />
          </label>
          <div role="group" aria-label="Filter by type" className="flex flex-wrap gap-1">
            {(["all", ...kindsShown] as KindFilter[]).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                className={cn(
                  "h-8 cursor-pointer rounded-sm border px-3 text-sm",
                  kind === k ? "border-ink bg-ink text-white" : "border-line-input bg-surface text-ink hover:bg-surface-2",
                )}
              >
                {k === "all" ? "All" : KIND_FILTER_LABELS[k]}
              </button>
            ))}
          </div>
          <span className="num ml-auto text-xs text-muted" data-testid="shown-note">
            {shown} {tab === "companies" ? "companies" : "people"} shown
          </span>
        </div>

        {empty ? (
          <div className="rounded-sm border border-line bg-surface px-5 py-8 text-center">
            <p className="m-0 text-sm text-muted">No contacts yet. Add your first client or consultant.</p>
            {view.canEdit && (
              <Button variant="primary" className="mt-3" onClick={() => setCompanyForm({ open: true, company: null })}>
                New company
              </Button>
            )}
          </div>
        ) : shown === 0 ? (
          <div className="rounded-sm border border-line bg-surface px-5 py-8 text-center">
            <p className="m-0 text-sm text-muted">
              {debounced.trim()
                ? `No ${tab} match “${debounced.trim()}”`
                : `No ${tab} of this type`}
            </p>
            <Button
              className="mt-3"
              onClick={() => {
                setQ("");
                setDebounced("");
                setKind("all");
              }}
            >
              Clear search and filters
            </Button>
          </div>
        ) : tab === "companies" ? (
          <div className="overflow-x-auto rounded-sm border border-line bg-surface">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead className="bg-surface-2">
                <tr>
                  <th scope="col" className={th}>Company</th>
                  <th scope="col" className={th}>Type</th>
                  <th scope="col" className={th}>Main contact</th>
                  <th scope="col" className={cn(th, "text-right")}>Projects</th>
                  {view.seesMoney && <th scope="col" className={cn(th, "text-right")}>Billed / fees</th>}
                  <th scope="col" className={th}>Billing</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => {
                  const main = c.primaryContactId ? contactById.get(c.primaryContactId) : undefined;
                  const billing = c.billingContactId ? contactById.get(c.billingContactId) : undefined;
                  const money = moneyCell(c);
                  const selected = open?.type === "company" && open.id === c.id;
                  return (
                    <tr
                      key={c.id}
                      data-company={c.name}
                      onClick={() => setOpen({ type: "company", id: c.id })}
                      className={cn(
                        "cursor-pointer border-b border-line-soft last:border-b-0 hover:bg-surface-2",
                        selected && "bg-[#EAF0FB] hover:bg-[#EAF0FB]",
                      )}
                    >
                      <td className="py-2.5 pr-2.5 pl-[18px]">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpen({ type: "company", id: c.id });
                          }}
                          className="flex cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left focus-visible:outline-2 focus-visible:outline-blue"
                        >
                          <MonogramBadge text={monogram(c.name)} kind={c.kind} size={38} />
                          <span className="min-w-0">
                            <span className="block font-medium">{c.name}</span>
                            {c.description && <span className="block text-xs text-muted">{c.description}</span>}
                          </span>
                        </button>
                      </td>
                      <td className="px-2.5 py-2.5"><KindPill kind={c.kind} /></td>
                      <td className="px-2.5 py-2.5">
                        {main ? (
                          <>
                            {personName(main)}
                            {main.title && <span className="block text-xs text-muted">{main.title}</span>}
                          </>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="num px-2.5 py-2.5 text-right text-[12.5px]">{c.projects.length}</td>
                      {view.seesMoney && (
                        <td className="num px-2.5 py-2.5 text-right text-[12.5px]">
                          {money ? (
                            <>
                              {money.main}
                              <span className={cn("block text-xs", money.open ? "text-orange-strong" : "text-muted")}>
                                {money.note}
                              </span>
                            </>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                      )}
                      <td className="py-2.5 pr-[18px] pl-2.5">
                        {c.kind !== "client" ? (
                          <span className="text-muted">—</span>
                        ) : c.missingBilling ? (
                          <span className="text-orange-strong">◆ No billing contact</span>
                        ) : (
                          <>
                            {billing && personName(billing)}
                            {c.billingEmail && <div className="text-xs text-muted">{c.billingEmail}</div>}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-sm border border-line bg-surface">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead className="bg-surface-2">
                <tr>
                  {["Person", "Company", "Type", "Contact", "Tags"].map((h) => (
                    <th key={h} scope="col" className={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {people.map((p) => {
                  const co = p.companyId ? companyById.get(p.companyId) : undefined;
                  const coName = co?.name ?? (p.companyId ? view.archivedCompanyNames[p.companyId] : undefined);
                  const selected = open?.type === "contact" && open.id === p.id;
                  return (
                    <tr
                      key={p.id}
                      data-contact={personName(p)}
                      onClick={() => setOpen({ type: "contact", id: p.id })}
                      className={cn(
                        "cursor-pointer border-b border-line-soft last:border-b-0 hover:bg-surface-2",
                        selected && "bg-[#EAF0FB] hover:bg-[#EAF0FB]",
                      )}
                    >
                      <td className="py-2.5 pr-2.5 pl-[18px]">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpen({ type: "contact", id: p.id });
                          }}
                          className="flex cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left focus-visible:outline-2 focus-visible:outline-blue"
                        >
                          <MonogramBadge text={personInitials(p.firstName, p.lastName)} kind={co?.kind ?? "vendor"} round size={36} />
                          <span className="min-w-0">
                            <span className="block font-medium">{personName(p)}</span>
                            {p.title && <span className="block text-xs text-muted">{p.title}</span>}
                          </span>
                        </button>
                      </td>
                      <td className="px-2.5 py-2.5">
                        {coName ?? <span className="text-muted">—</span>}
                        {p.companyArchived && <span className="block text-xs text-muted">(archived company)</span>}
                      </td>
                      <td className="px-2.5 py-2.5">{co ? <KindPill kind={co.kind} /> : <span className="text-muted">—</span>}</td>
                      <td className="num px-2.5 py-2.5 text-xs">
                        {p.email ?? <span className="text-muted">—</span>}
                        {(p.phone ?? p.mobile) && <span className="block text-muted">{p.phone ?? p.mobile}</span>}
                      </td>
                      <td className="py-2.5 pr-[18px] pl-2.5">
                        <span className="flex flex-wrap gap-1">
                          {p.tags.map((t) => (
                            <span key={t} className="inline-flex h-[22px] items-center rounded-sm bg-line-soft px-2 text-xs text-ink-3">
                              {t}
                            </span>
                          ))}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ContactsDrawer
        open={open}
        loading={refreshing}
        view={view}
        company={open?.type === "company" ? (companyById.get(open.id) ?? null) : null}
        contact={open?.type === "contact" ? (contactById.get(open.id) ?? null) : null}
        onClose={() => setOpen(null)}
        onEditCompany={(c) => setCompanyForm({ open: true, company: c })}
        onEditContact={(p) => setContactForm({ open: true, contact: p, preset: null })}
        onAddContact={(id) => setContactForm({ open: true, contact: null, preset: id })}
        onOpenContact={(p) => setOpen({ type: "contact", id: p.id })}
        onArchiveCompany={(c) => setConfirm({ type: "company", row: c })}
        onArchiveContact={(p) => setConfirm({ type: "contact", row: p })}
      />
      <CompanyDialog
        open={companyForm.open}
        company={companyForm.company}
        companies={view.companies}
        people={view.contacts}
        addressLookup={addressLookup}
        onClose={() => setCompanyForm({ open: false, company: null })}
        onSaved={(id, message) => {
          setCompanyForm({ open: false, company: null });
          setTab("companies");
          setOpen({ type: "company", id });
          done(message);
        }}
      />
      <ContactDialog
        open={contactForm.open}
        contact={contactForm.contact}
        presetCompanyId={contactForm.preset}
        companies={view.companies}
        people={view.contacts}
        onClose={() => setContactForm({ open: false, contact: null, preset: null })}
        onSaved={(id, message) => {
          const fromCompany = contactForm.preset;
          setContactForm({ open: false, contact: null, preset: null });
          // Added from a company panel: go back to that company's People list.
          if (fromCompany) setOpen({ type: "company", id: fromCompany });
          else {
            setTab("people");
            setOpen({ type: "contact", id });
          }
          done(message);
        }}
      />
      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        {confirm && (
          <DialogContent
            title={`Archive ${confirm.type === "company" ? confirm.row.name : personName(confirm.row)}?`}
            footer={
              <>
                <Button onClick={() => setConfirm(null)}>Cancel</Button>
                <Button variant="danger" disabled={pending} onClick={runArchive}>
                  Archive
                </Button>
              </>
            }
          >
            <p className="m-0 text-base">
              {confirm.type === "company"
                ? "It disappears from Contacts. Its people stay, marked “(archived company)”. Nothing is deleted."
                : "They disappear from Contacts. Nothing is deleted."}
            </p>
          </DialogContent>
        )}
      </Dialog>
    </main>
  );
}
