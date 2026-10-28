"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Input, Select } from "@/components/ui/field";
import {
  type FieldErrors,
  FIRM_PROFILE_FIELDS,
  type FirmProfileField,
  type FirmProfileForm,
  US_STATES,
  parseFirmProfile,
} from "@/lib/settings/firm-profile";
import { MONTHS, TIMEZONES } from "@/lib/timezones";
import { updateFirmProfile } from "@/server/settings/actions";
import { ErrorBanner } from "./error-banner";
import { useSettingsForm } from "./form-state";

const FORM_ID = "firm-profile-form";
const fieldId = (f: FirmProfileField) => `firm-${f}`;

type FieldDef = {
  field: FirmProfileField;
  label: string;
  hint?: string;
  type?: "text" | "tel";
  inputMode?: "numeric";
};

// Fields 1–10 (spec Layout §3); time zone and fiscal year are selects below.
const TEXT_FIELDS: FieldDef[] = [
  {
    field: "name",
    label: "Firm name",
    hint: "Legal name for invoices and contracts",
  },
  {
    field: "displayName",
    label: "Display name",
    hint: "Shown in the app and on letterhead",
  },
  { field: "addressLine1", label: "Address" },
  { field: "addressLine2", label: "Suite / unit" },
  { field: "city", label: "City" },
];
const TEXT_FIELDS_2: FieldDef[] = [
  { field: "postalCode", label: "ZIP", inputMode: "numeric" },
  { field: "phone", label: "Main phone", type: "tel" },
  { field: "website", label: "Website" },
  {
    field: "licenseNumber",
    label: "Firm license / COA number",
    hint: "Printed on drawings and proposals",
  },
];

/** Settings → Firm profile (settings-firm spec, Layout §3). */
export function FirmProfileFormSection({
  initial,
  logoUrl,
}: {
  initial: FirmProfileForm;
  logoUrl: string | null;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<FieldErrors<FirmProfileField>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const markSaved = useSettingsForm(FORM_ID, dirty, pending);

  function set(field: FirmProfileField, value: string) {
    setValues((v) => ({ ...v, [field]: value }));
    setDirty(true);
  }

  function showErrors(fieldErrors: FieldErrors<FirmProfileField>) {
    setErrors(fieldErrors);
    const first = FIRM_PROFILE_FIELDS.find((f) => fieldErrors[f]);
    if (first) document.getElementById(fieldId(first))?.focus();
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || pending) return;
    setBanner(null);

    // Check in the browser first, so mistakes show without a round trip.
    const checked = parseFirmProfile(values);
    if (!checked.ok) {
      showErrors(checked.fieldErrors);
      return;
    }

    startTransition(async () => {
      const result = await updateFirmProfile(values);
      if (!result.ok) {
        if (result.fieldErrors) showErrors(result.fieldErrors);
        else
          setBanner(
            result.error ?? "Couldn't save. Nothing was changed. Try again.",
          );
        return;
      }
      setErrors({});
      setValues(result.data.values);
      setDirty(false);
      markSaved();
      router.refresh(); // the header shows the new firm name
    });
  }

  const text = (d: FieldDef) => (
    <Input
      key={d.field}
      id={fieldId(d.field)}
      label={d.label}
      hint={d.hint}
      error={errors[d.field]}
      type={d.type ?? "text"}
      inputMode={d.inputMode}
      placeholder={d.field === "displayName" ? values.name : undefined}
      value={values[d.field]}
      onChange={(e) => set(d.field, e.target.value)}
    />
  );

  return (
    <form id={FORM_ID} onSubmit={onSubmit} noValidate className="contents">
      {banner && <ErrorBanner message={banner} />}
      <section
        aria-label="Firm profile"
        className="flex flex-wrap items-start gap-6 rounded-sm border border-line bg-surface px-6 pt-[22px] pb-6"
      >
        <div className="flex flex-col items-center gap-2.5">
          <span
            aria-hidden="true"
            className="num flex size-[120px] items-center justify-center overflow-hidden rounded-sm border border-dashed border-[#AFAFAF] bg-[repeating-linear-gradient(135deg,#F5F5F5_0_8px,#FFFFFF_8px_10px)] text-xs text-ink-3"
          >
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="size-full object-contain" />
            ) : (
              "LOGO"
            )}
          </span>
          {/* Logo upload needs a file storage decision (spec Out of scope). */}
          <button
            type="button"
            disabled
            title="Coming soon"
            className="h-8 cursor-not-allowed rounded-sm border border-line-input bg-surface px-3 text-sm text-faint"
          >
            Upload logo
          </button>
        </div>

        <div className="grid min-w-0 flex-[1_1_420px] grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-x-5 gap-y-4">
          {TEXT_FIELDS.map(text)}
          <Select
            id={fieldId("state")}
            label="State"
            error={errors.state}
            value={values.state}
            onChange={(e) => set("state", e.target.value)}
          >
            <option value="">—</option>
            {US_STATES.map(([code, name]) => (
              <option key={code} value={code}>
                {code} · {name}
              </option>
            ))}
          </Select>
          {TEXT_FIELDS_2.map(text)}
          <Select
            id={fieldId("timezone")}
            label="Time zone"
            hint="Used for due dates and reminders"
            error={errors.timezone}
            value={values.timezone}
            onChange={(e) => set("timezone", e.target.value)}
          >
            {TIMEZONES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
          <Select
            id={fieldId("fiscalYearStartMonth")}
            label="Fiscal year starts"
            hint="Used by Reports"
            error={errors.fiscalYearStartMonth}
            value={values.fiscalYearStartMonth}
            onChange={(e) => set("fiscalYearStartMonth", e.target.value)}
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={String(i + 1)}>
                {m}
              </option>
            ))}
          </Select>
        </div>
      </section>
    </form>
  );
}
