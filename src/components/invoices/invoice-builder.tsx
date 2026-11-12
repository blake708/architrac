"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorBanner } from "@/components/settings/error-banner";
import { Button, buttonClasses } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { money } from "@/lib/calc/invoice-plan";
import { formatDate } from "@/lib/format";
import { INVOICE_MESSAGES } from "@/lib/invoices/builder";
import {
  deleteDraft,
  prepareSend,
  recalculateDraft,
  returnToDraft,
  sendInvoice,
  submitForReview,
  updateDraftSettings,
} from "@/server/invoices/actions";
import type { SendDefaults } from "@/server/invoices/detail";
import type { BuilderView } from "@/server/invoices/view";
import { AdjustmentLines, ConsultantsSection, FixedSection, HourlySection, NteSection, Section } from "./builder-sections";
import { Callout, StatusBadge } from "./invoice-bits";
import { ADDITIONAL_TITLES, CONTRACT_TITLES } from "./invoice-tables";
import { SendDialog } from "./send-dialog";
import { useBuilder } from "./use-builder";

/**
 * The invoice builder (invoicing spec Layout C). Every change saves on the
 * server, which recalculates the draft and sends back the fresh numbers;
 * nothing on this page computes a total itself.
 */
export function InvoiceBuilder({ initial }: { initial: BuilderView }) {
  const b = useBuilder(initial);
  const { view, error, saving, run } = b;
  const router = useRouter();
  const [returning, setReturning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendDefaults, setSendDefaults] = useState<SendDefaults | null>(null);

  async function openSend() {
    setSendDefaults(null);
    setSending(true);
    const d = await prepareSend(view.id).catch(() => null);
    if (!d) {
      setSending(false);
      return b.setError("Couldn't get the invoice ready to send. Reload and try again.");
    }
    setSendDefaults(d);
  }

  async function submit() {
    setNotice(null);
    if (await run(submitForReview, {})) setNotice(INVOICE_MESSAGES.submitted);
  }

  return (
    <main>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2">
            <Link href="/app/invoices" className="text-ink-3">
              Invoices
            </Link>
            <span aria-hidden="true">/</span>
            <span>{view.status === "in_review" ? "In review" : "Draft invoice"}</span>
          </span>
        }
        title={
          <>
            <span className="num">{view.project.number}</span> {view.project.name}
          </>
        }
        description={view.client.name}
        actions={
          <>
            <span className="self-center" data-testid="invoice-status">
              <StatusBadge status={view.status} />
            </span>
            {view.can.edit && (
              <Button onClick={() => void run(recalculateDraft, {})} disabled={saving}>
                Recalculate
              </Button>
            )}
            <a
              href={`/api/invoices/${view.id}/preview`}
              target="_blank"
              rel="noopener"
              className={buttonClasses("secondary")}
              aria-disabled={saving || undefined}
            >
              Preview PDF
            </a>
            {view.can.delete && (
              <Button variant="danger" onClick={() => setDeleting(true)}>
                Delete draft
              </Button>
            )}
            {view.can.returnToDraft && <Button onClick={() => setReturning(true)}>Return to draft</Button>}
            {view.can.submit && !view.can.send && (
              <Button variant="primary" onClick={() => void submit()} disabled={saving}>
                Submit for review
              </Button>
            )}
            {view.can.send && (
              <Button variant="primary" onClick={() => void openSend()} disabled={saving}>
                {view.sendStarted ? "Retry sending…" : "Send…"}
              </Button>
            )}
          </>
        }
      />
      <div className="flex flex-col gap-4 px-4 pt-5 pb-8 md:px-page-x">
        <div aria-live="polite" className="sr-only">
          {saving ? "Saving" : "Saved"}
        </div>
        {error && <ErrorBanner message={error} />}
        {error === INVOICE_MESSAGES.stale && (
          <div>
            <Button onClick={() => router.refresh()}>Reload</Button>
          </div>
        )}
        {notice && !error && <Callout tone="attention">{notice}</Callout>}
        {view.sendStarted ? (
          <Callout tone="danger">
            {view.can.send
              ? `Invoice ${view.number} is numbered but didn't finish sending. Retry sending to finish; the email won't go twice.`
              : `Invoice ${view.number} is being sent. Ask an owner or admin to finish sending it.`}
          </Callout>
        ) : (
          view.status === "in_review" &&
          !view.can.edit && <Callout tone="attention">{INVOICE_MESSAGES.notEditable}</Callout>
        )}

        <SettingsStrip b={b} />

        {view.warnings.length > 0 && (
          <div className="flex flex-col gap-2" aria-label="Warnings">
            {view.warnings.map((w) => (
              <Callout key={w.message} tone={w.tone}>
                {w.message}
              </Callout>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-start gap-4">
          <div className="flex min-w-0 flex-[999_1_640px] flex-col gap-4">
            <FixedSection b={b} additional={false} title={CONTRACT_TITLES[0]} />
            <NteSection b={b} additional={false} title={CONTRACT_TITLES[1]} />
            <HourlySection b={b} additional={false} title={CONTRACT_TITLES[2]} />
            <FixedSection b={b} additional title={ADDITIONAL_TITLES[0]} />
            <NteSection b={b} additional title={ADDITIONAL_TITLES[1]} />
            <HourlySection b={b} additional title={ADDITIONAL_TITLES[2]} />
            <ConsultantsSection b={b} />
          </div>
          <Totals b={b} />
        </div>
      </div>

      <ReturnDialog open={returning} onOpenChange={setReturning} b={b} />
      <SendDialog
        open={sending}
        onOpenChange={setSending}
        defaults={sendDefaults}
        retrying={view.sendStarted}
        onSend={async (input) => {
          const r = await sendInvoice({ ...input, invoiceId: view.id, version: view.version });
          if (r.ok) router.push(`/app/invoices/${view.id}`);
          else if ("retry" in r && r.retry) router.refresh();
          return r;
        }}
      />
      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent
          title="Delete this draft?"
          description="Its lines are removed and its time is free to bill on the next invoice. % complete stays as set on each phase."
          footer={
            <>
              <Button variant="ghost" onClick={() => setDeleting(false)}>
                Keep it
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  const r = await deleteDraft({ invoiceId: view.id, version: view.version });
                  if (!r.ok) {
                    setDeleting(false);
                    return b.setError(r.error ?? "Couldn't delete. Try again.");
                  }
                  router.push("/app/invoices");
                }}
              >
                Delete draft
              </Button>
            </>
          }
        >
          {null}
        </DialogContent>
      </Dialog>
    </main>
  );
}

/** C.2 Period through, dates, bill-to, memo. Each saves when you leave it. */
function SettingsStrip({ b }: { b: ReturnType<typeof useBuilder> }) {
  const { view, run, fieldErrors } = b;
  const s = view.settings;
  const disabled = !view.can.edit;
  const save = (patch: Record<string, unknown>) => void run(updateDraftSettings, patch);
  const date = (key: "periodEnd" | "issueDate" | "dueDate", label: string, hint?: string) => (
    <Input
      key={`${key}-${s[key]}`}
      type="date"
      label={label}
      defaultValue={s[key]}
      disabled={disabled}
      error={fieldErrors[key]}
      hint={hint}
      onBlur={(e) => e.target.value && e.target.value !== s[key] && save({ [key]: e.target.value })}
    />
  );
  return (
    <Section title="Invoice details">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-x-4 gap-y-4 px-[18px] pb-4">
        {date("periodEnd", "Period through", s.periodStart ? `Time from ${formatDate(s.periodStart)}` : undefined)}
        {date("issueDate", "Issue date")}
        {date("dueDate", "Due date", `Net ${s.termsDays} from the issue date`)}
        <Select
          label="Bill to"
          value={s.billToContactId ?? ""}
          disabled={disabled}
          error={fieldErrors.billToContactId}
          hint={
            s.emailTo ? (
              <span data-testid="email-to">
                Emails to {s.emailTo}
                {s.emailCc ? `, copying ${s.emailCc}` : ""}
              </span>
            ) : undefined
          }
          onChange={(e) => save({ billToContactId: e.target.value || null })}
        >
          <option value="">Pick a contact…</option>
          {view.contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.email ? ` · ${c.email}` : " · no email"}
            </option>
          ))}
        </Select>
        <Textarea
          key={`memo-${view.version}`}
          wrapperClassName="col-span-full"
          label="Memo to client"
          rows={2}
          maxLength={2000}
          defaultValue={s.memo}
          disabled={disabled}
          error={fieldErrors.memo}
          hint="Printed on the invoice."
          onBlur={(e) => e.target.value !== s.memo && save({ memo: e.target.value })}
        />
      </div>
    </Section>
  );
}

/** C.8 Totals (always from the server): Subtotal and adjustments (when there are any), tax, total. */
function Totals({ b }: { b: ReturnType<typeof useBuilder> }) {
  const { view } = b;
  const t = view.totals;
  const row = "flex justify-between gap-4 py-1.5";
  return (
    <aside aria-label="Totals" className="sticky top-4 flex-[1_1_280px] rounded-sm border border-line bg-surface px-[18px] py-4">
      <AdjustmentLines b={b} />
      {t.taxCents > 0 && (
        <div className={row}>
          <span className="text-muted">Tax</span>
          <span className="num">{money(t.taxCents)}</span>
        </div>
      )}
      <div className={`${row} border-t border-line pt-2.5 text-base font-semibold`}>
        <span>Total this invoice</span>
        <span className="num" data-testid="invoice-total">
          {money(t.totalCents)}
        </span>
      </div>
      {t.priorInvoices.length > 0 && (
        <>
          <div className={`${row} mt-2 text-sm`}>
            <span className="text-muted">Prior invoices outstanding</span>
            <span className="num">{money(t.priorOutstandingCents)}</span>
          </div>
          <ul className="m-0 list-none p-0 text-xs text-muted">
            {t.priorInvoices.map((p) => (
              <li key={p.number} className="flex justify-between">
                <span className="num">{p.number}</span>
                <span className="num">{money(p.balanceCents)}</span>
              </li>
            ))}
          </ul>
          <div className={`${row} border-t border-line-soft pt-2.5 font-semibold`}>
            <span>Total balance incl. prior</span>
            <span className="num">{money(t.totalCents + t.priorOutstandingCents)}</span>
          </div>
        </>
      )}
      {view.problems.length > 0 && view.can.submit && (
        <div className="mt-3 border-t border-line-soft pt-3 text-xs text-muted">
          <div className="cap mb-1 text-2xs font-semibold">Before you can submit</div>
          <ul className="m-0 pl-4">
            {view.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}

function ReturnDialog({
  open,
  onOpenChange,
  b,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  b: ReturnType<typeof useBuilder>;
}) {
  const [note, setNote] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Return to draft"
        description="The person who prepared it can change it and submit it again."
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                if (await b.run(returnToDraft, { note })) {
                  setNote("");
                  onOpenChange(false);
                }
              }}
            >
              Return to draft
            </Button>
          </>
        }
      >
        <Textarea
          label="Note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          error={b.fieldErrors.note}
          rows={3}
          placeholder="What needs to change?"
          autoFocus
        />
      </DialogContent>
    </Dialog>
  );
}

