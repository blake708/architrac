import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { activityLog, memberships, reviewSteps, users } from "@/db/schema";
import { type TenantDb, withFirm } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import {
  ROUTE_EDIT_MESSAGES,
  type ReviewRouteView,
  reviewRouteSchema,
  routeProblem,
  routeWords,
} from "@/lib/settings/review-route";
import { loadRoute } from "@/server/time/review";
import { type ActionResult, SAVE_FAILED_MESSAGE, type SettingsActor, forbidden } from "./common";
import { STALE_MESSAGE } from "./phases";

// Settings → Time & approvals → "Approval route" (decision #23). Owner/admin
// only, saves straight away. Each save archives the old steps and writes the
// new list, so the history of routes is kept. Sheets already in review keep
// their own copy (timesheet_review_steps).

export async function loadReviewRoute(db: TenantDb): Promise<ReviewRouteView> {
  const route = await loadRoute(db);
  const people = await db
    .select({ membershipId: memberships.id, firstName: users.firstName, lastName: users.lastName })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.active, true), isNull(memberships.archivedAt)))
    .orderBy(asc(users.firstName), asc(users.lastName));
  return {
    steps: route.map((s) => ({ kind: s.kind, membershipId: s.membershipId })),
    people: people.map((p) => ({ membershipId: p.membershipId, name: `${p.firstName} ${p.lastName}`.trim() })),
  };
}

class RouteError extends Error {}

export async function saveReviewRouteCore(
  actor: SettingsActor,
  raw: unknown,
): Promise<ActionResult<never, { route: ReviewRouteView }>> {
  if (!can(actor.member, "settings.edit")) return forbidden;
  const parsed = reviewRouteSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? STALE_MESSAGE };
  const steps = parsed.data.steps;
  const problem = routeProblem(steps);
  if (problem) return { ok: false, error: problem };

  try {
    const route = await withFirm(actor.firmId, async (db) => {
      const before = await loadReviewRoute(db);
      const named = steps.flatMap((s) => (s.membershipId ? [s.membershipId] : []));
      if (named.length) {
        const found = await db
          .select({ id: memberships.id })
          .from(memberships)
          .where(and(inArray(memberships.id, named), eq(memberships.active, true), isNull(memberships.archivedAt)));
        if (found.length !== new Set(named).size) throw new RouteError(ROUTE_EDIT_MESSAGES.badPerson);
      }
      const same =
        before.steps.length === steps.length &&
        before.steps.every((s, i) => s.kind === steps[i].kind && s.membershipId === steps[i].membershipId);
      if (same) return before;

      const now = new Date();
      await db
        .update(reviewSteps)
        .set({ archivedAt: now, updatedAt: now })
        .where(and(eq(reviewSteps.firmId, actor.firmId), isNull(reviewSteps.archivedAt)));
      await db.insert(reviewSteps).values(
        steps.map((s, i) => ({ firmId: actor.firmId, sortOrder: i, kind: s.kind, membershipId: s.membershipId })),
      );
      const names = new Map(before.people.map((p) => [p.membershipId, p.name]));
      const nameOf = (id: string) => names.get(id) ?? "Someone";
      await db.insert(activityLog).values({
        firmId: actor.firmId,
        actorUserId: actor.userId,
        entityType: "firm_settings",
        entityId: actor.firmId,
        action: "updated",
        changes: { review_route: { before: routeWords(before.steps, nameOf), after: routeWords(steps, nameOf) } },
      });
      return loadReviewRoute(db);
    });
    return { ok: true, data: { route } };
  } catch (err) {
    if (err instanceof RouteError) return { ok: false, error: err.message };
    console.error("saveReviewRoute failed", err);
    return { ok: false, error: SAVE_FAILED_MESSAGE };
  }
}
