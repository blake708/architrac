"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorBanner } from "@/components/settings/error-banner";
import { Button, buttonClasses } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { money } from "@/lib/calc/invoice-plan";
import { formatDate } from "@/lib/format";
import { methodLabel } from "@/lib/invoices/payments";
import { deletePayment, resendInvoice, voidInvoice } from "@/server/invoices/actions";
import type { InvoiceDetail as Detail } from "@/server/invoices/detail";
import { AgingBadge, Callout, StatusBadge } from "./invoice-bits";
import { InvoiceTables, TotalLines } from "./invoice-tables";
import { RecordPaymentDialog } from "./record-payment-dialog";
import { ResendDialog } from "./send-dialog";

// A sent invoice (invoicing spec Layout D): the invoice as billed, its
// payments (owner/admin record and delete them), aging and activity.

export function InvoiceDetail({ detail: d }: { detail: Detail }) {
  const router = useRouter();
  const [resending, setResending] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [paying, setPaying] = useState(false);
  const [removing, setRemoving] = useState<Payment | null>(null);
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const row = "flex justify-between gap-4 py-1.5";
  const open = d.status === "sent" || d.status === "partially_paid";
  const balance = d.status === "void" ? 0 : d.totalCents - d.paidCents;

  return (
    <main>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2">
            <Link href="/app/invoices" className="text-ink-3">
              Invoices
            </Link>
            <span aria-hidden="true">/</span>
            <span>
              <span className="num">{d.project.number}</span> {d.project.name}
            </span>
          </span>
        }
        title={
          <>
            Invoice <span className="num" data-testid="invoice-number">{d.number}</span>
          </>
        }
        description={d.client}
        actions={
          <>
            <span className="flex items-center gap-1.5 self-center">
              <span data-testid="invoice-status">
                <StatusBadge status={d.status} />
              </span>
              {open && (
                <span data-testid="invoice-aging">
                  <AgingBadge days={d.daysPastDue} />
                </span>
              )}
            </span>
            {d.can.download && (
              <a href={`/api/invoices/${d.id}/pdf`} target="_blank" rel="noopener" className={buttonClasses("secondary")}>
                Download PDF
              </a>
            )}
            {d.can.resend && <Button onClick={() => setResending(true)}>Resend email</Button>}
            {d.can.void && (
              <Button variant="danger" onClick={() => setVoiding(true)}>
                Void
              </Button>
            )}
            {d.can.recordPayment && (
              <Button variant="primary" onClick={() => setPaying(true)}>
                Record payment
              </Button>
            )}
          </>
        }
      />
      <div className="flex flex-col gap-4 px-4 pt-5 pb-8 md:px-page-x">
        {error && <ErrorBanner message={error} />}
        {d.void && (
          <Callout tone="danger">
            VOID · {formatDate(d.void.at.slice(0, 10))} · {d.void.reason}
          </Callout>
        )}

        <div className="flex flex-wrap items-start gap-4">
          <div className="flex min-w-0 flex-[999_1_640px] flex-col gap-4">
            <section aria-label="Invoice details" className="rounded-sm border border-line bg-surface">
              <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-4 px-[18px] py-4 text-sm">
              <Fact label="Issued">{formatDate(d.issueDate)}</Fact>
              <Fact label="Due">{formatDate(d.dueDate)}</Fact>
              <Fact label="Services through">{formatDate(d.periodEnd)}</Fact>
              <Fact label="Sent">
                {d.sentAt ? formatDate(d.sentAt.slice(0, 10)) : "—"}
                {d.sentAt && (
                  <div className="text-xs text-muted">{d.emailed ? `Emailed to ${d.sentTo.join(", ")}` : "Marked sent, not emailed"}</div>
                )}
              </Fact>
              </dl>
            </section>
            <Payments d={d} onDelete={setRemoving} onRecord={() => setPaying(true)} />
            <InvoiceTables x={d.sections} />
            <Activity items={d.activity} />
          </div>
          <aside aria-label="Totals" className="flex-[1_1_340px] rounded-sm border border-line bg-surface px-[18px] py-4">
            <TotalLines
              servicesSubtotalCents={d.sections.servicesSubtotalCents}
              adjustments={d.sections.adjustments}
              taxCents={d.taxCents}
              totalCents={d.totalCents}
            />
            <div className={row}>
              <span className="text-muted">Paid</span>
              <span className="num" data-testid="invoice-paid">
                {money(d.paidCents)}
              </span>
            </div>
            <div className={`${row} font-semibold`}>
              <span>Balance</span>
              <span className="num" data-testid="invoice-balance">
                {money(balance)}
              </span>
            </div>
          </aside>
        </div>
      </div>

      <ResendDialog
        open={resending}
        onOpenChange={setResending}
        defaults={d.resend}
        onSend={async (email) => {
          const r = await resendInvoice({ invoiceId: d.id, ...email });
          if (r.ok) {
            setError(null);
            toast("Email sent.");
          }
          return r;
        }}
      />
      <RecordPaymentDialog
        open={paying}
        onOpenChange={setPaying}
        invoices={[{ id: d.id, number: d.number ?? "", client: d.client, balanceCents: balance }]}
        today={d.today}
        onRecorded={(m) => {
          setError(null);
          toast(m);
          router.refresh();
        }}
      />
      <DeletePaymentDialog
        payment={removing}
        onClose={() => setRemoving(null)}
        onDeleted={() => {
          setError(null);
          toast("Payment deleted. The balance and status are updated.");
          router.refresh();
        }}
      />
      <VoidDialog
        open={voiding}
        onOpenChange={setVoiding}
        onVoid={async (reason) => {
          const r = await voidInvoice({ invoiceId: d.id, reason });
          if (r.ok) {
            toast("Voided. Its time and % complete can be billed again on the next invoice.");
            router.refresh();
          }
          return r;
        }}
      />
    </main>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="cap text-2xs font-semibold text-muted">{label}</dt>
      <dd className="m-0 mt-0.5">{children}</dd>
    </div>
  );
}

function VoidDialog({
  open,
  onOpenChange,
  onVoid,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVoid: (reason: string) => Promise<{ ok: boolean; error?: string; fieldErrors?: Partial<Record<string, string>> }>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Void this invoice?"
        description="It stays on record with its number, which is never used again. Its time and % complete are freed to bill on the next invoice."
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Keep it
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                const r = await onVoid(reason);
                setBusy(false);
                if (r.ok) {
                  setReason("");
                  return onOpenChange(false);
                }
                setFieldError(r.fieldErrors?.reason);
                if (!r.fieldErrors?.reason) setError(r.error ?? "Couldn't void. Try again.");
              }}
            >
              {busy ? "Voiding…" : "Void invoice"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {error && <ErrorBanner message={error} />}
          <Textarea label="Reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} error={fieldError} autoFocus />
        </div>
      </DialogContent>
    </Dialog>
  );
}

type Payment = Detail["payments"][number];

/** Payments received (rule 9). Owners and admins record and delete them. */
function Payments({ d, onDelete, onRecord }: { d: Detail; onDelete: (p: Payment) => void; onRecord: () => void }) {
  if (d.payments.length === 0 && !d.can.recordPayment) return null;
  return (
    <section aria-labelledby="payments-title" className="rounded-sm border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-3 px-[18px] pt-4 pb-3">
        <h2 id="payments-title" className="m-0 text-sm font-semibold">
          Payments
        </h2>
        {d.payments.length === 0 && <span className="text-[12.5px] text-muted">Nothing received yet.</span>}
        {d.can.recordPayment && (
          <Button className="ml-auto" onClick={onRecord}>
            Record payment
          </Button>
        )}
      </div>
      {d.payments.length > 0 && (
        <Table aria-label="Payments">
          <TableHead>
            <TableRow>
              <TableHeader>Received</TableHeader>
              <TableHeader>Method</TableHeader>
              <TableHeader>Reference</TableHeader>
              <TableHeader numeric>Amount</TableHeader>
              {d.can.deletePayment && (
                <TableHeader>
                  <span className="sr-only">Delete</span>
                </TableHeader>
              )}
            </TableRow>
          </TableHead>
          <TableBody>
            {d.payments.map((p) => (
              <TableRow key={p.id} data-payment={p.id}>
                <TableCell className="num text-[12.5px]">{formatDate(p.receivedOn)}</TableCell>
                <TableCell>{methodLabel(p.method)}</TableCell>
                <TableCell className="text-muted">{p.reference || "—"}</TableCell>
                <TableCell numeric>{money(p.amountCents)}</TableCell>
                {d.can.deletePayment && (
                  <TableCell className="w-0 text-right">
                    <Button
                      aria-label={`Delete the ${money(p.amountCents)} payment of ${formatDate(p.receivedOn)}`}
                      onClick={() => onDelete(p)}
                    >
                      Delete
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

/** Who did what to this invoice, newest first (rule 18). */
function Activity({ items }: { items: Detail["activity"] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="activity-title" className="rounded-sm border border-line bg-surface px-[18px] py-4">
      <h2 id="activity-title" className="m-0 mb-3 text-sm font-semibold">
        Activity
      </h2>
      <ol className="m-0 flex list-none flex-col gap-2.5 p-0 text-sm">
        {items.map((a) => (
          <li key={a.id} className="flex flex-wrap gap-x-3 gap-y-0.5" data-activity>
            <span className="num w-[150px] shrink-0 text-xs text-muted">{a.when}</span>
            <span className="min-w-0 flex-1">
              <span className="font-medium">{a.who}</span> · {a.text}
              {a.times > 1 && <span className="text-muted"> ({a.times} times)</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function DeletePaymentDialog({ payment, onClose, onDeleted }: { payment: Payment | null; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={payment !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Delete this payment?"
        description={
          payment
            ? `${money(payment.amountCents)} received ${formatDate(payment.receivedOn)}. The balance and status go back to match the payments left.`
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Keep it
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={async () => {
                if (!payment) return;
                setBusy(true);
                setError(null);
                const r = await deletePayment({ paymentId: payment.id });
                setBusy(false);
                if (!r.ok) return setError(r.error ?? "Couldn't delete the payment. Try again.");
                onClose();
                onDeleted();
              }}
            >
              {busy ? "Deleting…" : "Delete payment"}
            </Button>
          </>
        }
      >
        {error ? <ErrorBanner message={error} /> : null}
      </DialogContent>
    </Dialog>
  );
}
