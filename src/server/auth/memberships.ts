import { and, eq } from "drizzle-orm";
import { activityLog, memberships } from "@/db/schema";
import { withFirm } from "@/db/tenant";

export type Membership = typeof memberships.$inferSelect;

/**
 * Make sure this person has a membership in this firm. Safe to run any number
 * of times, including two at once (the database's unique rule on firm + user
 * decides the winner).
 *
 * - No row yet: create one as Staff. (Invitations, which carry the role
 *   someone was invited as, arrive in milestone 0.6.)
 * - Row exists: never change its role, so an owner is never downgraded.
 * - `reactivate: true` (Clerk says they were just added to the org): turn a
 *   deactivated membership back on. The sign-in check passes false, so being
 *   switched off in ArchiTrac sticks.
 */
export async function ensureMembership(
  firmId: string,
  userId: string,
  { reactivate }: { reactivate: boolean },
): Promise<Membership> {
  return withFirm(firmId, async (db) => {
    const [created] = await db
      .insert(memberships)
      .values({ firmId, userId, appRole: "staff" })
      .onConflictDoNothing({ target: [memberships.firmId, memberships.userId] })
      .returning();

    if (created) {
      await db.insert(activityLog).values({
        firmId,
        actorUserId: null,
        entityType: "membership",
        entityId: created.id,
        action: "created",
        changes: { app_role: { to: "staff" } },
      });
      return created;
    }

    const [existing] = await db
      .select()
      .from(memberships)
      .where(
        and(eq(memberships.firmId, firmId), eq(memberships.userId, userId)),
      );

    if (reactivate && !existing.active) {
      const [updated] = await db
        .update(memberships)
        .set({ active: true })
        .where(eq(memberships.id, existing.id))
        .returning();
      await db.insert(activityLog).values({
        firmId,
        actorUserId: null,
        entityType: "membership",
        entityId: existing.id,
        action: "status_changed",
        changes: { active: { from: false, to: true } },
      });
      return updated;
    }
    return existing;
  });
}

/** Turn a membership off (Clerk says they left the org). Safe to run twice. */
export async function deactivateMembership(
  firmId: string,
  userId: string,
): Promise<void> {
  await withFirm(firmId, async (db) => {
    const changed = await db
      .update(memberships)
      .set({ active: false })
      .where(
        and(
          eq(memberships.firmId, firmId),
          eq(memberships.userId, userId),
          eq(memberships.active, true),
        ),
      )
      .returning({ id: memberships.id });

    for (const { id } of changed) {
      await db.insert(activityLog).values({
        firmId,
        actorUserId: null,
        entityType: "membership",
        entityId: id,
        action: "status_changed",
        changes: { active: { from: true, to: false } },
      });
    }
  });
}
