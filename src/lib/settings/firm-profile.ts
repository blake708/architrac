import { z } from "zod";
import { TIMEZONE_VALUES } from "@/lib/timezones";

// Settings → Firm profile: the fields, their checks and how values are cleaned
// up before saving (settings-firm spec, Layout §3 and business rule 5).
// Used by the form in the browser and again by the server action.

export const US_STATES = [
  ["AL", "Alabama"],
  ["AK", "Alaska"],
  ["AZ", "Arizona"],
  ["AR", "Arkansas"],
  ["CA", "California"],
  ["CO", "Colorado"],
  ["CT", "Connecticut"],
  ["DE", "Delaware"],
  ["DC", "District of Columbia"],
  ["FL", "Florida"],
  ["GA", "Georgia"],
  ["HI", "Hawaii"],
  ["ID", "Idaho"],
  ["IL", "Illinois"],
  ["IN", "Indiana"],
  ["IA", "Iowa"],
  ["KS", "Kansas"],
  ["KY", "Kentucky"],
  ["LA", "Louisiana"],
  ["ME", "Maine"],
  ["MD", "Maryland"],
  ["MA", "Massachusetts"],
  ["MI", "Michigan"],
  ["MN", "Minnesota"],
  ["MS", "Mississippi"],
  ["MO", "Missouri"],
  ["MT", "Montana"],
  ["NE", "Nebraska"],
  ["NV", "Nevada"],
  ["NH", "New Hampshire"],
  ["NJ", "New Jersey"],
  ["NM", "New Mexico"],
  ["NY", "New York"],
  ["NC", "North Carolina"],
  ["ND", "North Dakota"],
  ["OH", "Ohio"],
  ["OK", "Oklahoma"],
  ["OR", "Oregon"],
  ["PA", "Pennsylvania"],
  ["RI", "Rhode Island"],
  ["SC", "South Carolina"],
  ["SD", "South Dakota"],
  ["TN", "Tennessee"],
  ["TX", "Texas"],
  ["UT", "Utah"],
  ["VT", "Vermont"],
  ["VA", "Virginia"],
  ["WA", "Washington"],
  ["WV", "West Virginia"],
  ["WI", "Wisconsin"],
  ["WY", "Wyoming"],
] as const;

export const DEFAULT_STATE = "SC";
const STATE_CODES = US_STATES.map(([code]) => code) as string[];

/** "843.555.0100" → "(843) 555-0100". Null if it isn't 10 digits. */
export function formatPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 10) return null;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** "https://www.TMG-Arch.com/" → "www.tmg-arch.com". */
export function normalizeWebsite(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

export const FIRM_NAME_REQUIRED = "Firm name is required";
export const FIRM_NAME_LENGTH = "Firm name must be 2–120 characters";
export const ZIP_MESSAGE = "Enter a 5-digit ZIP";
export const PHONE_MESSAGE = "Enter a 10-digit phone number";
export const WEBSITE_MESSAGE = "Enter a website like www.example.com";

/** Trim; empty becomes null. */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, { error: `${label} must be ${max} characters or fewer` })
    .transform((v) => (v === "" ? null : v));

export const firmProfileSchema = z.object({
  name: z
    .string({ error: FIRM_NAME_REQUIRED })
    .trim()
    .min(1, { error: FIRM_NAME_REQUIRED })
    .min(2, { error: FIRM_NAME_LENGTH })
    .max(120, { error: FIRM_NAME_LENGTH }),
  displayName: optionalText(80, "Display name"),
  addressLine1: optionalText(200, "Address"),
  addressLine2: optionalText(100, "Suite / unit"),
  city: optionalText(100, "City"),
  state: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v.toUpperCase()))
    .refine((v) => v === null || STATE_CODES.includes(v), {
      error: "Pick a state from the list",
    }),
  postalCode: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{5}(-\d{4})?$/.test(v), {
      error: ZIP_MESSAGE,
    })
    .transform((v) => (v === "" ? null : v)),
  phone: z
    .string()
    .trim()
    .refine((v) => v === "" || formatPhone(v) !== null, {
      error: PHONE_MESSAGE,
    })
    .transform((v) => (v === "" ? null : formatPhone(v))),
  website: z
    .string()
    .transform(normalizeWebsite)
    .refine((v) => v === "" || (v.includes(".") && !/\s/.test(v)), {
      error: WEBSITE_MESSAGE,
    })
    .refine((v) => v.length <= 200, { error: WEBSITE_MESSAGE })
    .transform((v) => (v === "" ? null : v)),
  licenseNumber: optionalText(50, "License number"),
  timezone: z.enum(TIMEZONE_VALUES, { error: "Pick a time zone from the list" }),
  fiscalYearStartMonth: z.coerce
    .number({ error: "Pick a month" })
    .int({ error: "Pick a month" })
    .min(1, { error: "Pick a month" })
    .max(12, { error: "Pick a month" }),
});

/** What the form sends: every field as a string. */
export type FirmProfileForm = Record<keyof FirmProfileValues, string>;
/** What gets saved, after clean-up. */
export type FirmProfileValues = z.output<typeof firmProfileSchema>;
export type FirmProfileField = keyof FirmProfileValues;

/** Form fields in screen order (the first error gets focus). */
export const FIRM_PROFILE_FIELDS: FirmProfileField[] = [
  "name",
  "displayName",
  "addressLine1",
  "addressLine2",
  "city",
  "state",
  "postalCode",
  "phone",
  "website",
  "licenseNumber",
  "timezone",
  "fiscalYearStartMonth",
];

/** Database column names, for the activity log. */
export const FIRM_PROFILE_COLUMNS: Record<FirmProfileField, string> = {
  name: "name",
  displayName: "display_name",
  addressLine1: "address_line1",
  addressLine2: "address_line2",
  city: "city",
  state: "state",
  postalCode: "postal_code",
  phone: "phone",
  website: "website",
  licenseNumber: "license_number",
  timezone: "timezone",
  fiscalYearStartMonth: "fiscal_year_start_month",
};

export type FieldErrors<F extends string> = Partial<Record<F, string>>;

export type ParsedFirmProfile =
  | { ok: true; values: FirmProfileValues }
  | { ok: false; fieldErrors: FieldErrors<FirmProfileField> };

/** Check and clean the form. Field errors keep the first message per field. */
export function parseFirmProfile(raw: unknown): ParsedFirmProfile {
  const parsed = firmProfileSchema.safeParse(raw);
  if (parsed.success) return { ok: true, values: parsed.data };
  const fieldErrors: FieldErrors<FirmProfileField> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as FirmProfileField;
    fieldErrors[field] ??= issue.message;
  }
  return { ok: false, fieldErrors };
}

/** Saved values → form strings (nulls become empty). */
export function firmProfileForm(
  firm: Record<FirmProfileField, string | number | null>,
): FirmProfileForm {
  const form = {} as FirmProfileForm;
  for (const f of FIRM_PROFILE_FIELDS) {
    const v = firm[f];
    form[f] = v === null || v === undefined ? "" : String(v);
  }
  return form;
}

type Change = { before: unknown; after: unknown };

/**
 * Before/after for the fields that changed only, keyed by column name
 * (activity_log.changes).
 */
export function firmProfileChanges(
  before: { [K in FirmProfileField]: unknown },
  after: FirmProfileValues,
): Record<string, Change> {
  const changes: Record<string, Change> = {};
  for (const f of FIRM_PROFILE_FIELDS) {
    const b = before[f] ?? null;
    const a = after[f] ?? null;
    if (b !== a) changes[FIRM_PROFILE_COLUMNS[f]] = { before: b, after: a };
  }
  return changes;
}

/** The name the app shows: display name, else the legal name. */
export function firmDisplayName(firm: {
  name: string;
  displayName: string | null;
}): string {
  return firm.displayName ?? firm.name;
}
