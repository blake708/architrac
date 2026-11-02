import { z } from "zod";
import { formatDate } from "@/lib/format";

// Settings → Roles & rates (settings-rates-phases spec, section B and the
// Actions table). Shared by the form and the server. Rates are typed as
// whole dollars and stored as cents.

export type RateHistoryRow = {
  effectiveFrom: string;
  effectiveTo: string | null;
  billCents: number;
  costCents: number;
};

export type RoleView = {
  id: string;
  name: string;
  description: string;
  isBillable: boolean;
  people: number;
  /** The rate in force today (or the newest one if none is yet). */
  billCents: number;
  costCents: number;
  effectiveFrom: string | null;
  /** Newest first. */
  history: RateHistoryRow[];
};

export type RatesView = {
  roles: RoleView[];
  overheadBp: number;
  includeOverheadDefault: boolean;
  /** Today in the firm's time zone, "YYYY-MM-DD". */
  today: string;
};

export const RATE_MAX_DOLLARS = 9999;
export const OVERHEAD_MAX_PCT = 300;
export const ROLE_NAME_MAX = 60;
export const ROLE_DESCRIPTION_MAX = 200;

export const RATE_MESSAGES = {
  rate: `Enter whole dollars from 0 to ${RATE_MAX_DOLLARS.toLocaleString("en-US")}`,
  billMin: "Billable roles need a bill rate of at least $1",
  overhead: `Enter a whole percent from 0 to ${OVERHEAD_MAX_PCT}`,
  date: "Pick a date",
  roleName: "Enter a role name",
  roleNameLong: `Role names can be up to ${ROLE_NAME_MAX} characters`,
  roleNameTaken: "A role with this name already exists",
  description: `Descriptions can be up to ${ROLE_DESCRIPTION_MAX} characters`,
  summary: "Fix the highlighted items, then save.",
} as const;

export function earliestDateMessage(earliest: string, role: string) {
  return `Pick ${formatDate(earliest)} or later — ${role}'s current rate starts then.`;
}

export function archiveBlockedMessage(people: number, role: string) {
  return `Move the ${people} ${people === 1 ? "person" : "people"} in ${role} to another role on the Team page first.`;
}

export const dollarsToCents = (dollars: number) => Math.round(dollars * 100);

const isoDate = z.iso.date({ error: RATE_MESSAGES.date });

/** True when a typed rate is acceptable (whole dollars, in range). */
export function validDollars(n: number) {
  return Number.isInteger(n) && n >= 0 && n <= RATE_MAX_DOLLARS;
}

/** Save (Rates): changed role rates, the date they start, and overhead. */
export const saveRatesSchema = z.object({
  roles: z
    .array(
      z.object({
        id: z.uuid(),
        billDollars: z.number(),
        costDollars: z.number(),
      }),
    )
    .max(200),
  /** Required when any rate changed. */
  effectiveFrom: isoDate.nullable(),
  overheadPct: z.number(),
  includeOverheadDefault: z.boolean(),
});
export type SaveRatesInput = z.infer<typeof saveRatesSchema>;

/** The Add role and Edit role dialogs. */
export const roleSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: RATE_MESSAGES.roleName })
    .max(ROLE_NAME_MAX, { error: RATE_MESSAGES.roleNameLong }),
  description: z
    .string()
    .trim()
    .max(ROLE_DESCRIPTION_MAX, { error: RATE_MESSAGES.description }),
  isBillable: z.boolean(),
});

export const addRoleSchema = roleSchema.extend({
  billDollars: z.number(),
  costDollars: z.number(),
  effectiveFrom: isoDate,
});
export type AddRoleInput = z.infer<typeof addRoleSchema>;

export const editRoleSchema = roleSchema.extend({
  id: z.uuid(),
  /** Only used when switching a role from not billable to billable. */
  billDollars: z.number().nullable(),
});
export type EditRoleInput = z.infer<typeof editRoleSchema>;

/** Rate checks shared by the dialogs and Save (rule: integers, bill ≥ 1 if billable). */
export function rateErrors(
  isBillable: boolean,
  billDollars: number | null,
  costDollars: number | null,
): { bill?: string; cost?: string } {
  const out: { bill?: string; cost?: string } = {};
  if (costDollars !== null && !validDollars(costDollars))
    out.cost = RATE_MESSAGES.rate;
  if (isBillable && billDollars !== null) {
    if (!validDollars(billDollars)) out.bill = RATE_MESSAGES.rate;
    else if (billDollars < 1) out.bill = RATE_MESSAGES.billMin;
  }
  return out;
}

/** First Jan 1 of the year of a "YYYY-MM-DD" date (Add role default). */
export function startOfYear(isoDay: string) {
  return `${isoDay.slice(0, 4)}-01-01`;
}
