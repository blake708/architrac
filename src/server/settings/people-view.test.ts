import { describe, expect, it } from "vitest";
import type { Actor } from "@/lib/auth/user-management";
import type { InvitationRow, MemberRow } from "./people";
import { type MemberView, buildPeopleView } from "./people-view";

const member = (
  id: string,
  appRole: MemberRow["appRole"],
  active = true,
): MemberRow => ({
  kind: "member",
  membershipId: id,
  firstName: id.toUpperCase(),
  lastName: "Person",
  email: `${id}@example.com`,
  initials: "XP",
  avatarUrl: null,
  clerkUserId: `user_${id}`,
  title: null,
  appRole,
  active,
});

const members = [
  member("owner", "owner"),
  member("admin", "admin"),
  member("jr", "staff"),
  member("gone", "staff", false),
];
const invites: InvitationRow[] = [
  {
    kind: "invitation",
    invitationId: "inv-owner",
    email: "boss@example.com",
    title: null,
    appRole: "owner",
    status: "pending",
    invitedAt: new Date("2026-10-20T15:00:00Z"),
  },
  {
    kind: "invitation",
    invitationId: "inv-staff",
    email: "new@example.com",
    title: "Designer",
    appRole: "staff",
    status: "expired",
    invitedAt: new Date("2026-10-01T15:00:00Z"),
  },
];

const ownerMe: Actor = {
  membershipId: "owner",
  appRole: "owner",
  active: true,
};
const adminMe: Actor = {
  membershipId: "admin",
  appRole: "admin",
  active: true,
};

function view(me: Actor) {
  return buildPeopleView(me, members, invites, "America/New_York");
}
const row = (rows: ReturnType<typeof view>, id: string) =>
  rows.find((r) => r.id === id) as MemberView;

describe("buildPeopleView", () => {
  it("members first, then invitations; statuses and dates", () => {
    const rows = view(ownerMe);
    expect(rows.map((r) => r.kind)).toEqual([
      "member",
      "member",
      "member",
      "member",
      "invitation",
      "invitation",
    ]);
    expect(rows.map((r) => r.status)).toEqual([
      "active",
      "active",
      "active",
      "off",
      "invited",
      "expired",
    ]);
    expect(rows[4]).toMatchObject({ invitedOn: "Oct 20", roleLabel: "Owner" });
  });

  it("an admin viewing an owner's row: plain text role and no actions", () => {
    const r = row(view(adminMe), "owner");
    expect(r.roleOptions).toBeNull();
    expect(r.actions).toEqual([]);
  });

  it("an admin's role select lists Admin, Project manager, Staff", () => {
    expect(row(view(adminMe), "jr").roleOptions).toEqual([
      "admin",
      "project_manager",
      "staff",
    ]);
  });

  it("my own row has no role select and no Deactivate", () => {
    const r = row(view(ownerMe), "owner");
    expect(r.isMe).toBe(true);
    expect(r.roleOptions).toBeNull();
    expect(r.actions).toEqual([]);
  });

  it("active members can be deactivated; off members can be reactivated", () => {
    expect(row(view(adminMe), "jr").actions).toEqual(["deactivate"]);
    expect(row(view(adminMe), "gone").actions).toEqual(["reactivate"]);
  });

  it("an admin can't resend or revoke an owner invitation", () => {
    const rows = view(adminMe);
    expect(rows.find((r) => r.id === "inv-owner")?.actions).toEqual([]);
    expect(rows.find((r) => r.id === "inv-staff")?.actions).toEqual([
      "resend",
      "revoke",
    ]);
  });
});
