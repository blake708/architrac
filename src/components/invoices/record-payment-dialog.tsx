"use client";

import { useState } from "react";
import { ErrorBanner } from "@/components/settings/error-banner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/field";
import { money } from "@/lib/calc/invoice-plan";
import { parseMoney } from "@/lib/invoices/builder";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/invoices/payments";
import { recordPayment } from "@/server/invoices/actions";

// Record payment (invoicing spec Actions, rule 9). From the Invoices page
// it first asks which open invoice; from an invoice's page it's that one.

export type PayableInvoice = {
  id: string;
  number: string;
  client: string;
  balanceCents: number;
};

const amountText = (cents: number) => (cents / 100).toFixed(2);

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** One invoice (its own page) or every open invoice (the Invoices page). */
  invoices: PayableInvoice[];
  today: string;
  onRecorded: (message: string) => void;
};

export function RecordPaymentDialog(props: Props) {
  // The form mounts fresh each time the dialog opens, so it starts clean.
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <PaymentForm {...props} />}
    </Dialog>
  );
}

function PaymentForm({ onOpenChange, invoices, today, onRecorded }: Props) {
  // A single invoice is picked for you, with its balance as the amount.
  const only = invoices.length === 1 ? invoices[0]! : null;
  const [invoiceId, setInvoiceId] = useState(only?.id ?? "");
  const [receivedOn, setReceivedOn] = useState(today);
  const [amount, setAmount] = useState(
    only ? amountText(only.balanceCents) : "",
  );
  const [method, setMethod] = useState<PaymentMethod>("check");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<string, string>>
  >({});

  const chosen = invoices.find((i) => i.id === invoiceId) ?? null;

  function pick(id: string) {
    setInvoiceId(id);
    const inv = invoices.find((i) => i.id === id);
    setAmount(inv ? amountText(inv.balanceCents) : "");
  }

  async function save() {
    setError(null);
    setFieldErrors({});
    if (!chosen)
      return setFieldErrors({
        invoiceId: "Pick the invoice this payment is for.",
      });
    const cents = parseMoney(amount);
    if (cents === null || cents <= 0)
      return setFieldErrors({ amountCents: "Enter an amount over $0." });
    setBusy(true);
    const r = await recordPayment({
      invoiceId: chosen.id,
      receivedOn,
      amountCents: cents,
      method,
      reference,
    });
    setBusy(false);
    if (r.ok) {
      onOpenChange(false);
      const left = chosen.balanceCents - cents;
      return onRecorded(
        left > 0
          ? `Payment recorded on ${chosen.number}. ${money(left)} still due.`
          : `Payment recorded. ${chosen.number} is paid.`,
      );
    }
    if (r.fieldErrors && Object.keys(r.fieldErrors).length > 0)
      setFieldErrors(r.fieldErrors);
    else setError(r.error ?? "Couldn't record the payment. Try again.");
  }

  return (
    <DialogContent
      title="Record payment"
      description={
        chosen
          ? `${chosen.number} · ${chosen.client} · ${money(chosen.balanceCents)} due`
          : "Money received against an invoice."
      }
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy}>
            {busy ? "Saving…" : "Record payment"}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {error && <ErrorBanner message={error} />}
        {invoices.length > 1 && (
          <Select
            label="Invoice"
            value={invoiceId}
            onChange={(e) => pick(e.target.value)}
            error={fieldErrors.invoiceId}
          >
            <option value="">Pick an open invoice</option>
            {invoices.map((i) => (
              <option key={i.id} value={i.id}>
                {i.number} · {i.client} · {money(i.balanceCents)} due
              </option>
            ))}
          </Select>
        )}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
          <Input
            label="Received on"
            type="date"
            max={today}
            value={receivedOn}
            onChange={(e) => setReceivedOn(e.target.value)}
            error={fieldErrors.receivedOn}
          />
          <Input
            label="Amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            error={fieldErrors.amountCents}
            placeholder="0.00"
          />
          <Select
            label="Method"
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            error={fieldErrors.method}
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
          <Input
            label="Reference"
            value={reference}
            maxLength={100}
            onChange={(e) => setReference(e.target.value)}
            error={fieldErrors.reference}
            hint="Check number, ACH trace…"
          />
        </div>
        {/* Lets Enter submit the form. */}
        <button type="submit" hidden />
      </form>
    </DialogContent>
  );
}
