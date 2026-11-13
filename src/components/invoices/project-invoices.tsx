import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { money } from "@/lib/calc/invoice-plan";
import { formatDate } from "@/lib/format";
import type { ProjectInvoices } from "@/server/invoices/project-tab";
import { statusTone } from "./invoice-bits";

/**
 * A project's Invoices tab (invoicing spec Layout B, Project mockup):
 * "{billed} billed · {received} received · {outstanding} outstanding" and
 * the project's invoices. Invoices start on the Invoices page (#29).
 */
export function ProjectInvoicesTab({ data }: { data: ProjectInvoices }) {
  const s = data.summary;
  return (
    <section aria-labelledby="inv-title" className="rounded-sm border border-line bg-surface">
      <div className="flex flex-wrap items-baseline gap-2.5 px-[18px] pt-3.5 pb-2.5">
        <h2 id="inv-title" className="m-0 text-sm font-semibold">
          Invoices
        </h2>
        <span className="text-[12.5px] text-muted" data-testid="project-invoice-summary">
          {money(s.billedCents)} billed · {money(s.receivedCents)} received · {money(s.outstandingCents)} outstanding
        </span>
        <Link href="/app/invoices" className="ml-auto text-[12.5px] font-medium">
          All invoices
        </Link>
      </div>
      {data.rows.length === 0 ? (
        <p className="m-0 border-t border-line px-[18px] py-6 text-sm text-muted">
          Nothing billed yet. Start an invoice from the Invoices page.
        </p>
      ) : (
        <Table aria-label="Project invoices" className="min-w-[760px]">
          <TableHead>
            <TableRow>
              <TableHeader>Invoice</TableHeader>
              <TableHeader>Date</TableHeader>
              <TableHeader>For</TableHeader>
              <TableHeader numeric>Amount</TableHeader>
              <TableHeader>Status</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.rows.map((r) => (
              <TableRow key={r.id} data-invoice={r.number ?? "draft"}>
                <TableCell className="num text-[12.5px]">
                  <Link href={r.href} className="font-medium text-ink">
                    {r.number ?? "Draft"}
                  </Link>
                </TableCell>
                <TableCell className="num text-[12.5px]">{formatDate(r.issueDate)}</TableCell>
                <TableCell>{r.forText}</TableCell>
                <TableCell numeric>{money(r.totalCents)}</TableCell>
                <TableCell>
                  <Badge tone={statusTone(r.status)} dot>
                    {r.statusText}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
