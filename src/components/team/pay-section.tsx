"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { segmentClasses, segmentGroupClasses } from "@/components/ui/segmented";
import { type PayType, hourlyCostCents } from "@/lib/calc/pay";
import { formatDate, formatMoney } from "@/lib/format";
import { moneyInput, parseMoney } from "@/lib/projects/form";
import {
  PAY_LABELS,
  PAY_MESSAGES,
  PAY_TYPES,
  type PayHistoryRow,
  bpToPercent,
  percentToBp,
} from "@/lib/team/pay";
import { savePay } from "@/server/team/actions";

/** "$70,200 / yr" or "$28.50 / h". */
function payLine(r: Pick<PayHistoryRow, "payType" | "amountCents" | "burdenBp">) {
  const amount =
    r.payType === "salary" ? `${formatMoney(r.amountCents)} / yr` : `${formatMoney(r.amountCents, { cents: true })} / h`;
  return `${amount} · ${bpToPercent(r.burdenBp)}% burden`;
}

function costLine(cents: number | null) {
  return cents === null ? PAY_MESSAGES.noHours : `${formatMoney(cents, { cents: true })} / h cost`;
}

/**
 * Pay in the person drawer (ADR 0008). Owner/admin only: the server only
 * sends `pay` to them. Their hourly cost replaces their role's cost rate.
 */
export function PaySection({
  membershipId,
  pay,
  weeklyHours,
  today,
  onChanged,
}: {
  membershipId: string;
  pay: PayHistoryRow[];
  weeklyHours: number;
  today: string;
  onChanged: (message: string) => void;
}) {
  const current = pay.find((r) => r.effectiveFrom <= today && (r.effectiveTo === null || r.effectiveTo >= today)) ?? null;
  const [editing, setEditing] = useState(false);

  return (
    <>
      <h3 className="cap mt-6 mb-2 text-xs font-semibold">Pay</h3>
      {editing ? (
        <PayForm
          membershipId={membershipId}
          start={pay[0] ?? null}
          weeklyHours={weeklyHours}
          today={today}
          onCancel={() => setEditing(false)}
          onSaved={(msg) => {
            setEditing(false);
            onChanged(msg);
          }}
        />
      ) : (
        <>
          {current ? (
            <p className="m-0 text-sm">
              {payLine(current)}
              <span className="num block text-[12.5px] text-ink-3">{costLine(current.hourlyCostCents)}</span>
            </p>
          ) : (
            <p className="m-0 text-sm text-ink-3">No pay entered. Their role&apos;s cost rate is used.</p>
          )}
          <Button className="mt-3" onClick={() => setEditing(true)}>
            {pay.length ? "Change pay" : "Add pay"}
          </Button>
        </>
      )}
      {pay.length > 0 && (
        <ul className="m-0 mt-4 flex list-none flex-col p-0 text-[12.5px] text-ink-3" aria-label="Pay history">
          {pay.map((r) => (
            <li key={r.effectiveFrom} className="border-b border-line-soft py-1.5 last:border-b-0">
              {formatDate(r.effectiveFrom)}
              {r.effectiveTo ? ` – ${formatDate(r.effectiveTo)}` : " on"} · {payLine(r)}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function PayForm({
  membershipId,
  start,
  weeklyHours,
  today,
  onCancel,
  onSaved,
}: {
  membershipId: string;
  /** The newest period, to start the form from. */
  start: PayHistoryRow | null;
  weeklyHours: number;
  today: string;
  onCancel: () => void;
  onSaved: (message: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState({
    payType: (start?.payType ?? "salary") as PayType,
    amount: start ? moneyInput(start.amountCents) : "",
    // A first pay starts at 0% burden so each person's real figure gets typed in.
    burden: start ? bpToPercent(start.burdenBp) : "0",
    effectiveFrom: today,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (x: Partial<typeof v>) => setV((s) => ({ ...s, ...x }));

  const amountCents = parseMoney(v.amount);
  const burdenBp = percentToBp(v.burden);
  const preview =
    amountCents !== null && amountCents > 0 && burdenBp !== null
      ? hourlyCostCents({ payType: v.payType, amountCents, burdenBp }, weeklyHours)
      : undefined;

  function save() {
    const errs: Record<string, string> = {};
    if (amountCents === null || v.amount.trim() === "")
      errs.amountCents = v.payType === "salary" ? PAY_MESSAGES.salary : PAY_MESSAGES.wage;
    if (burdenBp === null) errs.burdenBp = PAY_MESSAGES.burden;
    if (Object.keys(errs).length) return setErrors(errs);
    startTransition(async () => {
      const r = await savePay({ membershipId, payType: v.payType, amountCents, burdenBp, effectiveFrom: v.effectiveFrom });
      if (!r.ok) return setErrors({ ...(r.fieldErrors ?? {}), ...(r.error ? { form: r.error } : {}) } as Record<string, string>);
      onSaved("Pay saved");
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Paid by" className={segmentGroupClasses}>
        {PAY_TYPES.map((t) => (
          <button key={t} type="button" aria-pressed={v.payType === t} className={segmentClasses(v.payType === t)} onClick={() => set({ payType: t })}>
            {PAY_LABELS[t]}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input
          label={v.payType === "salary" ? "Annual salary ($)" : "Hourly wage ($)"}
          value={v.amount}
          inputMode="decimal"
          error={errors.amountCents}
          onChange={(e) => set({ amount: e.target.value })}
        />
        <Input
          label="Burden (%)"
          hint="Taxes and benefits"
          value={v.burden}
          inputMode="decimal"
          error={errors.burdenBp}
          onChange={(e) => set({ burden: e.target.value })}
        />
      </div>
      <Input
        label="Starts on"
        type="date"
        value={v.effectiveFrom}
        error={errors.effectiveFrom}
        hint="Time worked from this date uses the new cost."
        onChange={(e) => set({ effectiveFrom: e.target.value })}
      />
      {preview !== undefined && <p className="num m-0 text-sm">{costLine(preview)}</p>}
      {errors.form && (
        <p role="alert" className="m-0 text-sm text-red">
          {errors.form}
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="primary" disabled={pending} onClick={save}>
          Save pay
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
