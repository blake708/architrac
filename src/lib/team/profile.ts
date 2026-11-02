import { z } from "zod";
import { APP_ROLES } from "@/lib/auth/permissions";

// Team → Invite person and Edit profile (team spec, Actions). Shared by the
// dialogs (live errors) and the server (final check).

export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const EMPLOYMENT_LABELS: Record<EmploymentType, string> = {
  full_time: "Full time",
  part_time: "Part time",
  contract: "Contract",
};

export const TEAM_MESSAGES = {
  firstName: "Enter a first name",
  lastName: "Enter a last name",
  hours: "Enter hours from 0 to 80 in quarter hours",
  target: "Enter a whole percent from 0 to 100",
  phone: "Enter a 10-digit phone number",
  long: "Too long",
  role: "Pick a role from the list",
  team: "Pick a team from the list",
  alreadyMember: "Already on the team",
  forbidden: "Only owners and admins can change the team.",
  teamName: "Enter a team name",
  teamNameTaken: "Another team has this name",
  leaderTaken: (name: string, team: string) => `${name} already leads ${team}.`,
  moveLeader: (team: string) => `Assign a new leader to ${team} first.`,
  archiveHasPeople: (n: number) =>
    `Move its ${n} ${n === 1 ? "person" : "people"} first.`,
} as const;

const hours = z
  .number({ error: TEAM_MESSAGES.hours })
  .min(0, { error: TEAM_MESSAGES.hours })
  .max(80, { error: TEAM_MESSAGES.hours })
  .refine((h) => Number.isInteger(h * 4), { error: TEAM_MESSAGES.hours });
const target = z
  .number({ error: TEAM_MESSAGES.target })
  .int({ error: TEAM_MESSAGES.target })
  .min(0, { error: TEAM_MESSAGES.target })
  .max(100, { error: TEAM_MESSAGES.target });
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: TEAM_MESSAGES.long })
    .transform((v) => (v === "" ? null : v));

/** Fields both dialogs share. Percent in the form, basis points in the database. */
export const profileFields = {
  title: optionalText(80),
  firmRoleId: z.uuid({ error: TEAM_MESSAGES.role }).nullable(),
  teamId: z.uuid({ error: TEAM_MESSAGES.team }).nullable(),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  weeklyCapacityHours: hours,
  targetUtilizationPct: target,
};

export const teamInviteSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: "Enter an email address" })),
  firstName: z.string().trim().min(1, { error: TEAM_MESSAGES.firstName }).max(60),
  lastName: z.string().trim().min(1, { error: TEAM_MESSAGES.lastName }).max(60),
  appRole: z.enum(APP_ROLES, { error: "Pick an access level" }),
  ...profileFields,
});
export type TeamInviteInput = z.input<typeof teamInviteSchema>;

export const editProfileSchema = z.object({
  membershipId: z.uuid(),
  ...profileFields,
  phone: z.string().trim(),
  licenseNote: optionalText(120),
  startDate: z.iso.date().nullable(),
  isPrincipal: z.boolean(),
});
export type EditProfileInput = z.input<typeof editProfileSchema>;

export const teamSchema = z.object({
  id: z.uuid().nullable(),
  name: z
    .string()
    .trim()
    .min(1, { error: TEAM_MESSAGES.teamName })
    .max(60, { error: TEAM_MESSAGES.long }),
  leaderMembershipId: z.uuid().nullable(),
});
export type TeamInput = z.input<typeof teamSchema>;

/** Zod issues → { field: first message }. */
export function fieldErrorsOf(issues: { path: PropertyKey[]; message: string }[]) {
  const out: Record<string, string> = {};
  for (const i of issues) out[String(i.path[0] ?? "form")] ??= i.message;
  return out;
}
