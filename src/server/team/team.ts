import { and, eq, isNull, ne, sql } from "drizzle-orm";
import {
  activityLog,
  firmRoles,
  memberships,
  teams,
  users,
} from "@/db/schema";
import { type TenantDb, withFirm } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import { formatPhone } from "@/lib/settings/firm-profile";
import {
  TEAM_MESSAGES,
  editProfileSchema,
  fieldErrorsOf,
  teamInviteSchema,
  teamSchema,
} from "@/lib/team/profile";
import type { SettingsClerk } from "@/server/auth/clerk";
import {
  type ActionResult,
  SAVE_FAILED_MESSAGE,
  type SettingsActor,
} from "@/server/settings/common";
import { type InviteResult, inviteUserCore } from "@/server/settings/people";

// Team page actions (team spec, Actions). Owners and admins only; access
// level changes, deactivate, resend and revoke reuse the Settings → Users &
// access code so the rules stay the same in both places.

export const teamForbidden = {
  ok: false,
  error: TEAM_MESSAGES.forbidden,
} as const;

class Refused extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

function log(
  db: TenantDb,
  actor: SettingsActor,
  entityType: string,
  entityId: string,
  action: string,
  changes: Record<string, unknown>,
) {
  return db.insert(activityLog).values({
    firmId: actor.firmId,
    actorUserId: actor.userId,
    entityType,
    entityId,
    action,
    changes,
  });
}

function refusedResult(err: unknown, what: string) {
  if (err instanceof Refused) {
    return err.field
      ? ({ ok: false, fieldErrors: { [err.field]: err.message } } as const)
      : ({ ok: false, error: err.message } as const);
  }
  console.error(`${what} failed`, err);
  return { ok: false, error: SAVE_FAILED_MESSAGE } as const;
}

// ---------- Invite person ----------

/** Invite with a full profile. "Already on the team" for current members. */
export async function teamInviteCore(
  actor: SettingsActor,
  raw: unknown,
  clerk: Pick<SettingsClerk, "createInvitation">,
): Promise<InviteResult> {
  if (!can(actor.member, "users.manage")) return teamForbidden;
  const parsed = teamInviteSchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, fieldErrors: fieldErrorsOf(parsed.error.issues) };
  // The shared invite takes a blank title as "" (it turns it into null).
  return inviteUserCore(actor, { ...parsed.data, title: parsed.data.title ?? "" }, clerk, {
    alreadyMember: () => TEAM_MESSAGES.alreadyMember,
  });
}

// ---------- Edit profile ----------

async function lockMembership(db: TenantDb, id: string) {
  const [row] = await db
    .select({
      m: memberships,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.id, id), isNull(memberships.archivedAt)))
    .for("update", { of: memberships });
  return row ?? null;
}

/** The team this person leads, if any. */
async function teamLedBy(db: TenantDb, membershipId: string) {
  const [row] = await db
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(
      and(eq(teams.leaderMembershipId, membershipId), isNull(teams.archivedAt)),
    );
  return row ?? null;
}

async function activeTeam(db: TenantDb, id: string) {
  const [row] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.id, id), isNull(teams.archivedAt)));
  return row ?? null;
}

export type ProfileResult = ActionResult<string, { name: string }>;

export async function editProfileCore(
  actor: SettingsActor,
  raw: unknown,
): Promise<ProfileResult> {
  if (!can(actor.member, "users.manage")) return teamForbidden;
  const parsed = editProfileSchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, fieldErrors: fieldErrorsOf(parsed.error.issues) };
  const input = parsed.data;
  const phone = input.phone === "" ? null : formatPhone(input.phone);
  if (input.phone !== "" && !phone)
    return { ok: false, fieldErrors: { phone: TEAM_MESSAGES.phone } };

  try {
    const name = await withFirm(actor.firmId, async (db) => {
      const row = await lockMembership(db, input.membershipId);
      if (!row) throw new Refused("That person isn't in this firm.");
      const before = row.m;
      const name = `${row.firstName} ${row.lastName}`.trim();

      if (input.firmRoleId && input.firmRoleId !== before.firmRoleId) {
        const [role] = await db
          .select({ id: firmRoles.id })
          .from(firmRoles)
          .where(
            and(eq(firmRoles.id, input.firmRoleId), isNull(firmRoles.archivedAt)),
          );
        if (!role) throw new Refused(TEAM_MESSAGES.role, "firmRoleId");
      }
      if (input.teamId !== before.teamId) {
        const led = await teamLedBy(db, before.id);
        if (led) throw new Refused(TEAM_MESSAGES.moveLeader(led.name), "teamId");
        if (input.teamId && !(await activeTeam(db, input.teamId)))
          throw new Refused(TEAM_MESSAGES.team, "teamId");
      }

      const after = {
        title: input.title,
        firmRoleId: input.firmRoleId,
        teamId: input.teamId,
        employmentType: input.employmentType,
        weeklyCapacityHours: input.weeklyCapacityHours.toFixed(2),
        targetUtilizationBp: input.targetUtilizationPct * 100,
        phone,
        licenseNote: input.licenseNote,
        startDate: input.startDate,
        isPrincipal: input.isPrincipal,
      };
      const changes: Record<string, { before: unknown; after: unknown }> = {};
      for (const [k, v] of Object.entries(after)) {
        const was = before[k as keyof typeof before];
        const same =
          k === "weeklyCapacityHours" ? Number(was) === Number(v) : was === v;
        if (!same) changes[k] = { before: was, after: v };
      }
      if (Object.keys(changes).length === 0) return name;

      await db
        .update(memberships)
        .set(after)
        .where(eq(memberships.id, before.id));
      await log(db, actor, "membership", before.id, "updated", changes);
      return name;
    });
    return { ok: true, data: { name } };
  } catch (err) {
    return refusedResult(err, "editProfile");
  }
}

// ---------- Move person (Teams tab) ----------

export type MoveResult = ActionResult<never, { message: string }>;

/**
 * Move someone to a team (or no team). Blocked if they lead their current
 * team (rule 11). With the two-step approval route, their next timesheet
 * goes to the new team's leader.
 */
export async function movePersonCore(
  actor: SettingsActor,
  raw: unknown,
): Promise<MoveResult> {
  if (!can(actor.member, "users.manage")) return teamForbidden;
  const input = raw as { membershipId?: unknown; teamId?: unknown };
  const parsed = editProfileSchema
    .pick({ membershipId: true, teamId: true })
    .safeParse({ membershipId: input?.membershipId, teamId: input?.teamId });
  if (!parsed.success) return { ok: false, error: TEAM_MESSAGES.team };
  const { membershipId, teamId } = parsed.data;

  try {
    const message = await withFirm(actor.firmId, async (db) => {
      const row = await lockMembership(db, membershipId);
      if (!row) throw new Refused("That person isn't in this firm.");
      const name = `${row.firstName} ${row.lastName}`.trim();
      if (row.m.teamId === teamId) return `${name} is already there.`;
      const led = await teamLedBy(db, row.m.id);
      if (led) throw new Refused(TEAM_MESSAGES.moveLeader(led.name));

      const team = teamId ? await activeTeam(db, teamId) : null;
      if (teamId && !team) throw new Refused(TEAM_MESSAGES.team);
      await db
        .update(memberships)
        .set({ teamId })
        .where(eq(memberships.id, row.m.id));
      await log(db, actor, "membership", row.m.id, "updated", {
        team_id: { before: row.m.teamId, after: teamId },
      });

      if (!team) return `${name} no longer has a team.`;
      const leader = team.leaderMembershipId
        ? await db
            .select({ first: users.firstName, last: users.lastName })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(eq(memberships.id, team.leaderMembershipId))
            .then((r) => r[0])
        : undefined;
      return leader
        ? `${name} moved to ${team.name}. Their next timesheet goes to ${`${leader.first} ${leader.last}`.trim()}.`
        : `${name} moved to ${team.name}.`;
    });
    return { ok: true, data: { message } };
  } catch (err) {
    return refusedResult(err, "movePerson");
  }
}

// ---------- New / edit / archive team ----------

export type TeamResult = ActionResult<string, { id: string }>;

/**
 * Create or edit a team. Names are unique (ignoring case). A leader can lead
 * only one team, and setting a leader puts them on this team.
 */
export async function saveTeamCore(
  actor: SettingsActor,
  raw: unknown,
): Promise<TeamResult> {
  if (!can(actor.member, "users.manage")) return teamForbidden;
  const parsed = teamSchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, fieldErrors: fieldErrorsOf(parsed.error.issues) };
  const input = parsed.data;

  try {
    const id = await withFirm(actor.firmId, async (db) => {
      const before = input.id ? await activeTeam(db, input.id) : null;
      if (input.id && !before) throw new Refused("That team no longer exists.");

      const [clash] = await db
        .select({ id: teams.id })
        .from(teams)
        .where(
          and(
            isNull(teams.archivedAt),
            sql`lower(${teams.name}) = lower(${input.name})`,
            input.id ? ne(teams.id, input.id) : undefined,
          ),
        );
      if (clash) throw new Refused(TEAM_MESSAGES.teamNameTaken, "name");

      if (input.leaderMembershipId) {
        const leader = await lockMembership(db, input.leaderMembershipId);
        if (!leader || !leader.m.active)
          throw new Refused("Pick an active person", "leaderMembershipId");
        const leaderName = `${leader.firstName} ${leader.lastName}`.trim();
        const led = await teamLedBy(db, leader.m.id);
        if (led && led.id !== input.id)
          throw new Refused(
            TEAM_MESSAGES.leaderTaken(leaderName, led.name),
            "leaderMembershipId",
          );
      }

      let teamId: string;
      if (before) {
        teamId = before.id;
        const changes: Record<string, unknown> = {};
        if (before.name !== input.name)
          changes.name = { before: before.name, after: input.name };
        if (before.leaderMembershipId !== input.leaderMembershipId)
          changes.leader_membership_id = {
            before: before.leaderMembershipId,
            after: input.leaderMembershipId,
          };
        if (Object.keys(changes).length > 0) {
          await db
            .update(teams)
            .set({ name: input.name, leaderMembershipId: input.leaderMembershipId })
            .where(eq(teams.id, teamId));
          await log(db, actor, "team", teamId, "updated", changes);
        }
      } else {
        const [{ max }] = await db
          .select({ max: sql<number>`coalesce(max(${teams.sortOrder}), 0)::int` })
          .from(teams);
        const [created] = await db
          .insert(teams)
          .values({
            firmId: actor.firmId,
            name: input.name,
            leaderMembershipId: input.leaderMembershipId,
            sortOrder: max + 1,
            createdBy: actor.userId,
          })
          .returning({ id: teams.id });
        teamId = created.id;
        await log(db, actor, "team", teamId, "created", {
          name: input.name,
          leader_membership_id: input.leaderMembershipId,
        });
      }

      // The leader belongs to the team they lead.
      if (input.leaderMembershipId) {
        const [m] = await db
          .select({ teamId: memberships.teamId })
          .from(memberships)
          .where(eq(memberships.id, input.leaderMembershipId));
        if (m.teamId !== teamId) {
          await db
            .update(memberships)
            .set({ teamId })
            .where(eq(memberships.id, input.leaderMembershipId));
          await log(db, actor, "membership", input.leaderMembershipId, "updated", {
            team_id: { before: m.teamId, after: teamId },
          });
        }
      }
      return teamId;
    });
    return { ok: true, data: { id } };
  } catch (err) {
    return refusedResult(err, "saveTeam");
  }
}

export async function archiveTeamCore(
  actor: SettingsActor,
  rawId: unknown,
): Promise<ActionResult<never, { name: string }>> {
  if (!can(actor.member, "users.manage")) return teamForbidden;
  const id = teamSchema.shape.id.safeParse(rawId);
  if (!id.success || !id.data) return { ok: false, error: "That team no longer exists." };

  try {
    const name = await withFirm(actor.firmId, async (db) => {
      const team = await activeTeam(db, id.data!);
      if (!team) throw new Refused("That team no longer exists.");
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(memberships)
        .where(and(eq(memberships.teamId, team.id), eq(memberships.active, true)));
      if (n > 0) throw new Refused(TEAM_MESSAGES.archiveHasPeople(n));
      await db
        .update(teams)
        .set({ archivedAt: new Date() })
        .where(eq(teams.id, team.id));
      await log(db, actor, "team", team.id, "archived", { name: team.name });
      return team.name;
    });
    return { ok: true, data: { name } };
  } catch (err) {
    return refusedResult(err, "archiveTeam");
  }
}
