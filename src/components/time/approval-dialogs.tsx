"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/field";
import { RETURN_NOTE_MAX, onBehalfNoteProblem, returnNoteProblem } from "@/lib/time/approval";

// Return, Approve-for and bulk Approve dialogs (timesheet-approval spec,
// Layout 6–9). Each calls `onConfirm` and shows its error inline; the dialog
// closes when it returns null.

type Common = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Return (or Reopen and return) with a required note. */
export function ReturnDialog({
  open,
  onOpenChange,
  initials,
  reopen = false,
  onConfirm,
}: Common & { initials: string; reopen?: boolean; onConfirm: (note: string) => Promise<string | null> }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const problem = returnNoteProblem(note, initials);
    if (problem) return setError(problem);
    setBusy(true);
    const err = await onConfirm(note.trim());
    setBusy(false);
    if (err) return setError(err);
    setNote("");
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setError(null);
        onOpenChange(o);
      }}
    >
      <DialogContent
        title={reopen ? `Reopen and return to ${initials}` : `Return timesheet to ${initials}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={submit} disabled={busy}>
              {reopen ? "Reopen and return" : "Return timesheet"}
            </Button>
          </>
        }
      >
        <Textarea
          label="What needs to change?"
          hint={`${initials} is notified with this note. Approvals already given on this timesheet are cleared.`}
          error={error ?? undefined}
          value={note}
          maxLength={RETURN_NOTE_MAX + 50}
          onChange={(e) => {
            setNote(e.target.value);
            setError(null);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Owner/admin stepping in for an approver who's out (rule 3f). */
export function ApproveForDialog({
  open,
  onOpenChange,
  names,
  onConfirm,
}: Common & { names: string; onConfirm: (note: string) => Promise<string | null> }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const short = names.replace(/ and /, ", ");

  async function submit() {
    const problem = onBehalfNoteProblem(note);
    if (problem) return setError(problem);
    setBusy(true);
    const err = await onConfirm(note.trim());
    setBusy(false);
    if (err) return setError(err);
    setNote("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Approve for ${names}?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} disabled={busy}>
              {`Approve for ${short}`}
            </Button>
          </>
        }
      >
        <p className="m-0 mb-4 text-sm">
          {`Use this when ${names} ${names.includes(" and ") ? "are" : "is"} out or can't review. It's recorded as approved by you for ${names}, and ${names} ${names.includes(" and ") ? "are" : "is"} notified.`}
        </p>
        <Textarea
          label="Note (optional)"
          error={error ?? undefined}
          value={note}
          rows={3}
          onChange={(e) => {
            setNote(e.target.value);
            setError(null);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Bulk approve confirm (Layout 8). */
export function ConfirmApproveDialog({
  open,
  onOpenChange,
  count,
  onConfirm,
}: Common & { count: number; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Approve ${count} timesheet${count === 1 ? "" : "s"}?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await onConfirm();
                setBusy(false);
                onOpenChange(false);
              }}
            >
              Approve
            </Button>
          </>
        }
      >
        <p className="m-0 text-sm">
          This approves your step on each one. Timesheets that finish their route lock the rates in effect on each work date.
        </p>
      </DialogContent>
    </Dialog>
  );
}
