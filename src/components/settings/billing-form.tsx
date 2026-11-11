"use client";

import { useState } from "react";
import { Input, Textarea } from "@/components/ui/field";
import { usesProject } from "@/lib/calc/number-format";
import {
  type BillingField,
  type BillingSettings,
  REMITTANCE_MAX,
  billingErrors,
  numberExamples,
} from "@/lib/settings/billing";
import { saveBillingSettings } from "@/server/settings/actions";
import { ErrorBanner } from "./error-banner";
import { blurOnEnter, useInstantSave } from "./form-state";

const FORM_ID = "billing-form";

/** What's typed: numbers stay text until they're saved. */
type Draft = Omit<BillingSettings, "nextInvoiceNumber" | "paymentTermsDays"> & {
  nextInvoiceNumber: string;
  paymentTermsDays: string;
};

const toDraft = (s: BillingSettings): Draft => ({
  ...s,
  nextInvoiceNumber: String(s.nextInvoiceNumber),
  paymentTermsDays: String(s.paymentTermsDays),
});

/** "" or "1.5" become NaN so validation says "Enter a whole number." */
const toNumber = (t: string) => (/^\s*-?\d+\s*$/.test(t) ? Number(t) : Number.NaN);

const fromDraft = (d: Draft): BillingSettings => ({
  ...d,
  nextInvoiceNumber: toNumber(d.nextInvoiceNumber),
  paymentTermsDays: toNumber(d.paymentTermsDays),
});

const CODES_HINT = "Codes: {YYYY} or {YY} year, {PROJECT} project number, {###} counter (one # per digit).";

/**
 * Settings → Billing & invoices (decisions #5, #28). Each field saves when
 * you leave it, if it's valid; only that field is sent.
 */
export function BillingForm({
  initial,
  year,
  projectNumbers,
  sampleProjectNumber,
}: {
  initial: BillingSettings;
  /** This year in the firm's time zone, for the examples. */
  year: number;
  /** Every project number in the firm, for the next-number example. */
  projectNumbers: string[];
  sampleProjectNumber: string | null;
}) {
  const [draft, setDraft] = useState(() => toDraft(initial));
  const [serverErrors, setServerErrors] = useState<Partial<Record<BillingField, string>>>({});
  const [banner, setBanner] = useState<string | null>(null);
  /** What the server has stored, to skip saves that change nothing. */
  const [saved, setSaved] = useState(initial);
  const { save } = useInstantSave(FORM_ID);

  const values = fromDraft(draft);
  // What's typed is checked live; a server error shows until the field changes.
  const errors = { ...serverErrors, ...billingErrors(values) };
  const examples = numberExamples(values, { year, projectNumbers, sampleProjectNumber });
  const perProject = usesProject(values.invoiceNumberFormat);

  function edit(field: keyof Draft, value: string) {
    setDraft((d) => ({ ...d, [field]: value }));
    setServerErrors((e) => ({ ...e, [field]: undefined }));
    setBanner(null);
  }

  /** Save one field when it's left, if it changed and is valid. */
  function commit(field: BillingField) {
    void save(async () => {
      const value = fromDraft(draft)[field];
      const current = saved[field];
      const normalized = typeof value === "string" ? value.trim() : value;
      if (normalized === current || billingErrors(fromDraft(draft))[field]) return false;
      const result = await saveBillingSettings({ [field]: value });
      if (!result.ok) {
        setServerErrors(result.fieldErrors ?? {});
        setBanner(result.error ?? "Couldn't save. Try again.");
        return false;
      }
      setSaved(result.data.settings);
      // Show what was stored (trimmed), keeping anything typed since.
      setDraft((d) => ({ ...d, [field]: String(result.data.settings[field]) }));
      return true;
    });
  }

  const field = (name: BillingField) => ({
    value: draft[name],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => edit(name, e.target.value),
    onBlur: () => commit(name),
    error: errors[name],
  });

  const exampleBox = "mt-2 rounded-sm border border-line-soft bg-surface-2 px-4 py-3";
  const exampleLabel = "cap text-2xs font-semibold text-muted";
  const exampleValue = "mt-1 font-mono text-lg font-semibold";

  return (
    <form
      id={FORM_ID}
      onSubmit={(e) => e.preventDefault()}
      onKeyDown={blurOnEnter}
      noValidate
      className="flex max-w-[960px] flex-col gap-4"
    >
      {banner && <ErrorBanner message={banner} />}

      <section aria-labelledby="numbering-title" className="rounded-sm border border-line bg-surface px-6 pt-5 pb-6">
        <h2 id="numbering-title" className="m-0 text-sm font-semibold">
          Numbering
        </h2>
        <p className="m-0 mt-1.5 mb-5 max-w-[720px] text-[12.5px] leading-normal text-muted">
          Build your own invoice and project numbers. Changing a format only affects numbers made after the change;
          existing invoices and projects keep theirs.
        </p>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-x-5 gap-y-5">
          <div>
            <Input
              label="Invoice number format"
              {...field("invoiceNumberFormat")}
              hint={CODES_HINT}
              spellCheck={false}
              className="font-mono"
              maxLength={40}
            />
            <div className={exampleBox} data-testid="invoice-example">
              <div className={exampleLabel}>{perProject ? "Example" : "Next invoice number"}</div>
              <div className={exampleValue}>{examples.invoice ?? "—"}</div>
              {examples.invoiceNote && <p className="m-0 mt-1 text-xs text-muted">{examples.invoiceNote}</p>}
            </div>
          </div>
          <div>
            <Input
              label="Project number format"
              {...field("projectNumberFormat")}
              hint="Codes: {YYYY} or {YY} year, {###} counter. With a year, the counter starts again each January."
              spellCheck={false}
              className="font-mono"
              maxLength={40}
            />
            <div className={exampleBox} data-testid="project-example">
              <div className={exampleLabel}>Next project number</div>
              <div className={exampleValue}>{examples.project ?? "—"}</div>
              <p className="m-0 mt-1 text-xs text-muted">Suggested on New project; you can still type your own.</p>
            </div>
          </div>
        </div>
        {!perProject && (
          <div className="mt-5 max-w-[260px]">
            <Input
              label="Next invoice number"
              inputMode="numeric"
              {...field("nextInvoiceNumber")}
              hint="The counter for the next invoice sent. Change it to continue from your old system."
            />
          </div>
        )}
      </section>

      <section aria-labelledby="invoice-defaults-title" className="rounded-sm border border-line bg-surface px-6 pt-5 pb-6">
        <h2 id="invoice-defaults-title" className="m-0 mb-4 text-sm font-semibold">
          Invoices
        </h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-x-5 gap-y-5">
          <Input
            label="Payment terms (days)"
            inputMode="numeric"
            {...field("paymentTermsDays")}
            hint="Due date = issue date + this many days. 30 prints as Net 30."
          />
        </div>
        <div className="mt-5">
          <Textarea
            label="Remittance text"
            {...field("remittanceText")}
            rows={3}
            maxLength={REMITTANCE_MAX}
            hint="Printed at the foot of every invoice. For example: Make checks payable to The Middleton Group. ACH details on request."
          />
        </div>
      </section>
    </form>
  );
}
