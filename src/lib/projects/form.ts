import { z } from "zod";
import type { FeeType, Health, ProjectStatus } from "@/lib/calc/projects";
import { formatMoney } from "@/lib/format";

// New project form (projects-list spec, "New project flow"). Shared by the
// page and the server, which re-runs every check.

export const PROJECT_STATUSES = ["active", "on_hold", "closed", "pursuit"] as const;
export const CREATE_STATUSES = ["active", "pursuit", "on_hold"] as const;

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  active: "Active",
  on_hold: "On hold",
  closed: "Closed",
  pursuit: "Pursuit",
};

export const FEE_TYPE_LABELS: Record<FeeType, string> = {
  fixed: "Fixed",
  hourly: "Hourly",
  nte: "Not-to-exceed",
};

export const FEE_TYPE_HELP: Record<FeeType, string> = {
  fixed: "Fixed: the fee for the phase.",
  hourly: "Hourly: billed by the hour, so 0% of the fee; type its budget hours.",
  nte: "Not-to-exceed: the cap.",
};

export const SCOPE_KINDS = ["ground_up", "tenant_upfit", "shell"] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];
export const SCOPE_LABELS: Record<ScopeKind, string> = {
  ground_up: "Ground-up",
  tenant_upfit: "Tenant upfit",
  shell: "Shell building",
};

export const STANDARD_TYPES = ["Medical office", "Restaurant", "Retail", "Office"];

export const HEALTH_SHAPES: Record<Health, "circle" | "diamond" | "square" | "none"> = {
  on_track: "circle",
  at_risk: "diamond",
  over_budget: "square",
  on_hold: "none",
  closed: "none",
  pursuit: "none",
};

export const PROJECT_MESSAGES = {
  forbidden: "You don't have access to create projects.",
  number: "Use letters, numbers and dashes (up to 20)",
  numberUsed: "Number already used",
  name: "Enter a project name",
  client: "Pick a client",
  type: "Pick a project type",
  principal: "Pick a principal in charge",
  pm: "Pick a project manager",
  dates: "Target end can't be before the start",
  squareFeet: "Enter a whole number above 0",
  money: "Enter an amount of $0 or more",
  hours: "Use quarter hours (0.25)",
  noPhases: "Include at least one phase",
  nteCap: "Not-to-exceed phases need a cap",
  hourlyFee: "Hourly phases have no fixed fee; they're billed by the hour",
  feeSum: (phases: number, total: number) =>
    `Phase fees add up to ${moneyExact(phases)}; total fee is ${moneyExact(total)}`,
  hoursSum: (phases: number, total: number) =>
    `Phase hours add up to ${phases}; total budget hours is ${total}`,
  long: "Too long",
  notClient: "That company isn't a client",
  badContact: "That contact doesn't work for this client",
  badPerson: "That person can't be picked here",
  created: (number: string) => `Project ${number} created`,
  editForbidden: "You don't have permission to change this project.",
  notFound: "That project doesn't exist or was archived.",
  keepPmPrincipal: "Change the PM or principal in Edit project first",
  alreadyOnTeam: "Already on this project",
  notConsultant: "That company isn't a consultant",
  notLinkable: "Pick a contractor, agency, vendor or other company",
  badCompanyContact: "That contact doesn't work for this company",
  alreadyLinked: "That company is already on this project",
  codeUsed: "Another phase already uses this code",
  consultantRow: "Fix the consultant marked in red",
} as const;

/** "$190,000" when whole dollars, "$1,000.01" otherwise. */
export const moneyExact = (cents: number) => formatMoney(cents, { cents: cents % 100 !== 0 });

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: PROJECT_MESSAGES.long })
    .transform((v) => (v === "" ? null : v));

const isoDate = z
  .string()
  .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v))
  .transform((v) => (v === "" ? null : v));

const cents = z.number().int().min(0, { error: PROJECT_MESSAGES.money }).max(1e13);
const quarterHours = z
  .number()
  .min(0, { error: PROJECT_MESSAGES.hours })
  .max(999_999)
  .refine((h) => Number.isInteger(h * 4), { error: PROJECT_MESSAGES.hours });

/** A phase's role mix: each role once, shares adding up to exactly 100% (or no mix). */
export const mixSchema = z
  .array(z.object({ firmRoleId: z.uuid(), shareBp: z.number().int().min(0).max(10_000) }))
  .max(20)
  .refine((rows) => new Set(rows.map((r) => r.firmRoleId)).size === rows.length, { error: "Each role once" })
  .refine((rows) => rows.length === 0 || rows.reduce((n, r) => n + r.shareBp, 0) === 10_000, {
    error: "Role shares must add up to 100%",
  });

export const phaseRowSchema = z.object({
  /** The template it came from (its description is copied on the server). */
  templateId: z.uuid().nullable(),
  code: z.string().trim().min(1).max(12, { error: PROJECT_MESSAGES.long }),
  name: z.string().trim().min(1).max(80, { error: PROJECT_MESSAGES.long }),
  feeType: z.enum(["fixed", "hourly", "nte"]),
  feeCents: cents,
  budgetHours: quarterHours,
  /** Hours were typed in (a later fee change leaves them alone). */
  budgetHoursManual: z.boolean().default(false),
  mix: mixSchema.default([]),
});
export type PhaseRowInput = z.input<typeof phaseRowSchema>;

/** The project's own fields (Card 1), shared by create and Edit project. */
const projectFields = {
    number: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{1,20}$/, { error: PROJECT_MESSAGES.number }),
    name: z
      .string()
      .trim()
      .min(1, { error: PROJECT_MESSAGES.name })
      .max(200, { error: PROJECT_MESSAGES.long }),
    clientCompanyId: z.uuid({ error: PROJECT_MESSAGES.client }),
    clientContactId: z.uuid().nullable(),
    projectType: z
      .string()
      .trim()
      .min(1, { error: PROJECT_MESSAGES.type })
      .max(60, { error: PROJECT_MESSAGES.long }),
    scopeKind: z.enum(SCOPE_KINDS).nullable(),
    status: z.enum(CREATE_STATUSES),
    principalMembershipId: z.uuid({ error: PROJECT_MESSAGES.principal }),
    pmMembershipId: z.uuid({ error: PROJECT_MESSAGES.pm }),
    addressLine1: optText(200),
    addressLine2: optText(200),
    city: optText(100),
    state: z
      .string()
      .trim()
      .toUpperCase()
      .refine((v) => v === "" || /^[A-Z]{2}$/.test(v), { error: "Use the 2-letter state code" })
      .transform((v) => (v === "" ? null : v)),
    postalCode: z
      .string()
      .trim()
      .refine((v) => v === "" || /^\d{5}(-\d{4})?$/.test(v), { error: "Enter a 5-digit ZIP or ZIP+4" })
      .transform((v) => (v === "" ? null : v)),
    squareFeet: z.number().int({ error: PROJECT_MESSAGES.squareFeet }).positive({ error: PROJECT_MESSAGES.squareFeet }).max(100_000_000).nullable(),
    constructionCostCents: cents.nullable(),
    startDate: isoDate,
    targetEndDate: isoDate,
};

const pct2 = z.number().int().min(0).max(10_000);

/** A consultant's fee on a project (also added on New project, Blake 2026-11-04). */
export const consultantRowSchema = z.object({
  companyId: z.uuid({ error: "Pick a consultant" }),
  contactId: z.uuid().nullable(),
  discipline: z.string().trim().min(1, { error: "Pick a discipline" }).max(40, { error: PROJECT_MESSAGES.long }),
  feeCents: cents,
  markupBp: pct2,
  billedThrough: z.boolean(),
});

export const createProjectSchema = z
  .object({
    ...projectFields,
    totalFeeCents: cents,
    totalBudgetHours: quarterHours,
    phases: z.array(phaseRowSchema).max(50),
    /** Consultant fees, separate from the architectural fee. */
    consultants: z.array(consultantRowSchema).max(30).default([]),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (v.startDate && v.targetEndDate && v.targetEndDate < v.startDate)
      issue("targetEndDate", PROJECT_MESSAGES.dates);
    const problem = phaseProblem(v);
    if (problem) issue("phases", problem);
    const codes = v.phases.map((p) => p.code.trim().toLowerCase());
    if (new Set(codes).size !== codes.length) issue("phases", PROJECT_MESSAGES.codeUsed);
  });
export type CreateProjectInput = z.input<typeof createProjectSchema>;

/** Edit project (project-detail): the same fields, any status including Closed. */
export const updateProjectSchema = z
  .object({ ...projectFields, id: z.uuid(), status: z.enum(PROJECT_STATUSES) })
  .superRefine((v, ctx) => {
    if (v.startDate && v.targetEndDate && v.targetEndDate < v.startDate)
      ctx.addIssue({ code: "custom", path: ["targetEndDate"], message: PROJECT_MESSAGES.dates });
  });
export type UpdateProjectInput = z.input<typeof updateProjectSchema>;

export const DISCIPLINES = ["Civil", "Structural", "MEP", "Landscape"];
export const PROJECT_ROLES = ["Principal", "PM", "PA", "Designer", "Interior designer"];


export const memberSchema = z.object({
  /** Set when editing an existing team row. */
  id: z.uuid().nullable(),
  projectId: z.uuid(),
  membershipId: z.uuid({ error: "Pick a person" }),
  projectRole: z.string().trim().min(1, { error: "Pick a role" }).max(40, { error: PROJECT_MESSAGES.long }),
  /** Owner/admin only; undefined = leave as is. */
  billRateOverrideCents: cents.nullable().optional(),
});

export const consultantSchema = consultantRowSchema.extend({
  id: z.uuid().nullable(),
  projectId: z.uuid(),
});

export const linkSchema = z.object({
  projectId: z.uuid(),
  companyId: z.uuid({ error: "Pick a company" }),
  contactId: z.uuid().nullable(),
  role: optText(60),
});

/**
 * What's wrong with the phases, if anything (server checks in the spec).
 * The page uses the same function to disable Create.
 */
export function phaseProblem(v: {
  totalFeeCents: number;
  totalBudgetHours: number;
  phases: readonly { feeType: FeeType; feeCents: number; budgetHours: number }[];
}): string | null {
  if (v.phases.length === 0) return PROJECT_MESSAGES.noPhases;
  const fees = v.phases.reduce((n, p) => n + p.feeCents, 0);
  if (fees !== v.totalFeeCents) return PROJECT_MESSAGES.feeSum(fees, v.totalFeeCents);
  // Compare in quarter hours so 0.1 + 0.2 style float noise can't matter.
  const units = v.phases.reduce((n, p) => n + Math.round(p.budgetHours * 4), 0);
  if (units !== Math.round(v.totalBudgetHours * 4))
    return PROJECT_MESSAGES.hoursSum(units / 4, v.totalBudgetHours);
  if (v.phases.some((p) => p.feeType === "hourly" && p.feeCents !== 0)) return PROJECT_MESSAGES.hourlyFee;
  if (v.phases.some((p) => p.feeType === "nte" && p.feeCents <= 0)) return PROJECT_MESSAGES.nteCap;
  return null;
}

export function fieldErrorsOf(issues: { path: PropertyKey[]; message: string }[]) {
  const out: Record<string, string> = {};
  for (const i of issues) out[String(i.path[0] ?? "form")] ??= i.message;
  return out;
}

/** "$1,234.56" / "1234.56" / "1,234" → cents. Null if it isn't money. */
export function parseMoney(raw: string): number | null {
  const v = raw.replace(/[$,\s]/g, "");
  if (v === "") return 0;
  if (!/^\d+(\.\d{0,2})?$/.test(v)) return null;
  const [d, c = ""] = v.split(".");
  return Number(d) * 100 + Number(c.padEnd(2, "0"));
}

/** Cents → "1234.56" for an input box ("" for 0 when blank is allowed). */
export function moneyInput(cents: number): string {
  const d = Math.floor(cents / 100);
  const c = cents % 100;
  return c === 0 ? d.toLocaleString("en-US") : `${d.toLocaleString("en-US")}.${String(c).padStart(2, "0")}`;
}
