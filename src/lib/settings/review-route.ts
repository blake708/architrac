import { z } from "zod";
import { REVIEW_STEP_KINDS, ROUTE_MESSAGES, type ReviewStepKind } from "@/lib/calc/review-route";

// Settings → Time & approvals → "Approval route" (timesheet-approval spec,
// decision #23). The page sends the whole route on every change.

export type RouteStepInput = { kind: ReviewStepKind; membershipId: string | null };

export type ReviewRouteView = {
  steps: RouteStepInput[];
  /** Active people who can be a named step, sorted by name. */
  people: { membershipId: string; name: string }[];
};

export const ROUTE_EDIT_MESSAGES = {
  needsStep: ROUTE_MESSAGES.needsStep,
  duplicateKind: "Each kind of step can be on the route once.",
  duplicatePerson: "That person is already on the route.",
  pickPerson: "Pick a person for this step.",
  badPerson: "That person isn't an active member of the firm.",
  tooMany: "A route can have at most 10 steps.",
} as const;

export const reviewRouteSchema = z.object({
  steps: z
    .array(z.object({ kind: z.enum(REVIEW_STEP_KINDS), membershipId: z.uuid().nullable() }))
    .max(10, ROUTE_EDIT_MESSAGES.tooMany),
});

/** The first problem with a route, or null if it can be saved. */
export function routeProblem(steps: readonly RouteStepInput[]): string | null {
  if (!steps.length) return ROUTE_EDIT_MESSAGES.needsStep;
  const kinds = new Set<string>();
  const people = new Set<string>();
  for (const s of steps) {
    if (s.kind === "person") {
      if (!s.membershipId) return ROUTE_EDIT_MESSAGES.pickPerson;
      if (people.has(s.membershipId)) return ROUTE_EDIT_MESSAGES.duplicatePerson;
      people.add(s.membershipId);
    } else {
      if (kinds.has(s.kind)) return ROUTE_EDIT_MESSAGES.duplicateKind;
      kinds.add(s.kind);
    }
  }
  return null;
}

/** Muted note under each step (Layout, "Approval route" card). */
export const STEP_NOTES: Record<ReviewStepKind, string> = {
  principal_in_charge: "Each project's Principal in Charge. When a timesheet has several projects, each of them approves.",
  team_leader: "The person's team leader, from the Team page.",
  any_principal: "Any one principal. Skipped if a principal already approved.",
  person: "Always this person.",
};

/** The route as words for the activity log: "Team leader → Principal in Charge". */
export function routeWords(steps: readonly RouteStepInput[], nameOf: (id: string) => string): string {
  return steps
    .map((s) =>
      s.kind === "principal_in_charge"
        ? "Principal in Charge"
        : s.kind === "team_leader"
          ? "Team leader"
          : s.kind === "any_principal"
            ? "Any principal"
            : nameOf(s.membershipId ?? ""),
    )
    .join(" → ");
}
