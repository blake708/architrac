import type { Pool } from "@neondatabase/serverless";
import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb } from "@/db/client";
import {
  activityLog,
  firmSettings,
  firms,
  invitations,
  memberships,
} from "@/db/schema";
import { withFirm } from "@/db/tenant";
import {
  type TestFirm,
  type TestMember,
  addTestMember,
  createOwnerPool,
  createTestFirm,
  removeTestFirm,
  removeTestUsers,
  requireDbEnv,
} from "@/db/test-helpers";
import type { AppRole } from "@/lib/auth/permissions";
import { ONLY_OWNER_MESSAGE } from "@/lib/auth/user-management";
import type { SettingsClerk } from "@/server/auth/clerk";
import { ensureMembership } from "@/server/auth/memberships";
import { FORBIDDEN_MESSAGE, type SettingsActor } from "./common";
import { updateFirmProfileCore } from "./firm-profile";
import { updateModulesCore } from "./modules";
import {
  ALREADY_INVITED_MESSAGE,
  changeRoleCore,
  countSeats,
  deactivateMemberCore,
  inviteUserCore,
  listPeople,
  resendInviteCore,
  revokeInviteCore,
} from "./people";

// Settings server actions against the real database (settings-firm spec,
// acceptance tests). Clerk is a fake that records what it was asked to do.

let pool: Pool;
let A: TestFirm;
let B: TestFirm;
let admin: TestMember;
let pm: TestMember;
let jr: TestMember;
const extraUsers: string[] = [];

beforeAll(async () => {
  requireDbEnv();
  pool = createOwnerPool();
  A = await createTestFirm(pool, "Settings");
  B = await createTestFirm(pool, "Other");
  admin = await addTestMember(pool, A, {
    firstName: "Ada",
    lastName: "Admin",
    role: "admin",
  });
  pm = await addTestMember(pool, A, {
    firstName: "Pat",
    lastName: "Manager",
    role: "project_manager",
  });
  jr = await addTestMember(pool, A, {
    firstName: "Jo",
    lastName: "Rivers",
    role: "staff",
    title: "Designer",
  });
  extraUsers.push(admin.userId, pm.userId, jr.userId);
});

afterAll(async () => {
  if (pool) {
    if (A) await removeTestFirm(pool, A);
    if (B) await removeTestFirm(pool, B);
    await removeTestUsers(pool, extraUsers);
    await pool.end();
  }
  await closeDb();
});

function fakeClerk() {
  let n = 0;
  return {
    renameOrg: vi.fn(async () => {}),
    createInvitation: vi.fn(async () => `orginv_test_${++n}_${Date.now()}`),
    revokeInvitation: vi.fn(async () => {}),
    setMemberRole: vi.fn(async () => {}),
    removeMember: vi.fn(async () => {}),
  } satisfies SettingsClerk;
}
let clerk: ReturnType<typeof fakeClerk>;
beforeEach(() => {
  clerk = fakeClerk();
});

function actorFor(
  firm: TestFirm,
  who: { userId: string; membershipId: string },
  appRole: AppRole,
): SettingsActor {
  return {
    firmId: firm.firmId,
    firmName: "Test Firm",
    clerkOrgId: firm.clerkOrgId,
    userId: who.userId,
    clerkUserId: `clerk_${who.userId}`,
    member: { membershipId: who.membershipId, appRole, active: true },
  };
}
const asOwner = () => actorFor(A, A, "owner");
const asAdmin = () => actorFor(A, admin, "admin");
const asPm = () => actorFor(A, pm, "project_manager");

const readFirm = () =>
  withFirm(A.firmId, (db) =>
    db.select().from(firms).where(eq(firms.id, A.firmId)).then((r) => r[0]),
  );
const readModules = () =>
  withFirm(A.firmId, (db) =>
    db
      .select({ m: firmSettings.modulesEnabled })
      .from(firmSettings)
      .where(eq(firmSettings.firmId, A.firmId))
      .then((r) => r[0].m),
  );
const lastLog = (entityType: string) =>
  withFirm(A.firmId, (db) =>
    db
      .select()
      .from(activityLog)
      .where(eq(activityLog.entityType, entityType))
      .orderBy(desc(activityLog.createdAt))
      .limit(1)
      .then((r) => r[0]),
  );

const profile = (over: Record<string, string> = {}) => ({
  name: "Test Firm",
  displayName: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  phone: "",
  website: "",
  licenseNumber: "",
  timezone: "America/New_York",
  fiscalYearStartMonth: "1",
  ...over,
});

describe("updateFirmProfile", () => {
  it("project managers get a permission error and nothing is saved", async () => {
    const r = await updateFirmProfileCore(asPm(), profile(), clerk);
    expect(r).toEqual({ ok: false, error: FORBIDDEN_MESSAGE });
  });

  it("saves cleaned phone and website", async () => {
    const r = await updateFirmProfileCore(
      asOwner(),
      profile({ phone: "843.555.0100", website: "https://www.TMG-Arch.com/" }),
      clerk,
    );
    expect(r.ok).toBe(true);
    const firm = await readFirm();
    expect(firm.phone).toBe("(843) 555-0100");
    expect(firm.website).toBe("www.tmg-arch.com");
    expect(firm.name).toBe("Test Firm");
  });

  it("Firm name is required: error and firms.name unchanged", async () => {
    const before = (await readFirm()).name;
    const r = await updateFirmProfileCore(asOwner(), profile({ name: "" }), clerk);
    expect(r).toEqual({
      ok: false,
      fieldErrors: { name: "Firm name is required" },
    });
    expect((await readFirm()).name).toBe(before);
  });

  it('ZIP "2940": error and nothing saved', async () => {
    const r = await updateFirmProfileCore(
      asOwner(),
      profile({ postalCode: "2940", city: "Charleston" }),
      clerk,
    );
    expect(r).toEqual({
      ok: false,
      fieldErrors: { postalCode: "Enter a 5-digit ZIP" },
    });
    expect((await readFirm()).city).toBeNull();
  });

  it('Display name "TMG": Clerk org renamed and one activity_log row with the change', async () => {
    const r = await updateFirmProfileCore(
      asAdmin(),
      profile({
        displayName: "TMG",
        phone: "(843) 555-0100",
        website: "www.tmg-arch.com",
      }),
      clerk,
    );
    expect(r.ok).toBe(true);
    expect(clerk.renameOrg).toHaveBeenCalledWith(A.clerkOrgId, "TMG");
    expect((await readFirm()).displayName).toBe("TMG");
    const log = await lastLog("firm");
    expect(log.action).toBe("updated");
    expect(log.actorUserId).toBe(admin.userId);
    // Only the field that changed is logged.
    expect(log.changes).toEqual({
      display_name: { before: null, after: "TMG" },
    });
  });

  it("if renaming the Clerk org fails, nothing is saved", async () => {
    clerk.renameOrg.mockRejectedValueOnce(new Error("Clerk is down"));
    const r = await updateFirmProfileCore(
      asOwner(),
      profile({
        displayName: "Someone Else",
        phone: "(843) 555-0100",
        website: "www.tmg-arch.com",
      }),
      clerk,
    );
    expect(r).toEqual({
      ok: false,
      error: "Couldn't save. Nothing was changed. Try again.",
    });
    expect((await readFirm()).displayName).toBe("TMG");
  });
});

describe("updateModules", () => {
  const TMG = [
    "build",
    "workload",
    "accounting",
    "marketing",
    "knowledge",
    "website",
    "hiring",
  ];

  it("project managers get a permission error", async () => {
    expect(await updateModulesCore(asPm(), TMG)).toEqual({
      ok: false,
      error: FORBIDDEN_MESSAGE,
    });
  });

  it("rejects unknown keys, including the retired schedule", async () => {
    const r = await updateModulesCore(asOwner(), ["schedule"]);
    expect(r.ok).toBe(false);
  });

  it("switching Hiring off removes it and logs before/after", async () => {
    await updateModulesCore(asOwner(), TMG);
    expect(await readModules()).toEqual(TMG);

    const r = await updateModulesCore(
      asAdmin(),
      TMG.filter((k) => k !== "hiring"),
    );
    expect(r.ok).toBe(true);
    expect(await readModules()).not.toContain("hiring");
    const log = await lastLog("firm_settings");
    expect(log.changes).toEqual({
      modules_enabled: { before: TMG, after: TMG.filter((k) => k !== "hiring") },
    });
  });

  it("Code on then off saves the same array as before", async () => {
    await updateModulesCore(asOwner(), TMG);
    await updateModulesCore(asOwner(), [...TMG.slice().reverse(), "code"].filter(
      (k) => k !== "code",
    ));
    expect(await readModules()).toEqual(TMG);
  });
});

describe("invitations", () => {
  const readInvite = (email: string) =>
    withFirm(A.firmId, (db) =>
      db
        .select()
        .from(invitations)
        .where(and(eq(invitations.firmId, A.firmId), eq(invitations.email, email)))
        .orderBy(desc(invitations.invitedAt)),
    );

  it("invite as Staff with title Designer: pending row, Clerk invited, shows in the list", async () => {
    const email = `new.designer.${Date.now()}@example.com`;
    const r = await inviteUserCore(
      asAdmin(),
      { email: email.toUpperCase(), appRole: "staff", title: "Designer" },
      clerk,
    );
    expect(r).toEqual({ ok: true, data: { email } });
    expect(clerk.createInvitation).toHaveBeenCalledWith({
      clerkOrgId: A.clerkOrgId,
      email,
      role: "org:member",
      inviterClerkUserId: `clerk_${admin.userId}`,
    });
    const [row] = await readInvite(email);
    expect(row).toMatchObject({
      status: "pending",
      appRole: "staff",
      title: "Designer",
      invitedBy: admin.userId,
    });
    expect(row.clerkInvitationId).toMatch(/^orginv_test_/);

    const people = await withFirm(A.firmId, (db) => listPeople(db, A.firmId));
    expect(people.invitations.map((i) => i.email)).toContain(email);
    expect((await lastLog("invitation")).action).toBe("created");
  });

  it("an active member's email: already a member, no invitation", async () => {
    const r = await inviteUserCore(
      asOwner(),
      { email: jr.email, appRole: "staff" },
      clerk,
    );
    expect(r).toEqual({
      ok: false,
      fieldErrors: { email: `${jr.email} is already a member` },
    });
    expect(await readInvite(jr.email)).toHaveLength(0);
    expect(clerk.createInvitation).not.toHaveBeenCalled();
  });

  it("a second invite for the same email: use Resend", async () => {
    const email = `twice.${Date.now()}@example.com`;
    await inviteUserCore(asOwner(), { email, appRole: "staff" }, clerk);
    const r = await inviteUserCore(asOwner(), { email, appRole: "admin" }, clerk);
    expect(r).toEqual({
      ok: false,
      fieldErrors: { email: ALREADY_INVITED_MESSAGE },
    });
  });

  it("an admin can't invite an owner", async () => {
    const r = await inviteUserCore(
      asAdmin(),
      { email: `boss.${Date.now()}@example.com`, appRole: "owner" },
      clerk,
    );
    expect(r).toEqual({ ok: false, error: ONLY_OWNER_MESSAGE });
  });

  it("if Clerk fails, the invitation is marked revoked and the error shows", async () => {
    const email = `fails.${Date.now()}@example.com`;
    clerk.createInvitation.mockRejectedValueOnce({
      errors: [{ longMessage: "Email address is invalid" }],
    });
    const r = await inviteUserCore(asOwner(), { email, appRole: "staff" }, clerk);
    expect(r).toEqual({
      ok: false,
      error: "Couldn't send the invite: Email address is invalid",
    });
    const [row] = await readInvite(email);
    expect(row.status).toBe("revoked");
  });

  it("Revoke: Clerk invitation revoked, row gone from the list, status revoked", async () => {
    const email = `revoke.${Date.now()}@example.com`;
    await inviteUserCore(asOwner(), { email, appRole: "staff" }, clerk);
    const [row] = await readInvite(email);

    const r = await revokeInviteCore(asOwner(), row.id, clerk);
    expect(r.ok).toBe(true);
    expect(clerk.revokeInvitation).toHaveBeenCalledWith({
      clerkOrgId: A.clerkOrgId,
      invitationId: row.clerkInvitationId,
      requestingClerkUserId: `clerk_${A.userId}`,
    });
    expect((await readInvite(email))[0].status).toBe("revoked");
    const people = await withFirm(A.firmId, (db) => listPeople(db, A.firmId));
    expect(people.invitations.map((i) => i.email)).not.toContain(email);
  });

  it("Resend: new Clerk invitation and a new invited_at", async () => {
    const email = `resend.${Date.now()}@example.com`;
    await inviteUserCore(asOwner(), { email, appRole: "staff" }, clerk);
    const [before] = await readInvite(email);
    const later = new Date(Date.now() + 60_000);

    const r = await resendInviteCore(asOwner(), before.id, clerk, later);
    expect(r.ok).toBe(true);
    expect(clerk.revokeInvitation).toHaveBeenCalledTimes(1);
    const [after] = await readInvite(email);
    expect(after.clerkInvitationId).not.toBe(before.clerkInvitationId);
    expect(after.invitedAt.getTime()).toBe(later.getTime());
    expect(after.status).toBe("pending");
  });

  it("an admin can't resend or revoke an owner invitation", async () => {
    const email = `owner-invite.${Date.now()}@example.com`;
    await inviteUserCore(asOwner(), { email, appRole: "owner" }, clerk);
    const [row] = await readInvite(email);
    expect(await revokeInviteCore(asAdmin(), row.id, clerk)).toEqual({
      ok: false,
      error: ONLY_OWNER_MESSAGE,
    });
    expect(await resendInviteCore(asAdmin(), row.id, clerk)).toEqual({
      ok: false,
      error: ONLY_OWNER_MESSAGE,
    });
  });

  it("signing up through the invite: membership with the invited role and title, invitation accepted", async () => {
    const email = `accept.${Date.now()}@example.com`;
    await inviteUserCore(
      asOwner(),
      { email, appRole: "staff", title: "Designer" },
      clerk,
    );
    // The invitee signs up: Clerk creates their user (our users row), then the
    // webhook calls ensureMembership.
    const u = await pool.query<{ id: string }>(
      "insert into users (clerk_user_id, email, first_name, last_name) values ($1, $2, 'New', 'Designer') returning id",
      [`user_test_accept_${Date.now()}`, email],
    );
    extraUsers.push(u.rows[0].id);

    const m = await ensureMembership(A.firmId, u.rows[0].id, { reactivate: true });
    expect(m).toMatchObject({ appRole: "staff", title: "Designer", active: true });
    const [inv] = await readInvite(email);
    expect(inv).toMatchObject({ status: "accepted", membershipId: m.id });
    expect(inv.acceptedAt).not.toBeNull();
  });

  it("accepting when a deactivated membership exists turns it back on with the invited role", async () => {
    const off = await addTestMember(pool, A, {
      firstName: "Old",
      lastName: "Timer",
      role: "staff",
      active: false,
    });
    extraUsers.push(off.userId);
    // Reactivate opens the invite form with their email; they can be invited
    // because they're not an active member.
    const r = await inviteUserCore(
      asOwner(),
      { email: off.email, appRole: "project_manager", title: "Project Architect" },
      clerk,
    );
    expect(r.ok).toBe(true);

    const m = await ensureMembership(A.firmId, off.userId, { reactivate: true });
    expect(m).toMatchObject({
      id: off.membershipId,
      active: true,
      appRole: "project_manager",
      title: "Project Architect",
    });
  });
});

describe("change role and deactivate (rule 7)", () => {
  const readMember = (id: string) =>
    withFirm(A.firmId, (db) =>
      db
        .select()
        .from(memberships)
        .where(eq(memberships.id, id))
        .then((r) => r[0]),
    );

  it("an admin can't change an owner's role", async () => {
    const r = await changeRoleCore(
      asAdmin(),
      { membershipId: A.membershipId, appRole: "staff" },
      clerk,
    );
    expect(r).toEqual({ ok: false, error: ONLY_OWNER_MESSAGE });
  });

  it("nobody changes their own role", async () => {
    const r = await changeRoleCore(
      asAdmin(),
      { membershipId: admin.membershipId, appRole: "staff" },
      clerk,
    );
    expect(r.ok).toBe(false);
  });

  it("the last active owner can't be demoted, even by another owner", async () => {
    // A second owner who is turned off doesn't count.
    const offOwner = await addTestMember(pool, A, {
      firstName: "Former",
      lastName: "Owner",
      role: "owner",
      active: false,
    });
    extraUsers.push(offOwner.userId);
    const r = await changeRoleCore(
      actorFor(A, offOwner, "owner"),
      { membershipId: A.membershipId, appRole: "admin" },
      clerk,
    );
    expect(r).toEqual({
      ok: false,
      error: "Test Firm needs at least one owner.",
    });
    expect((await readMember(A.membershipId)).appRole).toBe("owner");
  });

  it("Staff → Project manager: saved and logged; Clerk role unchanged (both org:member)", async () => {
    const r = await changeRoleCore(
      asAdmin(),
      { membershipId: pm.membershipId, appRole: "staff" },
      clerk,
    );
    expect(r.ok).toBe(true);
    expect((await readMember(pm.membershipId)).appRole).toBe("staff");
    expect(clerk.setMemberRole).not.toHaveBeenCalled();
    const log = await lastLog("membership");
    expect(log).toMatchObject({
      action: "status_changed",
      changes: { app_role: { before: "project_manager", after: "staff" } },
    });
  });

  it("Staff → Admin updates the Clerk role to org:admin", async () => {
    await changeRoleCore(
      asOwner(),
      { membershipId: pm.membershipId, appRole: "admin" },
      clerk,
    );
    expect(clerk.setMemberRole).toHaveBeenCalledWith({
      clerkOrgId: A.clerkOrgId,
      clerkUserId: pm.clerkUserId,
      role: "org:admin",
    });
    await changeRoleCore(
      asOwner(),
      { membershipId: pm.membershipId, appRole: "project_manager" },
      clerk,
    );
  });

  it("deactivating JR: membership off, removed from the Clerk org, row kept", async () => {
    const r = await deactivateMemberCore(asAdmin(), jr.membershipId, clerk);
    expect(r).toEqual({ ok: true, data: { name: "Jo Rivers" } });
    const row = await readMember(jr.membershipId);
    expect(row.active).toBe(false);
    expect(row.archivedAt).toBeNull();
    expect(clerk.removeMember).toHaveBeenCalledWith({
      clerkOrgId: A.clerkOrgId,
      clerkUserId: jr.clerkUserId,
    });
    const people = await withFirm(A.firmId, (db) => listPeople(db, A.firmId));
    expect(
      people.members.find((m) => m.membershipId === jr.membershipId)?.active,
    ).toBe(false);
  });

  it("nobody deactivates themselves; the last owner can't be turned off", async () => {
    expect(
      (await deactivateMemberCore(asOwner(), A.membershipId, clerk)).ok,
    ).toBe(false);
    expect(clerk.removeMember).not.toHaveBeenCalled();
  });

  it("if Clerk fails, the role change is rolled back", async () => {
    clerk.setMemberRole.mockRejectedValueOnce(new Error("Clerk is down"));
    const r = await changeRoleCore(
      asOwner(),
      { membershipId: admin.membershipId, appRole: "staff" },
      clerk,
    );
    expect(r.ok).toBe(false);
    expect((await readMember(admin.membershipId)).appRole).toBe("admin");
  });
});

describe("people list and seats", () => {
  it("members sorted by last name, with off members included", async () => {
    const { members } = await withFirm(A.firmId, (db) =>
      listPeople(db, A.firmId),
    );
    const last = members.map((m) => m.lastName);
    expect(last).toEqual([...last].sort((a, b) => a.localeCompare(b)));
    expect(members.some((m) => !m.active)).toBe(true);
  });

  it("seats count active members only", async () => {
    const seats = await withFirm(A.firmId, (db) => countSeats(db, A.firmId));
    const { members } = await withFirm(A.firmId, (db) =>
      listPeople(db, A.firmId),
    );
    expect(seats).toBe(members.filter((m) => m.active).length);
  });

  it("firm A asking for firm B's people gets no rows (row-level security)", async () => {
    const people = await withFirm(A.firmId, (db) => listPeople(db, B.firmId));
    expect(people).toEqual({ members: [], invitations: [] });
    const seats = await withFirm(A.firmId, (db) => countSeats(db, B.firmId));
    expect(seats).toBe(0);
  });
});
