import { z } from "zod";

// Settings → Time & approvals → "Timesheet phases & activities"
// (settings-rates-phases spec, section C and rule 11). Shared by the form
// and the server.

/** A chip. `id` is null until saved. */
export type ListItem = { id: string | null; name: string };

export type OverheadPhase = {
  id: string | null;
  name: string;
  activities: ListItem[];
  /** Hours logged to this phase (asked about before removing it). */
  loggedHours: number;
};

export type TimeListsForm = {
  projectActivities: ListItem[];
  overheadPhases: OverheadPhase[];
  leaveTypes: ListItem[];
};

export const LIST_NAME_MAX = 60;

export const TIME_LIST_MESSAGES = {
  duplicate: "Already in the list",
  empty: "Names can't be blank",
  tooLong: `Names can be up to ${LIST_NAME_MAX} characters`,
  phaseName: "Enter a name for this overhead phase",
  phaseTaken: "Another overhead phase has this name",
  projectEmpty: "Add at least one project activity.",
  leaveEmpty: "Add at least one leave type.",
  summary: "Fix the highlighted items, then save.",
  keepProject: "Keep at least one project activity.",
  keepLeave: "Keep at least one leave type.",
  keepPhaseActivity:
    "Each overhead phase needs at least one activity. Add another first, or remove the phase.",
} as const;

export function emptyPhaseMessage(phase: string) {
  return `Add at least one activity to ${phase}, or remove it.`;
}

export function removePhaseWarning(hours: number, name: string) {
  return `${hours} h are logged to ${name}. They stay in reports, but no one can pick ${name} on new timesheets.`;
}

const same = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Check a name typed into an add control (rule 11). Returns the trimmed name
 * to add, null to do nothing (empty), or an error message.
 */
export function checkNewName(
  list: readonly { name: string }[],
  raw: string,
): { ok: true; name: string } | { ok: false; error: string } | null {
  const name = raw.trim();
  if (!name) return null;
  if (name.length > LIST_NAME_MAX)
    return { ok: false, error: TIME_LIST_MESSAGES.tooLong };
  if (list.some((x) => same(x.name, name)))
    return { ok: false, error: TIME_LIST_MESSAGES.duplicate };
  return { ok: true, name };
}

const itemSchema = z.object({
  id: z.uuid().nullable(),
  name: z.string().max(500),
});
export const timeListsSchema = z.object({
  projectActivities: z.array(itemSchema).max(200),
  overheadPhases: z
    .array(
      z.object({
        id: z.uuid().nullable(),
        name: z.string().max(500),
        activities: z.array(itemSchema).max(200),
        loggedHours: z.number().optional().default(0),
      }),
    )
    .max(50),
  leaveTypes: z.array(itemSchema).max(50),
});

/** Error keys: "projectActivities", "leaveTypes", "overheadPhases.2", "overheadPhases.2.name". */
export type TimeListErrors = Record<string, string>;

function listErrors(items: readonly ListItem[]): string | null {
  for (let i = 0; i < items.length; i++) {
    const n = items[i].name.trim();
    if (!n) return TIME_LIST_MESSAGES.empty;
    if (n.length > LIST_NAME_MAX) return TIME_LIST_MESSAGES.tooLong;
    if (items.slice(0, i).some((x) => same(x.name, n)))
      return TIME_LIST_MESSAGES.duplicate;
  }
  return null;
}

/** Everything Save checks (rule 11). */
export function validateTimeLists(form: TimeListsForm): TimeListErrors {
  const errors: TimeListErrors = {};
  const pa = listErrors(form.projectActivities);
  if (pa) errors.projectActivities = pa;
  else if (form.projectActivities.length === 0)
    errors.projectActivities = TIME_LIST_MESSAGES.projectEmpty;

  const lt = listErrors(form.leaveTypes);
  if (lt) errors.leaveTypes = lt;
  else if (form.leaveTypes.length === 0)
    errors.leaveTypes = TIME_LIST_MESSAGES.leaveEmpty;

  form.overheadPhases.forEach((p, i) => {
    const name = p.name.trim();
    if (!name) errors[`overheadPhases.${i}.name`] = TIME_LIST_MESSAGES.phaseName;
    else if (name.length > LIST_NAME_MAX)
      errors[`overheadPhases.${i}.name`] = TIME_LIST_MESSAGES.tooLong;
    else if (form.overheadPhases.slice(0, i).some((x) => same(x.name, name)))
      errors[`overheadPhases.${i}.name`] = TIME_LIST_MESSAGES.phaseTaken;

    const acts = listErrors(p.activities);
    if (acts) errors[`overheadPhases.${i}`] = acts;
    else if (p.activities.length === 0)
      errors[`overheadPhases.${i}`] = emptyPhaseMessage(name || "this phase");
  });
  return errors;
}
