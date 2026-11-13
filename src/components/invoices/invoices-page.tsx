"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ErrorBanner } from "@/components/settings/error-banner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/field";
import { SearchIcon } from "@/components/ui/icons";
import { HeaderKpis, KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader } from "@/components/ui/page-header";
import { headerTabBarClasses, tabClasses, tabCountClasses, tabRowClasses } from "@/components/ui/tab-styles";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { type AgingBucket, agingBucket } from "@/lib/calc/invoice";
import { money } from "@/lib/calc/invoice-plan";
import { INVOICE_TABS, type InvoiceTab, OVER_60, agingTotals, inTab, isOpen, tabCounts } from "@/lib/calc/receivables";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { createDraftInvoice } from "@/server/invoices/actions";
import type { BillableProject, InvoiceListRow, InvoicesPageData } from "@/server/invoices/list";
import { AgingBar } from "./aging-bar";
import { AgingBadge, StatusBadge } from "./invoice-bits";
import { type PayableInvoice, RecordPaymentDialog } from "./record-payment-dialog";

/**
 * The Invoices page (invoicing spec Layout A, the mockup's Receivables tab):
 * KPI tiles that filter, status tabs, the aging bar, and the list. The only
 * place an invoice is started (decision #29).
 */
export function InvoicesPage({ data }: { data: InvoicesPageData }) {
  const { rows, projects, kpis, today } = data;
  const router = useRouter();
  const toast = useToast();
  const [picking, setPicking] = useState(false);
  const [paying, setPaying] = useState(false);
  const [tab, setTab] = useState<InvoiceTab>("open");
  const [buckets, setBuckets] = useState<readonly AgingBucket[]>([]);
  const [search, setSearch] = useState("");
  const [projectId, setProjectId] = useState("");
  const [clientId, setClientId] = useState("");

  const counts = useMemo(() => tabCounts(rows), [rows]);
  const aging = useMemo(() => agingTotals(rows, today), [rows, today]);
  const payable: PayableInvoice[] = useMemo(
    () =>
      rows
        .filter((r) => isOpen(r.status) && r.balanceCents > 0)
        .map((r) => ({ id: r.id, number: r.number ?? "", client: r.client.name, balanceCents: r.balanceCents })),
    [rows],
  );
  const projectOptions = useMemo(() => unique(rows.map((r) => [r.project.id, `${r.project.number} ${r.project.name}`])), [rows]);
  const clientOptions = useMemo(() => unique(rows.map((r) => [r.client.id, r.client.name])), [rows]);

  const shown = useMemo(() => {
    const t = search.trim().toLowerCase();
    const list = rows.filter(
      (r) =>
        inTab(r.status, tab) &&
        (buckets.length === 0 || (isOpen(r.status) && buckets.includes(agingBucket(r.daysPastDue)))) &&
        (!projectId || r.project.id === projectId) &&
        (!clientId || r.client.id === clientId) &&
        (!t || (r.number ?? "draft").toLowerCase().includes(t)),
    );
    // Most overdue first (open invoices), then the rest as they came (newest change first).
    return [...list].sort((a, b) => (isOpen(b.status) ? 1 : 0) - (isOpen(a.status) ? 1 : 0) || (isOpen(a.status) ? b.daysPastDue - a.daysPastDue : 0));
  }, [rows, tab, buckets, search, projectId, clientId]);

  function goTab(t: InvoiceTab, b: readonly AgingBucket[] = []) {
    setTab(t);
    setBuckets(b);
  }

  const newButton = projects.length > 0 && (
    <Button variant="primary" onClick={() => setPicking(true)}>
      New invoice
    </Button>
  );
  const filtered = buckets.length > 0 || search || projectId || clientId;

  return (
    <main>
      <PageHeader
        eyebrow="RECEIVABLES · DRAFTS · PAYMENTS"
        title="Invoices"
        actions={
          <>
            {data.can.recordPayment && payable.length > 0 && <Button onClick={() => setPaying(true)}>Record payment</Button>}
            {newButton}
          </>
        }
      >
        <HeaderKpis label="Receivables summary">
          <KpiButton label="Show open invoices" onClick={() => goTab("open")}>
            <KpiTile
              variant="header"
              label="Receivables"
              value={money(kpis.receivablesCents)}
              note={`${kpis.openCount} open ${kpis.openCount === 1 ? "invoice" : "invoices"}`}
            />
          </KpiButton>
          <KpiButton label="Show invoices over 60 days past due" onClick={() => goTab("open", OVER_60)}>
            <KpiTile
              variant="header"
              label="Over 60 days"
              value={money(kpis.over60Cents)}
              tone={kpis.over60Cents > 0 ? "red" : "default"}
              note={kpis.over60Count === 0 ? "Nothing to chase" : `${kpis.over60Count} ${kpis.over60Count === 1 ? "invoice needs" : "invoices need"} follow-up`}
            />
          </KpiButton>
          <KpiButton label="Show drafts and invoices in review" onClick={() => goTab("drafts")}>
            <KpiTile
              variant="header"
              label="Drafts & in review"
              value={String(kpis.draftsCount)}
              note={`${money(kpis.draftsCents)} waiting to send`}
            />
          </KpiButton>
          <KpiTile
            variant="header"
            label={`Collected in ${monthName(today)}`}
            value={money(kpis.collectedCents)}
            note={`${kpis.collectedCount} ${kpis.collectedCount === 1 ? "payment" : "payments"}`}
          />
        </HeaderKpis>
        <div className={headerTabBarClasses}>
          <div role="tablist" aria-label="Invoice status" className={tabRowClasses}>
            {INVOICE_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => goTab(t.key)}
                className={tabClasses(tab === t.key)}
              >
                {t.label}
                <span className={tabCountClasses}>{counts[t.key]}</span>
              </button>
            ))}
          </div>
        </div>
      </PageHeader>

      <div className="flex flex-col gap-5 px-4 pt-7 pb-8 md:px-page-x">
        {rows.length === 0 ? (
          <EmptyState
            title="No invoices yet"
            help={projects.length ? "Start one with New invoice." : "Invoices start from active or on-hold projects."}
            action={newButton}
          />
        ) : (
          <>
            {tab === "open" && counts.open > 0 && (
              <AgingBar totals={aging} selected={buckets} onPick={(b) => setBuckets(b ? [b] : [])} />
            )}
            <div className="flex flex-wrap items-center gap-3">
              <label className="relative flex-[0_1_260px]">
                <span className="sr-only">Search by invoice number</span>
                <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" />
                <input
                  type="search"
                  value={search}
                  maxLength={40}
                  placeholder="Invoice number"
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-[var(--height-control)] w-full rounded-sm border border-line-input bg-surface pr-2.5 pl-8 text-base focus:outline-2 focus:-outline-offset-1 focus:outline-blue"
                />
              </label>
              <Select aria-label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)} wrapperClassName="flex-[0_1_260px]">
                <option value="">All projects</option>
                {projectOptions.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </Select>
              <Select aria-label="Client" value={clientId} onChange={(e) => setClientId(e.target.value)} wrapperClassName="flex-[0_1_220px]">
                <option value="">All clients</option>
                {clientOptions.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </Select>
              <span className="num ml-auto text-xs text-muted" data-testid="shown-note">
                {shown.length} {shown.length === 1 ? "invoice" : "invoices"} shown
              </span>
            </div>
            <InvoiceTable rows={shown} filtered={!!filtered} />
          </>
        )}
      </div>

      <ProjectPicker open={picking} onOpenChange={setPicking} projects={projects} />
      {data.can.recordPayment && (
        <RecordPaymentDialog
          open={paying}
          onOpenChange={setPaying}
          invoices={payable}
          today={today}
          onRecorded={(m) => {
            toast(m);
            router.refresh();
          }}
        />
      )}
    </main>
  );
}

/** "2026-10-18" → "October". */
function monthName(today: string) {
  return new Date(`${today}T12:00:00Z`).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
}

function unique(pairs: string[][]): [string, string][] {
  const m = new Map<string, string>();
  for (const [id, label] of pairs) if (id && !m.has(id)) m.set(id, label!);
  return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
}

/** A KPI tile that filters the list when clicked. */
function KpiButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className={cn(
        "block cursor-pointer border-0 bg-transparent p-0 text-left hover:bg-surface-2",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue",
      )}
    >
      {children}
    </button>
  );
}

function InvoiceTable({ rows, filtered }: { rows: InvoiceListRow[]; filtered: boolean }) {
  if (rows.length === 0)
    return (
      <div className="rounded-sm border border-line bg-surface px-5 py-8 text-center text-sm text-muted">
        {filtered ? "No invoices match." : "Nothing here."}
      </div>
    );
  return (
    <div className="rounded-sm border border-line bg-surface">
      <Table aria-label="Invoices" className="table-flush-top min-w-[900px]">
        <TableHead>
          <TableRow>
            <TableHeader>Invoice</TableHeader>
            <TableHeader>Client / project</TableHeader>
            <TableHeader>Sent</TableHeader>
            <TableHeader>Due</TableHeader>
            <TableHeader numeric>Total</TableHeader>
            <TableHeader numeric>Balance</TableHeader>
            <TableHeader>Aging</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => {
            const draft = r.status === "draft" || r.status === "in_review";
            return (
              <TableRow key={r.id} data-invoice={r.number ?? r.id}>
                <TableCell className="num">
                  <Link href={draft ? `/app/invoices/${r.id}/edit` : `/app/invoices/${r.id}`} className="font-medium text-ink">
                    {r.number ?? "Draft"}
                  </Link>
                </TableCell>
                <TableCell>
                  <div>{r.client.name}</div>
                  <div className="text-xs text-muted">
                    <span className="num">{r.project.number}</span> {r.project.name}
                  </div>
                </TableCell>
                <TableCell className="num text-[12.5px]">{r.sentOn ? formatDate(r.sentOn) : "—"}</TableCell>
                <TableCell className="num text-[12.5px]">{draft ? "—" : formatDate(r.dueDate)}</TableCell>
                <TableCell numeric>{money(r.totalCents)}</TableCell>
                <TableCell numeric className="font-semibold">
                  {draft ? "—" : money(r.balanceCents)}
                </TableCell>
                <TableCell>{isOpen(r.status) ? <AgingBadge days={r.daysPastDue} /> : <StatusBadge status={r.status} />}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/** New invoice → pick a project. A project with a draft opens that draft. */
function ProjectPicker({
  open,
  onOpenChange,
  projects,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: BillableProject[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const shown = useMemo(() => {
    const t = search.trim().toLowerCase();
    return t ? projects.filter((p) => `${p.number} ${p.name} ${p.client}`.toLowerCase().includes(t)) : projects;
  }, [projects, search]);

  function pick(p: BillableProject) {
    setError(null);
    if (p.draftId) return router.push(`/app/invoices/${p.draftId}/edit`);
    start(async () => {
      const r = await createDraftInvoice({ projectId: p.id });
      if (!r.ok) return setError(r.error ?? "Couldn't start the invoice. Try again.");
      router.push(`/app/invoices/${r.data.id}/edit`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="New invoice" description="Which project are you billing?">
        <div className="flex flex-col gap-3">
          {error && <ErrorBanner message={error} />}
          <Input
            label="Find a project"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Number, name or client"
            autoFocus
          />
          <ul aria-label="Projects" className="m-0 flex max-h-[360px] list-none flex-col overflow-y-auto p-0">
            {shown.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => pick(p)}
                  className="flex w-full cursor-pointer items-center gap-3 border-b border-line-soft bg-transparent px-1 py-2.5 text-left hover:bg-surface-2 disabled:cursor-wait"
                >
                  <span className="num w-[72px] shrink-0 text-xs text-ink-3">{p.number}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="block truncate text-xs text-muted">{p.client}</span>
                  </span>
                  {p.draftId && <span className="cap text-2xs font-semibold text-blue">Draft open</span>}
                </button>
              </li>
            ))}
            {shown.length === 0 && <li className="py-3 text-sm text-muted">No projects match.</li>}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
