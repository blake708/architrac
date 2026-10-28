import { describe, expect, it } from "vitest";
import {
  NOT_YOURSELF_MESSAGE,
  ONLY_OWNER_MESSAGE,
  type Actor,
  assignableRoles,
  canManageRole,
  clerkRoleFor,
  memberChangeBlocked,
  removesLastOwner,
  roleChangeBlocked,
} from "./user-management";

const owner: Actor = {
  membershipId: "m-owner",
  appRole: "owner",
  active: true,
};
const admin: Actor = {
  membershipId: "m-admin",
  appRole: "admin",
  active: true,
};
const pm: Actor = {
  membershipId: "m-pm",
  appRole: "project_manager",
  active: true,
};

describe("assignableRoles", () => {
  it("an admin's role select lists Admin, Project manager, Staff and not Owner", () => {
    expect(assignableRoles(admin)).toEqual([
      "admin",
      "project_manager",
      "staff",
    ]);
  });
  it("an owner can give every role", () => {
    expect(assignableRoles(owner)).toEqual([
      "owner",
      "admin",
      "project_manager",
      "staff",
    ]);
  });
  it("project managers and staff can't give any", () => {
    expect(assignableRoles(pm)).toEqual([]);
  });
});

describe("who may change whom", () => {
  const ownerTarget = {
    membershipId: "m-other-owner",
    appRole: "owner" as const,
  };
  const staffTarget = { membershipId: "m-staff", appRole: "staff" as const };

  it("only an owner may touch an owner", () => {
    expect(canManageRole(admin, "owner")).toBe(false);
    expect(canManageRole(owner, "owner")).toBe(true);
    expect(memberChangeBlocked(admin, ownerTarget)).toBe(ONLY_OWNER_MESSAGE);
    expect(memberChangeBlocked(owner, ownerTarget)).toBeNull();
  });

  it("an admin can't promote someone to owner", () => {
    expect(roleChangeBlocked(admin, staffTarget, "owner")).toBe(
      ONLY_OWNER_MESSAGE,
    );
    expect(roleChangeBlocked(admin, staffTarget, "project_manager")).toBeNull();
  });

  it("nobody changes their own role or turns themselves off", () => {
    expect(
      memberChangeBlocked(owner, { membershipId: "m-owner", appRole: "owner" }),
    ).toBe(NOT_YOURSELF_MESSAGE);
  });

  it("project managers can't change anyone", () => {
    expect(memberChangeBlocked(pm, staffTarget)).not.toBeNull();
  });
});

describe("removesLastOwner", () => {
  const theOwner = { appRole: "owner" as const, active: true };
  it("demoting or turning off the only active owner is blocked", () => {
    expect(removesLastOwner(theOwner, 1, { role: "admin" })).toBe(true);
    expect(removesLastOwner(theOwner, 1, { deactivate: true })).toBe(true);
  });
  it("fine when another active owner exists, or the role stays owner", () => {
    expect(removesLastOwner(theOwner, 2, { role: "admin" })).toBe(false);
    expect(removesLastOwner(theOwner, 1, { role: "owner" })).toBe(false);
  });
  it("doesn't apply to non-owners", () => {
    expect(
      removesLastOwner({ appRole: "staff", active: true }, 1, {
        deactivate: true,
      }),
    ).toBe(false);
  });
});

describe("clerkRoleFor", () => {
  it("owner/admin → org:admin, others → org:member", () => {
    expect(clerkRoleFor("owner")).toBe("org:admin");
    expect(clerkRoleFor("admin")).toBe("org:admin");
    expect(clerkRoleFor("project_manager")).toBe("org:member");
    expect(clerkRoleFor("staff")).toBe("org:member");
  });
});
