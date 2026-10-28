import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { activityLog, invitations, memberships, users } from "@/db/schema";
import { type TenantDb, withFirm } from "@/db/tenant";
import { APP_ROLES, type AppRole, can } from "@/lib/auth/permissions";
import {
  ONLY_OWNER_MESSAGE,
  assignableRoles,
  canManageRole,
  clerkRoleFor,
  memberChangeBlocked,
  needsOwnerMessage,
  removesLastOwner,
  roleChangeBlocked,
} from "@/lib/auth/user-management";
import type { SettingsClerk } from "@/server/auth/clerk";
import {
  type ActionResult,
  type SettingsActor,
  clerkErrorMessage,
  forbidden,
  isClerkNotFound,
  isUniqueViolation,
} from "./common";

// Settings → Users & access (settings-firm spec, Layout §5, Actions, rules 6–8).

// ---------- Reading ----------

export type MemberRow = {
  kind: "member";
  membershipId: string;
  firstName: string;
  lastName: string;
  email: string;
  initials: string;
  avatarUrl: string | null;
  clerkUserId: string;
  title: string | null;
  appRole: AppRole;
  active: boolean;
};

export type InvitationRow = {
  kind: "invitation";
  invitationId: string;
  email: string;
  title: string | null;
  appRole: AppRole;
  status: "pending" | "expired";
  invitedAt: Date;
};

/**
 * Members (active and off, by last name), then open invitations (newest
 * first). Runs inside withFirm, so it only ever sees one firm's rows.
 */
export async function listPeople(
  db: TenantDb,
  firmId: string,
): Promise<{ members: MemberRow[]; invitations: InvitationRow[] }> {
  const memberRows = await db
    .select({
      membershipId: memberships.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      initials: users.initials,
      avatarUrl: users.avatarUrl,
      clerkUserId: users.clerkUserId,
      title: memberships.title,
      appRole: memberships.appRole,
      active: memberships.active,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.firmId, firmId),
        sql`${memberships.archivedAt} is null`,
      ),
    )
    .orderBy(asc(users.lastName), asc(users.firstName));

  const inviteRows = await db
    .select({
      invitationId: invitations.id,
      email: invitations.email,
      title: invitations.title,
      appRole: invitations.appRole,
      status: invitations.status,
      invitedAt: invitations.invitedAt,
    })
    .from(invitations)
    .where(
      and(
        eq(invitations.firmId, firmId),
        inArray(invitations.status, ["pending", "expired"]),
      ),
    )
    .orderBy(desc(invitations.invitedAt));

  return {
    members: memberRows.map((m) => ({ kind: "member", ...m })),
    invitations: inviteRows.map((i) => ({
      kind: "invitation",
      ...i,
      status: i.status as "pending" | "expired",
    })),
  };
}

/** Seats: active members of the firm (plan card). */
export async function countSeats(db: TenantDb, firmId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(and(eq(memberships.firmId, firmId), eq(memberships.active, true)));
  return row.n;
}

// ---------- Invite ----------

const inviteSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: "Enter an email address" })),
  appRole: z.enum(APP_ROLES, { error: "Pick a role" }),
  title: z
    .string()
    .trim()
    .max(80, { error: "Title must be 80 characters or fewer" })
    .transform((v) => (v === "" ? null : v))
    .optional()
    .default(""),
});
export type InviteField = "email" | "appRole" | "title";

export const ALREADY_INVITED_MESSAGE = "Already invited — use Resend";
export const alreadyMemberMessage = (email: string) =>
  `${email} is already a member`;

export type InviteResult = ActionResult<InviteField, { email: string }>;

/**
 * Invite someone: save a pending invitation, then ask Clerk to email them.
 * If Clerk fails, the invitation is marked revoked and the error is shown.
 */
export async function inviteUserCore(
  actor: SettingsActor,
  raw: unknown,
  clerk: Pick<SettingsClerk, "createInvitation">,
): Promise<InviteResult> {
  if (!can(actor.member, "users.manage")) return forbidden;

  const parsed = inviteSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<InviteField, string>> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[issue.path[0] as InviteField] ??= issue.message;
    }
    return { ok: false, fieldErrors };
  }
  const { email, appRole, title } = parsed.data;
  if (!assignableRoles(actor.member).includes(appRole)) {
    return { ok: false, error: ONLY_OWNER_MESSAGE };
  }

  // 1. Check and save the invitation.
  let invitationId: string;
  try {
    const saved = await withFirm(actor.firmId, async (db) => {
      const [member] = await db
        .select({ id: memberships.id })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(
          and(
            eq(memberships.firmId, actor.firmId),
            eq(memberships.active, true),
            eq(users.email, email),
          ),
        );
      if (member) return { error: alreadyMemberMessage(email) };

      const [pending] = await db
        .select({ id: invitations.id })
        .from(invitations)
        .where(
          and(
            eq(invitations.firmId, actor.firmId),
            eq(invitations.email, email),
            eq(invitations.status, "pending"),
          ),
        );
      if (pending) return { error: ALREADY_INVITED_MESSAGE };

      const [row] = await db
        .insert(invitations)
        .values({
          firmId: actor.firmId,
          email,
          appRole,
          title,
          status: "pending",
          invitedBy: actor.userId,
        })
        .returning({ id: invitations.id });
      await db.insert(activityLog).values({
        firmId: actor.firmId,
        actorUserId: actor.userId,
        entityType: "invitation",
        entityId: row.id,
        action: "created",
        changes: {
          email: { before: null, after: email },
          app_role: { before: null, after: appRole },
          title: { before: null, after: title },
        },
      });
      return { id: row.id };
    });
    if ("error" in saved) {
      return { ok: false, fieldErrors: { email: saved.error } };
    }
    invitationId = saved.id;
  } catch (err) {
    // Two invites for the same email at once: the unique index stops one.
    if (isUniqueViolation(err)) {
      return { ok: false, fieldErrors: { email: ALREADY_INVITED_MESSAGE } };
    }
    console.error("inviteUser failed", err);
    return { ok: false, error: "Couldn't send the invite. Try again." };
  }

  // 2. Clerk sends the email.
  try {
    const clerkInvitationId = await clerk.createInvitation({
      clerkOrgId: actor.clerkOrgId,
      email,
      role: clerkRoleFor(appRole),
      inviterClerkUserId: actor.clerkUserId,
    });
    await withFirm(actor.firmId, (db) =>
      db
        .update(invitations)
        .set({ clerkInvitationId })
        .where(eq(invitations.id, invitationId)),
    );
  } catch (err) {
    console.error("inviteUser: Clerk invitation failed", err);
    await withFirm(actor.firmId, (db) =>
      db
        .update(invitations)
        .set({ status: "revoked" })
        .where(eq(invitations.id, invitationId)),
    );
    return {
      ok: false,
      error: `Couldn't send the invite: ${clerkErrorMessage(err)}`,
    };
  }

  return { ok: true, data: { email } };
}

// ---------- Resend / revoke ----------

const idSchema = z.uuid();

async function loadInvitation(actor: SettingsActor, raw: unknown) {
  const id = idSchema.safeParse(raw);
  if (!id.success) return null;
  return withFirm(actor.firmId, async (db) => {
    const [row] = await db
      .select()
      .from(invitations)
      .where(
        and(eq(invitations.firmId, actor.firmId), eq(invitations.id, id.data)),
      );
    return row ?? null;
  });
}

export type InvitationActionResult = ActionResult<never, { email: string }>;

/** Revoke the old Clerk invitation, send a new one, and reset invited_at. */
export async function resendInviteCore(
  actor: SettingsActor,
  rawId: unknown,
  clerk: Pick<SettingsClerk, "createInvitation" | "revokeInvitation">,
  now: Date = new Date(),
): Promise<InvitationActionResult> {
  if (!can(actor.member, "users.manage")) return forbidden;
  const inv = await loadInvitation(actor, rawId);
  if (!inv || (inv.status !== "pending" && inv.status !== "expired")) {
    return { ok: false, error: "This invitation can't be resent." };
  }
  if (!canManageRole(actor.member, inv.appRole)) {
    return { ok: false, error: ONLY_OWNER_MESSAGE };
  }

  try {
    if (inv.clerkInvitationId && inv.status === "pending") {
      await clerk
        .revokeInvitation({
          clerkOrgId: actor.clerkOrgId,
          invitationId: inv.clerkInvitationId,
          requestingClerkUserId: actor.clerkUserId,
        })
        .catch((err: unknown) => {
          if (!isClerkNotFound(err)) throw err;
        });
    }
    const clerkInvitationId = await clerk.createInvitation({
      clerkOrgId: actor.clerkOrgId,
      email: inv.email,
      role: clerkRoleFor(inv.appRole),
      inviterClerkUserId: actor.clerkUserId,
    });
    await withFirm(actor.firmId, async (db) => {
      await db
        .update(invitations)
        .set({ clerkInvitationId, invitedAt: now, status: "pending" })
        .where(eq(invitations.id, inv.id));
      await db.insert(activityLog).values({
        firmId: actor.firmId,
        actorUserId: actor.userId,
        entityType: "invitation",
        entityId: inv.id,
        action: "updated",
        changes: {
          invited_at: { before: inv.invitedAt, after: now },
          status: { before: inv.status, after: "pending" },
        },
      });
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, error: ALREADY_INVITED_MESSAGE };
    }
    console.error("resendInvite failed", err);
    return {
      ok: false,
      error: `Couldn't resend the invite: ${clerkErrorMessage(err)}`,
    };
  }
  return { ok: true, data: { email: inv.email } };
}

/** Cancel a pending invitation in Clerk and here. */
export async function revokeInviteCore(
  actor: SettingsActor,
  rawId: unknown,
  clerk: Pick<SettingsClerk, "revokeInvitation">,
): Promise<InvitationActionResult> {
  if (!can(actor.member, "users.manage")) return forbidden;
  const inv = await loadInvitation(actor, rawId);
  if (!inv || (inv.status !== "pending" && inv.status !== "expired")) {
    return { ok: false, error: "This invitation is no longer open." };
  }
  if (!canManageRole(actor.member, inv.appRole)) {
    return { ok: false, error: ONLY_OWNER_MESSAGE };
  }

  try {
    if (inv.clerkInvitationId && inv.status === "pending") {
      await clerk
        .revokeInvitation({
          clerkOrgId: actor.clerkOrgId,
          invitationId: inv.clerkInvitationId,
          requestingClerkUserId: actor.clerkUserId,
        })
        .catch((err: unknown) => {
          if (!isClerkNotFound(err)) throw err;
        });
    }
    await withFirm(actor.firmId, async (db) => {
      await db
        .update(invitations)
        .set({ status: "revoked" })
        .where(eq(invitations.id, inv.id));
      await db.insert(activityLog).values({
        firmId: actor.firmId,
        actorUserId: actor.userId,
        entityType: "invitation",
        entityId: inv.id,
        action: "status_changed",
        changes: { status: { before: inv.status, after: "revoked" } },
      });
    });
  } catch (err) {
    console.error("revokeInvite failed", err);
    return {
      ok: false,
      error: `Couldn't revoke the invite: ${clerkErrorMessage(err)}`,
    };
  }
  return { ok: true, data: { email: inv.email } };
}

// ---------- Change role / deactivate ----------

/** Load a membership (with the person's Clerk id) and lock it for the change. */
async function lockMember(db: TenantDb, firmId: string, membershipId: string) {
  const [row] = await db
    .select({
      id: memberships.id,
      appRole: memberships.appRole,
      active: memberships.active,
      clerkUserId: users.clerkUserId,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.firmId, firmId), eq(memberships.id, membershipId)))
    .for("update", { of: memberships });
  return row ?? null;
}

/** Active owners, locked so two owners can't remove each other at once. */
async function lockActiveOwnerCount(db: TenantDb, firmId: string) {
  const rows = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.firmId, firmId),
        eq(memberships.appRole, "owner"),
        eq(memberships.active, true),
      ),
    )
    .for("update");
  return rows.length;
}

/** Thrown inside a transaction to stop it with a message for the person. */
class Refused extends Error {}

const changeRoleSchema = z.object({
  membershipId: z.uuid(),
  appRole: z.enum(APP_ROLES),
});

export type MemberActionResult = ActionResult<never, { name: string }>;

/** Change someone's role here and in Clerk (rule 7; app-shell rule 8). */
export async function changeRoleCore(
  actor: SettingsActor,
  raw: unknown,
  clerk: Pick<SettingsClerk, "setMemberRole">,
): Promise<MemberActionResult> {
  if (!can(actor.member, "users.manage")) return forbidden;
  const parsed = changeRoleSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Pick a role." };
  const { membershipId, appRole } = parsed.data;

  try {
    const name = await withFirm(actor.firmId, async (db) => {
      const them = await lockMember(db, actor.firmId, membershipId);
      if (!them) throw new Refused("That person isn't in this firm.");
      const blocked = roleChangeBlocked(
        actor.member,
        { membershipId: them.id, appRole: them.appRole },
        appRole,
      );
      if (blocked) throw new Refused(blocked);
      const name = `${them.firstName} ${them.lastName}`.trim();
      if (them.appRole === appRole) return name;

      const owners = await lockActiveOwnerCount(db, actor.firmId);
      if (removesLastOwner(them, owners, { role: appRole })) {
        throw new Refused(needsOwnerMessage(actor.firmName));
      }

      await db
        .update(memberships)
        .set({ appRole })
        .where(eq(memberships.id, them.id));
      await db.insert(activityLog).values({
        firmId: actor.firmId,
        actorUserId: actor.userId,
        entityType: "membership",
        entityId: them.id,
        action: "status_changed",
        changes: { app_role: { before: them.appRole, after: appRole } },
      });
      // Off members have no Clerk membership to update.
      if (them.active && clerkRoleFor(them.appRole) !== clerkRoleFor(appRole)) {
        await clerk.setMemberRole({
          clerkOrgId: actor.clerkOrgId,
          clerkUserId: them.clerkUserId,
          role: clerkRoleFor(appRole),
        });
      }
      return name;
    });
    return { ok: true, data: { name } };
  } catch (err) {
    if (err instanceof Refused) return { ok: false, error: err.message };
    console.error("changeRole failed", err);
    return {
      ok: false,
      error: `Couldn't change the role: ${clerkErrorMessage(err)}`,
    };
  }
}

/**
 * Turn off someone's access: membership off here, removed from the Clerk org.
 * Their time and history stay (nothing is deleted).
 */
export async function deactivateMemberCore(
  actor: SettingsActor,
  rawId: unknown,
  clerk: Pick<SettingsClerk, "removeMember">,
): Promise<MemberActionResult> {
  if (!can(actor.member, "users.manage")) return forbidden;
  const id = idSchema.safeParse(rawId);
  if (!id.success) return { ok: false, error: "That person isn't in this firm." };

  try {
    const name = await withFirm(actor.firmId, async (db) => {
      const them = await lockMember(db, actor.firmId, id.data);
      if (!them) throw new Refused("That person isn't in this firm.");
      const blocked = memberChangeBlocked(actor.member, {
        membershipId: them.id,
        appRole: them.appRole,
      });
      if (blocked) throw new Refused(blocked);
      const name = `${them.firstName} ${them.lastName}`.trim();
      if (!them.active) return name;

      const owners = await lockActiveOwnerCount(db, actor.firmId);
      if (removesLastOwner(them, owners, { deactivate: true })) {
        throw new Refused(needsOwnerMessage(actor.firmName));
      }

      await db
        .update(memberships)
        .set({ active: false })
        .where(eq(memberships.id, them.id));
      await db.insert(activityLog).values({
        firmId: actor.firmId,
        actorUserId: actor.userId,
        entityType: "membership",
        entityId: them.id,
        action: "status_changed",
        changes: { active: { before: true, after: false } },
      });
      await clerk
        .removeMember({
          clerkOrgId: actor.clerkOrgId,
          clerkUserId: them.clerkUserId,
        })
        .catch((err: unknown) => {
          if (!isClerkNotFound(err)) throw err;
        });
      return name;
    });
    return { ok: true, data: { name } };
  } catch (err) {
    if (err instanceof Refused) return { ok: false, error: err.message };
    console.error("deactivateMember failed", err);
    return {
      ok: false,
      error: `Couldn't turn off access: ${clerkErrorMessage(err)}`,
    };
  }
}
