"use client";

import { useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { MONTHS, TIMEZONES } from "@/lib/timezones";
import { createFirm } from "@/server/firms/actions";

// Shared form styles until the UI kit (milestone 0.4) provides Input/Select/Button.
const label = "text-xs font-semibold uppercase tracking-[0.08em] text-ink-3";
const control =
  "h-[var(--height-control)] w-full rounded-sm border border-line-input bg-surface px-3 text-base text-ink focus:border-ink focus:outline-none aria-[invalid=true]:border-red";
const fieldError = "text-xs text-red";

export function CreateFirmForm() {
  const [state, formAction, pending] = useActionState(createFirm, null);
  const { setActive } = useClerk();
  const router = useRouter();

  // Once the firm exists, make it the active Clerk organization and go to the app.
  useEffect(() => {
    if (!state?.ok) return;
    void setActive({ organization: state.data.clerkOrgId }).then(() => {
      router.push("/app");
      router.refresh();
    });
  }, [state, setActive, router]);

  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  // Still busy after the firm is saved, while Clerk switches to it.
  const busy = pending || state?.ok === true;

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="name" className={label}>
          Firm name
        </label>
        <input
          id="name"
          name="name"
          required
          autoComplete="organization"
          className={control}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? "name-error" : undefined}
        />
        {errors.name && (
          <p id="name-error" className={fieldError}>
            {errors.name}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="timezone" className={label}>
          Time zone
        </label>
        <select
          id="timezone"
          name="timezone"
          defaultValue="America/New_York"
          className={control}
          aria-invalid={errors.timezone ? true : undefined}
          aria-describedby={errors.timezone ? "timezone-error" : undefined}
        >
          {TIMEZONES.map((tz) => (
            <option key={tz.value} value={tz.value}>
              {tz.label}
            </option>
          ))}
        </select>
        {errors.timezone && (
          <p id="timezone-error" className={fieldError}>
            {errors.timezone}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="fiscalYearStartMonth" className={label}>
          Fiscal year starts in
        </label>
        <select
          id="fiscalYearStartMonth"
          name="fiscalYearStartMonth"
          defaultValue="1"
          className={control}
          aria-invalid={errors.fiscalYearStartMonth ? true : undefined}
          aria-describedby={
            errors.fiscalYearStartMonth ? "month-error" : undefined
          }
        >
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        {errors.fiscalYearStartMonth && (
          <p id="month-error" className={fieldError}>
            {errors.fiscalYearStartMonth}
          </p>
        )}
      </div>

      {state && !state.ok && state.error && (
        <p role="alert" className="text-sm text-red">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="h-[var(--height-control)] rounded-sm bg-ink px-4 text-sm font-semibold text-surface disabled:opacity-60"
      >
        {busy ? "Creating firm…" : "Create firm"}
      </button>
    </form>
  );
}
