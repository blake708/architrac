import type { Pool } from "@neondatabase/serverless";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb } from "@/db/client";
import { activityLog, invitations, memberships, teams } from "@/db/schema";
import { withFirm } from "@/db/tenant";
import {
  type TestFirm,
  type TestMember,
  addTestMember,
  asFirm,
  createOwnerPool,
  createTestFirm,
  removeTestFirm,
  removeTestUsers,
  requireDbEnv,
} from "@/db/test-helpers";
import type { AppRole } from "@/lib/auth/permissions";
import { ONLY_OWNER_MESSAGE } from "@/lib/auth/user-management";
import { TEAM_MESSAGES } from "@/lib/team/profile";
import { ensureMembership } from "@/server/auth/memberships";
import type { SettingsActor } from "@/server/settings/common";
import {
  archiveTeamCore,
  editProfileCore,
  movePersonCore,
  saveTeamCore,
  teamInviteCore,
} from "./team";
import { loadTeam } from "./view";

// Team page against the real database (team spec, acceptance tests that
// don't need timesheets; utilization hours arrive in 1.6).

let pool: Pool;
let F: TestFirm;
let jr: TestMember; // PM, leads Medical studio
let kl: TestMember; // staff designer on Medical studio
let ad: TestMember; // admin
let medicalId: string;
let commercialId: string;
let principalRoleId: string;
const users: string[] = [];

const TODAY = "2026-10-18";
const RUN = Date.now().toString(36);
const NEW_EMAIL = `new-${RUN}@firm.com`;

beforeAll(async () => {
  requireDbEnv();
  pool = createOwnerPool();
  F = await createTestFirm(pool, "Team");
  jr = await addTestMember(pool, F, { firstName: "Jamie", lastName: "Reyes", role: "project_manager", title: "Project manager" });
  kl = await addTestMember(pool, F, { firstName: "Kim", lastName: "Lee", role: "staff", title: "Designer" });
  ad = await addTestMember(pool, F, { firstName: "Ada", lastName: "Admin", role: "admin" });
  users.push(jr.userId, kl.userId, ad.userId);

  await asFirm(pool, F.firmId, async (c) => {
    const role = await c.query<{ id: string }>(
      "insert into firm_roles (firm_id, name, sort_order) values ($1, 'Principal', 0) returning id",
      [F.firmId],
    );
    principalRoleId = role.rows[0].id;
    await c.query(
      "insert into rates (firm_id, firm_role_id, bill_rate_cents, cost_rate_cents, effective_from) values ($1, $2, 18500, 9500, '2026-01-01')",
      [F.firmId, principalRoleId],
    );
    const med = await c.query<{ id: string }>(
      "insert into teams (firm_id, name, leader_membership_id, sort_order) values ($1, 'Medical studio', $2, 1) returning id",
      [F.firmId, jr.membershipId],
    );
    medicalId = med.rows[0].id;
    const com = await c.query<{ id: string }>(
      "insert into teams (firm_id, name, sort_order) values ($1, 'Commercial studio', 2) returning id",
      [F.firmId],
    );
    commercialId = com.rows[0].id;
    // KL and JR are designers / on Medical; KL targets 85%.
    await c.query(
      "update memberships set team_id = $1, firm_role_id = $2, target_utilization_bp = 8500 where id = any($3::uuid[])",
      [medicalId, F.firmRoleId, [kl.membershipId, jr.membershipId]],
    );
    await c.query(
      "update memberships set firm_role_id = $1, target_utilization_bp = 8000 where id = $2",
      [principalRoleId, F.membershipId],
    );
  });
});

afterAll(async () => {
  if (pool) {
    if (F) await removeTestFirm(pool, F);
    await removeTestUsers(pool, users);
    await pool.end();
  }
  await closeDb();
});

function actorFor(who: { userId: string; membershipId: string }, appRole: AppRole): SettingsActor {
  return {
    firmId: F.firmId,
    firmName: "Test Team firm",
    clerkOrgId: F.clerkOrgId,
    userId: who.userId,
    clerkUserId: `clerk_${who.userId}`,
    member: { membershipId: who.membershipId, appRole, active: true },
  };
}
const owner = () => actorFor(F, "owner");
const view = (who: { membershipId: string }, appRole: AppRole) =>
  withFirm(F.firmId, (db) =>
    loadTeam(db, { membershipId: who.membershipId, appRole, active: true }, {
      today: TODAY,
      weekStartsOn: 1,
    }),
  );
const fakeClerk = () => ({
  createInvitation: vi.fn(async () => `orginv_test_${Date.now()}_${Math.random()}`),
});

describe("what each role sees", () => {
  it("owner: rates, billable KPIs and everyone's utilization", async () => {
    const v = await view(F, "owner");
    const kim = v.people.find((p) => p.id === kl.membershipId)!;
    expect(kim.rate).toEqual({ billCents: 11500, costCents: 4400 });
    expect(kim.roleName).toBe("Designer");
    // No timesheets yet: 0% against an 85% target.
    expect(kim.utilization).toMatchObject({ kind: "shown", pct: 0, targetPct: 85 });
    // 4 members + the test firm's pending invite. Owner (Principal) + JR + KL
    // are billable; Ada has no role.
    expect(v.kpis).toMatchObject({ people: 5, invited: 1, teams: 3, billableStaff: 3 });
    expect(v.kpis.avgMultiplierHundredths).toBe(239); // (1.947 + 2.614 + 2.614) / 3 = 2.39
    expect(v.people.find((p) => p.id === ad.membershipId)!.rate).toBeNull();
    expect(v.canManage).toBe(true);
  });

  it("staff: no rate or cost anywhere, and only their own utilization", async () => {
    const v = await view(kl, "staff");
    const json = JSON.stringify(v);
    expect(json).not.toMatch(/"rate"|costCents|billCents|billableStaff|avgMultiplier/);
    expect(v.people.find((p) => p.id === kl.membershipId)!.utilization).toBeDefined();
    expect(v.people.find((p) => p.id === jr.membershipId)!.utilization).toBeUndefined();
    expect(v.canManage).toBe(false);
    expect(v.roles).toEqual([]);
  });

  it("PM: everyone's utilization, no rates", async () => {
    const v = await view(jr, "project_manager");
    expect(v.people.every((p) => p.utilization !== undefined)).toBe(true);
    expect(JSON.stringify(v)).not.toMatch(/costCents/);
  });

  it("sorts by team, leader first; team sub-lines and pills", async () => {
    const v = await view(F, "owner");
    const med = v.people.filter((p) => p.teamId === medicalId);
    expect(med.map((p) => p.firstName)).toEqual(["Jamie", "Kim"]);
    expect(med[0]).toMatchObject({ leadsTeam: true, access: "Team leader" });
    expect(med[1]).toMatchObject({ leaderInitials: "JR", access: "Member" });
    expect(v.people.find((p) => p.id === ad.membershipId)!.access).toBe("Admin");
  });
});

describe("invite person", () => {
  it("creates a pending invitation with the profile; the row shows Invited", async () => {
    const clerk = fakeClerk();
    const result = await teamInviteCore(owner(), {
      email: `New-${RUN}@Firm.com`,
      firstName: "Nia",
      lastName: "New",
      title: "Designer",
      appRole: "staff",
      firmRoleId: F.firmRoleId,
      teamId: commercialId,
      employmentType: "part_time",
      weeklyCapacityHours: 24,
      targetUtilizationPct: 75,
    }, clerk);
    expect(result).toEqual({ ok: true, data: { email: NEW_EMAIL } });
    expect(clerk.createInvitation).toHaveBeenCalledOnce();
    const [inv] = await withFirm(F.firmId, (db) =>
      db.select().from(invitations).where(eq(invitations.email, NEW_EMAIL)),
    );
    expect(inv).toMatchObject({
      status: "pending",
      firstName: "Nia",
      teamId: commercialId,
      employmentType: "part_time",
      weeklyCapacityHours: "24.00",
      targetUtilizationBp: 7500,
    });
    const v = await view(F, "owner");
    const row = v.people.find((p) => p.email === NEW_EMAIL)!;
    expect(row).toMatchObject({ kind: "invited", access: "Invited", teamName: "Commercial studio", firstName: "Nia" });
    expect(v.kpis).toMatchObject({ people: 6, invited: 2 });
  });

  it("accepting copies the profile onto the membership", async () => {
    const nia = await pool.query<{ id: string }>(
      "insert into users (clerk_user_id, email, first_name, last_name) values ($1, $2, 'Nia', 'New') returning id",
      [`user_test_nia_${RUN}`, NEW_EMAIL],
    );
    users.push(nia.rows[0].id);
    const m = await ensureMembership(F.firmId, nia.rows[0].id, { reactivate: true });
    expect(m).toMatchObject({
      appRole: "staff",
      title: "Designer",
      firmRoleId: F.firmRoleId,
      teamId: commercialId,
      employmentType: "part_time",
      weeklyCapacityHours: "24.00",
      targetUtilizationBp: 7500,
    });
  });

  it('an existing member says "Already on the team"', async () => {
    const [{ email }] = await pool.query<{ email: string }>(
      "select email from users where id = $1",
      [kl.userId],
    ).then((r) => r.rows);
    const result = await teamInviteCore(owner(), {
      email, firstName: "Kim", lastName: "Lee", appRole: "staff",
      title: "", firmRoleId: null, teamId: null, employmentType: "full_time",
      weeklyCapacityHours: 40, targetUtilizationPct: 80,
    }, fakeClerk());
    expect(result).toMatchObject({ ok: false, fieldErrors: { email: "Already on the team" } });
  });

  it("first and last name are required", async () => {
    const result = await teamInviteCore(owner(), {
      email: "x@firm.com", firstName: "", lastName: "", appRole: "staff",
      title: "", firmRoleId: null, teamId: null, employmentType: "full_time",
      weeklyCapacityHours: 40, targetUtilizationPct: 80,
    }, fakeClerk());
    expect(result).toMatchObject({ ok: false, fieldErrors: { firstName: TEAM_MESSAGES.firstName, lastName: TEAM_MESSAGES.lastName } });
  });

  it("an admin can't invite an owner; staff can't invite at all", async () => {
    const input = {
      email: "boss@firm.com", firstName: "B", lastName: "Oss", appRole: "owner",
      title: "", firmRoleId: null, teamId: null, employmentType: "full_time",
      weeklyCapacityHours: 40, targetUtilizationPct: 80,
    };
    expect(await teamInviteCore(actorFor(ad, "admin"), input, fakeClerk())).toEqual({ ok: false, error: ONLY_OWNER_MESSAGE });
    expect(await teamInviteCore(actorFor(kl, "staff"), { ...input, appRole: "staff" }, fakeClerk())).toEqual({ ok: false, error: TEAM_MESSAGES.forbidden });
  });
});

describe("edit profile", () => {
  const base = () => ({
    membershipId: kl.membershipId,
    title: "Senior designer",
    firmRoleId: F.firmRoleId,
    teamId: medicalId,
    employmentType: "full_time",
    weeklyCapacityHours: 37.5,
    targetUtilizationPct: 85,
    phone: "843.555.0199",
    licenseNote: "Licensed architect · SC",
    startDate: "2019-06-01",
    isPrincipal: false,
  });

  it("saves, formats the phone and logs the change", async () => {
    const result = await editProfileCore(owner(), base());
    expect(result).toEqual({ ok: true, data: { name: "Kim Lee" } });
    const [m] = await withFirm(F.firmId, (db) =>
      db.select().from(memberships).where(eq(memberships.id, kl.membershipId)),
    );
    expect(m).toMatchObject({
      title: "Senior designer",
      phone: "(843) 555-0199",
      weeklyCapacityHours: "37.50",
      startDate: "2019-06-01",
      licenseNote: "Licensed architect · SC",
    });
    const logs = await withFirm(F.firmId, (db) =>
      db.select().from(activityLog).where(and(eq(activityLog.entityId, kl.membershipId), eq(activityLog.action, "updated"))),
    );
    expect(logs.length).toBeGreaterThan(0);
  });

  it("rejects a bad phone and odd hours", async () => {
    expect(await editProfileCore(owner(), { ...base(), phone: "555" })).toMatchObject({ fieldErrors: { phone: TEAM_MESSAGES.phone } });
    expect(await editProfileCore(owner(), { ...base(), weeklyCapacityHours: 40.1 })).toMatchObject({ fieldErrors: { weeklyCapacityHours: TEAM_MESSAGES.hours } });
  });

  it("ticks Principal", async () => {
    await editProfileCore(owner(), { ...base(), membershipId: F.membershipId, teamId: F.teamId, isPrincipal: true, phone: "" });
    const v = await view(F, "owner");
    expect(v.people.find((p) => p.id === F.membershipId)!.isPrincipal).toBe(true);
  });

  it("staff can't edit", async () => {
    expect(await editProfileCore(actorFor(kl, "staff"), base())).toEqual({ ok: false, error: TEAM_MESSAGES.forbidden });
  });
});

describe("teams", () => {
  it("moving KL to Commercial studio updates the team, logs it and confirms", async () => {
    const result = await movePersonCore(owner(), { membershipId: kl.membershipId, teamId: commercialId });
    expect(result).toEqual({ ok: true, data: { message: "Kim Lee moved to Commercial studio." } });
    const v = await view(F, "owner");
    expect(v.teams.find((t) => t.id === medicalId)!.members).toEqual([jr.membershipId]);
  });

  it("names the next reviewer when the team has a leader", async () => {
    await saveTeamCore(owner(), { id: commercialId, name: "Commercial studio", leaderMembershipId: ad.membershipId });
    const result = await movePersonCore(owner(), { membershipId: kl.membershipId, teamId: medicalId });
    expect(result.ok).toBe(true);
    const back = await movePersonCore(owner(), { membershipId: kl.membershipId, teamId: commercialId });
    expect(back).toEqual({ ok: true, data: { message: "Kim Lee moved to Commercial studio. Their next timesheet goes to Ada Admin." } });
  });

  it("a team leader can't be moved", async () => {
    expect(await movePersonCore(owner(), { membershipId: jr.membershipId, teamId: commercialId })).toEqual({
      ok: false,
      error: "Assign a new leader to Medical studio first.",
    });
  });

  it("team names are unique; a leader leads one team; the leader joins it", async () => {
    expect(await saveTeamCore(owner(), { id: null, name: "medical STUDIO", leaderMembershipId: null })).toMatchObject({ fieldErrors: { name: TEAM_MESSAGES.teamNameTaken } });
    expect(await saveTeamCore(owner(), { id: null, name: "Interiors", leaderMembershipId: jr.membershipId })).toMatchObject({
      fieldErrors: { leaderMembershipId: "Jamie Reyes already leads Medical studio." },
    });
    const created = await saveTeamCore(owner(), { id: null, name: "Interiors", leaderMembershipId: kl.membershipId });
    expect(created.ok).toBe(true);
    const [m] = await withFirm(F.firmId, (db) => db.select().from(memberships).where(eq(memberships.id, kl.membershipId)));
    if (created.ok) expect(m.teamId).toBe(created.data.id);
  });

  it("a team with people can't be archived; an empty one can", async () => {
    expect(await archiveTeamCore(owner(), medicalId)).toEqual({ ok: false, error: "Move its 1 person first." });
    const empty = await saveTeamCore(owner(), { id: null, name: "Empty", leaderMembershipId: null });
    if (!empty.ok) throw new Error("setup");
    expect(await archiveTeamCore(owner(), empty.data.id)).toEqual({ ok: true, data: { name: "Empty" } });
    const [t] = await withFirm(F.firmId, (db) => db.select().from(teams).where(eq(teams.id, empty.data.id)));
    expect(t.archivedAt).not.toBeNull();
  });

  it("staff can't move people or change teams", async () => {
    const staff = actorFor(kl, "staff");
    expect(await movePersonCore(staff, { membershipId: jr.membershipId, teamId: null })).toEqual({ ok: false, error: TEAM_MESSAGES.forbidden });
    expect(await saveTeamCore(staff, { id: null, name: "X", leaderMembershipId: null })).toEqual({ ok: false, error: TEAM_MESSAGES.forbidden });
    expect(await archiveTeamCore(staff, medicalId)).toEqual({ ok: false, error: TEAM_MESSAGES.forbidden });
  });
});
