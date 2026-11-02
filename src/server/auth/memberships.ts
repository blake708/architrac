import { and, eq } from "drizzle-orm";
import { activityLog, invitations, memberships, users } from "@/db/schema";
import { type TenantDb, withFirm } from "@/db/tenant";

export type Membership = typeof memberships.$inferSelect;

/** The open invitation for this person's email in this firm, locked. */
async function findPendingInvitation(
  db: TenantDb,
  firmId: string,
  userId: string,
) {
  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) return null;
  const [invite] = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.firmId, firmId),
        eq(invitations.email, user.email),
        eq(invitations.status, "pending"),
      ),
    )
    .for("update");
  return invite ?? null;
}

type Invitation = typeof invitations.$inferSelect;

/**
 * The membership fields an invitation sets (team spec, Invite person). Only
 * the ones the inviter filled in; the rest keep the column defaults.
 */
function profileFrom(invite: Invitation) {
  return {
    appRole: invite.appRole,
    title: invite.title,
    ...(invite.firmRoleId && { firmRoleId: invite.firmRoleId }),
    ...(invite.teamId && { teamId: invite.teamId }),
    ...(invite.employmentType && { employmentType: invite.employmentType }),
    ...(invite.weeklyCapacityHours && {
      weeklyCapacityHours: invite.weeklyCapacityHours,
    }),
    ...(invite.targetUtilizationBp !== null && {
      targetUtilizationBp: invite.targetUtilizationBp,
    }),
  };
}

async function acceptInvitation(
  db: TenantDb,
  firmId: string,
  invitationId: string,
  membershipId: string,
) {
  await db
    .update(invitations)
    .set({ status: "accepted", acceptedAt: new Date(), membershipId })
    .where(eq(invitations.id, invitationId));
  await db.insert(activityLog).values({
    firmId,
    actorUserId: null,
    entityType: "invitation",
    entityId: invitationId,
    action: "status_changed",
    changes: { status: { before: "pending", after: "accepted" } },
  });
}

/**
 * Make sure this person has a membership in this firm. Safe to run any number
 * of times, including two at once (the database's unique rule on firm + user
 * decides the winner).
 *
 * - A pending invitation for their email (settings-firm rule 8) supplies
 *   the role, title and Team profile (billing role, team, hours, target),
 *   and is marked accepted.
 * - No row yet: create one with the invited role, or Staff if not invited.
 * - Row exists: never change its role, so an owner is never downgraded —
 *   unless Clerk says they just joined (`reactivate: true`) through a pending
 *   invitation, which then sets them active with the invited role and title.
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
    const invite = await findPendingInvitation(db, firmId, userId);

    const [created] = await db
      .insert(memberships)
      .values({
        firmId,
        userId,
        appRole: "staff",
        title: null,
        ...(invite && profileFrom(invite)),
        createdBy: invite?.invitedBy ?? null,
      })
      .onConflictDoNothing({ target: [memberships.firmId, memberships.userId] })
      .returning();

    if (created) {
      await db.insert(activityLog).values({
        firmId,
        actorUserId: null,
        entityType: "membership",
        entityId: created.id,
        action: "created",
        changes: { app_role: { to: created.appRole } },
      });
      if (invite) await acceptInvitation(db, firmId, invite.id, created.id);
      return created;
    }

    const [existing] = await db
      .select()
      .from(memberships)
      .where(
        and(eq(memberships.firmId, firmId), eq(memberships.userId, userId)),
      );

    if (reactivate && invite) {
      const [updated] = await db
        .update(memberships)
        .set({ active: true, ...profileFrom(invite) })
        .where(eq(memberships.id, existing.id))
        .returning();
      await db.insert(activityLog).values({
        firmId,
        actorUserId: null,
        entityType: "membership",
        entityId: existing.id,
        action: "status_changed",
        changes: {
          active: { from: existing.active, to: true },
          app_role: { from: existing.appRole, to: invite.appRole },
          title: { from: existing.title, to: invite.title },
        },
      });
      await acceptInvitation(db, firmId, invite.id, existing.id);
      return updated;
    }

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
