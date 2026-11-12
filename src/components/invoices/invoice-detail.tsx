"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorBanner } from "@/components/settings/error-banner";
import { Button, buttonClasses } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { money } from "@/lib/calc/invoice-plan";
import { formatDate } from "@/lib/format";
import { resendInvoice, voidInvoice } from "@/server/invoices/actions";
import type { InvoiceDetail as Detail } from "@/server/invoices/detail";
import { Callout, StatusBadge } from "./invoice-bits";
import { ResendDialog } from "./send-dialog";

// A sent invoice (invoicing spec Layout D, first version). Payments, aging
// and the activity timeline join this page in 1.8 D.

const GROUPS: { type: string; title: string }[] = [
  { type: "phase_fee", title: "Fee" },
  { type: "hourly", title: "Hourly services" },
  { type: "consultant", title: "Consultants" },
  { type: "adjustment", title: "Adjustments" },
];

export function InvoiceDetail({ detail: d }: { detail: Detail }) {
  const router = useRouter();
  const [resending, setResending] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const row = "flex justify-between gap-4 py-1.5";

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
            <span className="self-center" data-testid="invoice-status">
              <StatusBadge status={d.status} />
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
          </>
        }
      />
      <div className="flex flex-col gap-4 px-4 pt-5 pb-8 md:px-page-x">
        {error && <ErrorBanner message={error} />}
        {notice && !error && <Callout tone="attention">{notice}</Callout>}
        {d.void && (
          <Callout tone="danger">
            VOID · {formatDate(d.void.at.slice(0, 10))} · {d.void.reason}
          </Callout>
        )}

        <div className="flex flex-wrap items-start gap-4">
          <section className="min-w-0 flex-[999_1_640px] rounded-sm border border-line bg-surface">
            <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-4 border-b border-line-soft px-[18px] py-4 text-sm">
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
            {GROUPS.map((g) => {
              const lines = d.lines.filter((l) => l.type === g.type);
              if (!lines.length) return null;
              return (
                <div key={g.type} className="px-[18px] py-3">
                  <h2 className="cap m-0 mb-1 text-2xs font-semibold text-muted">{g.title}</h2>
                  <ul className="m-0 list-none p-0">
                    {lines.map((l) => (
                      <li key={l.id} className="flex justify-between gap-4 border-b border-line-soft py-1.5 text-sm last:border-0">
                        <span>{l.description}</span>
                        <span className="num">{money(l.amountCents)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </section>
          <aside aria-label="Totals" className="flex-[1_1_280px] rounded-sm border border-line bg-surface px-[18px] py-4">
            <div className={row}>
              <span className="text-muted">Subtotal</span>
              <span className="num">{money(d.subtotalCents)}</span>
            </div>
            {d.taxCents > 0 && (
              <div className={row}>
                <span className="text-muted">Tax</span>
                <span className="num">{money(d.taxCents)}</span>
              </div>
            )}
            <div className={`${row} border-t border-line pt-2.5 text-base font-semibold`}>
              <span>Total</span>
              <span className="num" data-testid="invoice-total">
                {money(d.totalCents)}
              </span>
            </div>
            <div className={row}>
              <span className="text-muted">Paid</span>
              <span className="num">{money(d.paidCents)}</span>
            </div>
            <div className={`${row} font-semibold`}>
              <span>Balance</span>
              <span className="num">{money(d.status === "void" ? 0 : d.totalCents - d.paidCents)}</span>
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
            setNotice("Email sent.");
          }
          return r;
        }}
      />
      <VoidDialog
        open={voiding}
        onOpenChange={setVoiding}
        onVoid={async (reason) => {
          const r = await voidInvoice({ invoiceId: d.id, reason });
          if (r.ok) {
            setNotice("Voided. Its time and % complete can be billed again on the next invoice.");
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
