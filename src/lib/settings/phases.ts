import { z } from "zod";

// Settings → Phases & fees (settings-rates-phases spec, section A, Actions
// and rule 10). Shared by the form (live errors) and the server (final check).

export const FEE_TYPES = ["fixed", "hourly", "nte"] as const;
export type FeeType = (typeof FEE_TYPES)[number];

export const FEE_TYPE_LABELS: Record<FeeType, string> = {
  fixed: "Fixed",
  hourly: "Hourly",
  nte: "Not to exceed",
};

/** One row in either list. `id` is null for a row added in this form. */
export type PhaseRow = {
  id: string | null;
  code: string;
  name: string;
  description: string;
  /** % of fee, whole number. Always 0 for optional phases. */
  pct: number;
  feeType: FeeType;
};

export type PhasesForm = { defaults: PhaseRow[]; optional: PhaseRow[] };
export type PhaseList = keyof PhasesForm;

export const NAME_MAX = 60;
export const CODE_MAX = 6;
export const DESCRIPTION_MAX = 500;

export const PHASE_MESSAGES = {
  nameRequired: "Enter a phase name",
  nameLong: `Phase names can be up to ${NAME_MAX} characters`,
  codeInvalid: `Use 1–${CODE_MAX} letters, numbers or dashes`,
  codeTaken: "Abbreviation already used by another phase",
  nameTaken: "Name already used by another phase",
  pctInvalid: "Enter a whole number from 0 to 100",
  descriptionLong: `Descriptions can be up to ${DESCRIPTION_MAX} characters`,
  keepOne: "Keep at least one default phase",
  summary: "Fix the highlighted items, then save.",
} as const;

export function shareTotalMessage(total: number) {
  return `Phase shares must add up to 100%. Now ${total}%.`;
}

const CODE_RE = /^[A-Z0-9-]+$/;

/** Abbreviations are stored upper-case; the input upper-cases as you type. */
export function normalizeCode(raw: string) {
  return raw.toUpperCase().replace(/\s+/g, "");
}

/** Shape check only; the rules are in validatePhases. */
const rowSchema = z.object({
  id: z.uuid().nullable(),
  code: z.string().max(100),
  name: z.string().max(500),
  description: z.string().max(5000),
  pct: z.number().finite(),
  feeType: z.enum(FEE_TYPES),
});
export const phasesFormSchema = z.object({
  defaults: z.array(rowSchema).max(50),
  optional: z.array(rowSchema).max(50),
});

/** Total % of the default phases. Optional phases never count. */
export function shareTotal(rows: readonly Pick<PhaseRow, "pct">[]) {
  return rows.reduce((n, r) => n + (Number.isFinite(r.pct) ? r.pct : 0), 0);
}

/** Share bar width in % of the track: 40% of fee fills it (mockup). */
export function shareBarWidth(pct: number) {
  return Math.max(0, Math.min(100, (pct / 40) * 100));
}

/** Error keys: "defaults.2.code", "optional.0.name", "list", "total". */
export type PhaseErrors = Record<string, string>;

export function validatePhases(form: PhasesForm): PhaseErrors {
  const errors: PhaseErrors = {};
  const codes = new Map<string, number>();
  const names = new Map<string, number>();
  const all = [
    ...form.defaults.map((r, i) => ({ r, key: `defaults.${i}` })),
    ...form.optional.map((r, i) => ({ r, key: `optional.${i}` })),
  ];
  for (const { r } of all) {
    const c = normalizeCode(r.code);
    const n = r.name.trim().toLowerCase();
    if (c) codes.set(c, (codes.get(c) ?? 0) + 1);
    if (n) names.set(n, (names.get(n) ?? 0) + 1);
  }

  for (const { r, key } of all) {
    const name = r.name.trim();
    const code = normalizeCode(r.code);
    if (!name) errors[`${key}.name`] = PHASE_MESSAGES.nameRequired;
    else if (name.length > NAME_MAX) errors[`${key}.name`] = PHASE_MESSAGES.nameLong;
    else if ((names.get(name.toLowerCase()) ?? 0) > 1)
      errors[`${key}.name`] = PHASE_MESSAGES.nameTaken;

    if (!code || code.length > CODE_MAX || !CODE_RE.test(code))
      errors[`${key}.code`] = PHASE_MESSAGES.codeInvalid;
    else if ((codes.get(code) ?? 0) > 1)
      errors[`${key}.code`] = PHASE_MESSAGES.codeTaken;

    if (r.description.trim().length > DESCRIPTION_MAX)
      errors[`${key}.description`] = PHASE_MESSAGES.descriptionLong;
  }

  form.defaults.forEach((r, i) => {
    if (!Number.isInteger(r.pct) || r.pct < 0 || r.pct > 100)
      errors[`defaults.${i}.pct`] = PHASE_MESSAGES.pctInvalid;
  });

  if (form.defaults.length === 0) errors.list = PHASE_MESSAGES.keepOne;
  const total = shareTotal(form.defaults);
  if (form.defaults.length > 0 && total !== 100)
    errors.total = shareTotalMessage(total);
  return errors;
}

/** The values to store for a row (trimmed; optional phases have no share). */
export function cleanPhaseRow(row: PhaseRow, list: PhaseList) {
  const description = row.description.trim();
  return {
    code: normalizeCode(row.code),
    name: row.name.trim(),
    description: description === "" ? null : description,
    isOptional: list === "optional",
    // Default phases don't show fee type; new ones start "fixed" in the form
    // and existing ones keep what's stored.
    defaultFeeType: row.feeType,
    defaultFeeShareBp: list === "optional" ? 0 : Math.round(row.pct * 100),
  };
}
