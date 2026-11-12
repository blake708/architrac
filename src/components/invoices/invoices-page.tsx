"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ErrorBanner } from "@/components/settings/error-banner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { money } from "@/lib/calc/invoice-plan";
import { formatDate } from "@/lib/format";
import { createDraftInvoice } from "@/server/invoices/actions";
import type { BillableProject, InvoiceListRow } from "@/server/invoices/view";
import { StatusBadge } from "./invoice-bits";

/**
 * The Invoices page (invoicing spec Layout A, first version: decision #29).
 * The only place an invoice is started. KPIs, aging, payments and the
 * status tabs arrive in 1.8 D.
 */
export function InvoicesPage({ rows, projects }: { rows: InvoiceListRow[]; projects: BillableProject[] }) {
  const [picking, setPicking] = useState(false);

  return (
    <main>
      <PageHeader
        title="Invoices"
        description="Start an invoice from any project you bill. Drafts and invoices waiting for review are listed here."
        actions={
          projects.length > 0 && (
            <Button variant="primary" onClick={() => setPicking(true)}>
              New invoice
            </Button>
          )
        }
      />
      <div className="px-4 pt-5 pb-8 md:px-page-x">
        {rows.length === 0 ? (
          <EmptyState
            title="No invoices yet"
            help={projects.length ? "Start one with New invoice." : "Invoices start from active or on-hold projects."}
            action={
              projects.length > 0 && (
                <Button variant="primary" onClick={() => setPicking(true)}>
                  New invoice
                </Button>
              )
            }
          />
        ) : (
          <div className="rounded-sm border border-line bg-surface">
            <Table aria-label="Invoices">
              <TableHead>
                <TableRow>
                  <TableHeader>Invoice</TableHeader>
                  <TableHeader>Client / project</TableHeader>
                  <TableHeader>Status</TableHeader>
                  <TableHeader>Period through</TableHeader>
                  <TableHeader numeric>Total</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => {
                  const open = r.status === "draft" || r.status === "in_review";
                  return (
                    <TableRow key={r.id} data-invoice={r.id}>
                      <TableCell className="num">
                        <Link href={open ? `/app/invoices/${r.id}/edit` : `/app/invoices/${r.id}`} className="font-medium text-ink">
                          {r.number ?? "Draft"}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <div>{r.client}</div>
                        <div className="text-xs text-muted">
                          <span className="num">{r.project.number}</span> {r.project.name}
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} />
                      </TableCell>
                      <TableCell className="num text-[12.5px]">{formatDate(r.periodEnd)}</TableCell>
                      <TableCell numeric>{money(r.totalCents)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
      <ProjectPicker open={picking} onOpenChange={setPicking} projects={projects} />
    </main>
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
