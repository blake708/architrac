"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import {
  ROLE_DESCRIPTION_MAX,
  ROLE_NAME_MAX,
  type RatesView,
  type RoleView,
  rateErrors,
  startOfYear,
} from "@/lib/settings/rates";
import { addRole, editRole } from "@/server/settings/actions";

type Errors = Partial<Record<string, string>>;

const num = (s: string) => (s.trim() === "" ? Number.NaN : Number(s));

/**
 * Add role / Edit role (settings-rates-phases spec, Actions). Both save
 * straight away. Edit asks for a bill rate only when switching a role from
 * not billable to billable.
 */
export function RoleDialog({
  open,
  onOpenChange,
  role,
  today,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null = Add role. */
  role: RoleView | null;
  today: string;
  onSaved: (view: RatesView, message: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <RoleDialogBody
          key={role?.id ?? "new"}
          role={role}
          today={today}
          onCancel={() => onOpenChange(false)}
          onSaved={onSaved}
        />
      )}
    </Dialog>
  );
}

function RoleDialogBody({
  role,
  today,
  onCancel,
  onSaved,
}: {
  role: RoleView | null;
  today: string;
  onCancel: () => void;
  onSaved: (view: RatesView, message: string) => void;
}) {
  const isNew = role === null;
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [isBillable, setIsBillable] = useState(role?.isBillable ?? true);
  const [bill, setBill] = useState("");
  const [cost, setCost] = useState("");
  const [from, setFrom] = useState(startOfYear(today));
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const askBill = isNew ? isBillable : isBillable && !role.isBillable;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const local: Errors = {};
    if (!name.trim()) local.name = "Enter a role name";
    const rate = rateErrors(
      isBillable,
      askBill ? num(bill) : null,
      isNew ? num(cost) : null,
    );
    if (rate.bill) local.billDollars = rate.bill;
    if (rate.cost) local.costDollars = rate.cost;
    if (isNew && !from) local.effectiveFrom = "Pick a date";
    setErrors(local);
    if (Object.keys(local).length > 0) return;

    startTransition(async () => {
      const result = isNew
        ? await addRole({
            name,
            description,
            isBillable,
            billDollars: isBillable ? num(bill) : 0,
            costDollars: num(cost),
            effectiveFrom: from,
          })
        : await editRole({
            id: role.id,
            name,
            description,
            isBillable,
            billDollars: askBill ? num(bill) : null,
          });
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setFormError(result.error ?? null);
        return;
      }
      onSaved(result.data.view, isNew ? "Role added" : "Role updated");
    });
  }

  return (
    <DialogContent
      title={isNew ? "Add role" : "Edit role"}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button
            variant="primary"
            type="submit"
            form="role-dialog-form"
            disabled={pending}
          >
            {pending ? "Saving…" : isNew ? "Add role" : "Save role"}
          </Button>
        </>
      }
    >
      <form
        id="role-dialog-form"
        onSubmit={submit}
        noValidate
        className="flex flex-col gap-4"
      >
        {formError && (
          <p role="alert" className="m-0 text-[12.5px] text-red">
            {formError}
          </p>
        )}
        <Input
          label="Name"
          value={name}
          maxLength={ROLE_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
          autoFocus
        />
        <Input
          label="Description"
          value={description}
          maxLength={ROLE_DESCRIPTION_MAX}
          onChange={(e) => setDescription(e.target.value)}
          error={errors.description}
          hint="Shown under the role name, e.g. “Production and design”"
        />
        <label className="flex items-center gap-2 text-base">
          <input
            type="checkbox"
            checked={isBillable}
            onChange={(e) => setIsBillable(e.target.checked)}
            className="size-4 accent-ink"
          />
          Billable
        </label>
        {!isNew && role.isBillable && !isBillable && (
          <p className="m-0 text-[12.5px] text-muted">
            The bill rate becomes $0 from today. Time already approved keeps
            its rate.
          </p>
        )}
        <div className="flex flex-wrap gap-4">
          {askBill && (
            <Input
              label="Bill rate $ / h"
              type="number"
              inputMode="numeric"
              min={0}
              step={5}
              value={bill}
              onChange={(e) => setBill(e.target.value)}
              error={errors.billDollars}
              hint={isNew ? undefined : "Applies from today"}
              wrapperClassName="w-[160px]"
              className="num text-right"
            />
          )}
          {isNew && (
            <Input
              label="Cost rate $ / h"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              error={errors.costDollars}
              wrapperClassName="w-[160px]"
              className="num text-right"
            />
          )}
          {isNew && (
            <Input
              label="Effective from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              error={errors.effectiveFrom}
              wrapperClassName="w-[180px]"
            />
          )}
        </div>
      </form>
    </DialogContent>
  );
}
