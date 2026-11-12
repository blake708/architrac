"use client";

import { useState } from "react";
import { ErrorBanner } from "@/components/settings/error-banner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/field";
import type { EmailDefaults, SendDefaults } from "@/server/invoices/detail";

// The Send… and Resend email dialogs (invoicing spec, Actions; rule 15).

type Errors = Partial<Record<string, string>>;
type Result = { ok: boolean; error?: string; fieldErrors?: Errors; retry?: boolean };

function EmailFields({
  value,
  onChange,
  errors,
}: {
  value: EmailDefaults;
  onChange: (v: EmailDefaults) => void;
  errors: Errors;
}) {
  return (
    <>
      <Input
        label="To"
        value={value.to}
        onChange={(e) => onChange({ ...value, to: e.target.value })}
        error={errors.to}
        hint="Separate several addresses with commas."
        autoComplete="off"
      />
      <Input label="CC" value={value.cc} onChange={(e) => onChange({ ...value, cc: e.target.value })} error={errors.cc} autoComplete="off" />
      <Input label="Subject" value={value.subject} onChange={(e) => onChange({ ...value, subject: e.target.value })} error={errors.subject} />
      <Textarea
        label="Message"
        rows={8}
        value={value.message}
        onChange={(e) => onChange({ ...value, message: e.target.value })}
        error={errors.message}
        hint="The invoice PDF is attached. Replies come to you."
      />
    </>
  );
}

/**
 * Send… : number the invoice, save its PDF, email it (or just mark it
 * sent). After a failure the same button retries without a new number.
 */
export function SendDialog({
  open,
  onOpenChange,
  defaults,
  retrying,
  onSend,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaults: SendDefaults | null;
  /** Sending already started: the number is set and Retry finishes it. */
  retrying: boolean;
  onSend: (input: Record<string, unknown>) => Promise<Result>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {defaults ? (
        // Fresh state each time the dialog opens with new defaults.
        <SendForm key={defaults.expectedNumber + defaults.issueDate} defaults={defaults} retrying={retrying} onSend={onSend} onCancel={() => onOpenChange(false)} />
      ) : (
        <DialogContent title="Send invoice">
          <p className="m-0 text-sm text-muted">Getting it ready…</p>
        </DialogContent>
      )}
    </Dialog>
  );
}

function SendForm({
  defaults,
  retrying,
  onSend,
  onCancel,
}: {
  defaults: SendDefaults;
  retrying: boolean;
  onSend: (input: Record<string, unknown>) => Promise<Result>;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState<EmailDefaults>(defaults);
  const [issueDate, setIssueDate] = useState(defaults.issueDate);
  const [busy, setBusy] = useState<"email" | "mark" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(retrying);
  const [errors, setErrors] = useState<Errors>({});

  async function go(mode: "email" | "mark") {
    setBusy(mode);
    setError(null);
    setErrors({});
    const r = await onSend(
      mode === "email" ? { mode, issueDate, expectedNumber: defaults.expectedNumber, ...email } : { mode, issueDate },
    ).catch(() => ({ ok: false, error: "Couldn't reach the server. Check your connection and try again.", retry: true }) as Result);
    setBusy(null);
    if (r.ok) return;
    if (r.retry) setRetry(true);
    const fields = r.fieldErrors ?? {};
    setErrors(fields);
    if (!Object.keys(fields).length) setError(r.error ?? "Couldn't send. Try again.");
  }

  return (
    <DialogContent
      title={retry ? `Finish sending ${defaults.expectedNumber}` : "Send invoice"}
      description={
        retry
          ? `Invoice ${defaults.expectedNumber} is numbered but not sent yet. Retry picks up where it stopped; the email won't go twice.`
          : `It will be invoice ${defaults.expectedNumber}. The number is given when you send.`
      }
      className="max-w-[600px]"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={!!busy}>
            Cancel
          </Button>
          <Button onClick={() => void go("mark")} disabled={!!busy}>
            {busy === "mark" ? "Saving…" : "Mark sent without emailing"}
          </Button>
          <Button variant="primary" onClick={() => void go("email")} disabled={!!busy}>
            {busy === "email" ? "Sending…" : retry ? "Retry" : "Email it"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <ErrorBanner message={error} />}
        <Input
          type="date"
          label="Issue date"
          value={issueDate}
          onChange={(e) => setIssueDate(e.target.value)}
          error={errors.issueDate}
          disabled={retrying}
          hint={retrying ? "Set when it was numbered." : "The due date moves with it."}
        />
        <EmailFields value={email} onChange={setEmail} errors={errors} />
      </div>
    </DialogContent>
  );
}

/** Resend email: the saved PDF again; the status doesn't change. */
export function ResendDialog({
  open,
  onOpenChange,
  defaults,
  onSend,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaults: EmailDefaults;
  onSend: (input: EmailDefaults) => Promise<Result>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <ResendForm defaults={defaults} onSend={onSend} onDone={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function ResendForm({ defaults, onSend, onDone }: { defaults: EmailDefaults; onSend: (input: EmailDefaults) => Promise<Result>; onDone: () => void }) {
  const [email, setEmail] = useState(defaults);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  return (
    <DialogContent
      title="Resend invoice"
      description="Emails the saved PDF again. Nothing about the invoice changes."
      className="max-w-[600px]"
      footer={
        <>
          <Button variant="ghost" onClick={onDone} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const r = await onSend(email).catch(() => ({ ok: false, error: "Couldn't reach the server. Try again." }) as Result);
              setBusy(false);
              if (r.ok) return onDone();
              const fields = r.fieldErrors ?? {};
              setErrors(fields);
              if (!Object.keys(fields).length) setError(r.error ?? "Couldn't send. Try again.");
            }}
          >
            {busy ? "Sending…" : "Send"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <ErrorBanner message={error} />}
        <EmailFields value={email} onChange={setEmail} errors={errors} />
      </div>
    </DialogContent>
  );
}
