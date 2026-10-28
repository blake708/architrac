import { clerkClient } from "@clerk/nextjs/server";
import type { ClerkUserFacts } from "./users";

// The few calls we make to Clerk's server API, kept in one file so the rest
// of the code (and its tests) doesn't depend on Clerk directly.

/** Fetch a user from Clerk and pull out the fields we store. */
export async function loadClerkUser(
  clerkUserId: string,
): Promise<ClerkUserFacts> {
  const client = await clerkClient();
  const u = await client.users.getUser(clerkUserId);
  const email = u.primaryEmailAddress?.emailAddress;
  if (!email) {
    throw new Error(`Clerk user ${clerkUserId} has no primary email address`);
  }
  return {
    clerkUserId: u.id,
    email,
    firstName: u.firstName ?? "",
    lastName: u.lastName ?? "",
    avatarUrl: u.hasImage ? u.imageUrl : null,
  };
}

/** Does this user belong to at least one Clerk organization (firm)? */
export async function hasAnyClerkOrganization(
  clerkUserId: string,
): Promise<boolean> {
  const client = await clerkClient();
  const list = await client.users.getOrganizationMembershipList({
    userId: clerkUserId,
    limit: 1,
  });
  return list.totalCount > 0;
}

/** Ids of every Clerk organization (firm) this user belongs to. */
export async function listClerkOrganizationIds(
  clerkUserId: string,
): Promise<string[]> {
  const client = await clerkClient();
  const list = await client.users.getOrganizationMembershipList({
    userId: clerkUserId,
    limit: 100,
  });
  return list.data.map((m) => m.organization.id);
}

/** Create a Clerk organization with this user as its admin. Returns its id. */
export async function createClerkOrganization(
  name: string,
  createdBy: string,
): Promise<string> {
  const client = await clerkClient();
  const org = await client.organizations.createOrganization({
    name,
    createdBy,
  });
  return org.id;
}

export async function deleteClerkOrganization(
  clerkOrgId: string,
): Promise<void> {
  const client = await clerkClient();
  await client.organizations.deleteOrganization(clerkOrgId);
}

// --- Settings → Firm profile and Users & access (milestone 0.6) ---

/** The Clerk calls the settings actions make. Tests pass a fake instead. */
export type SettingsClerk = {
  /** Rename the org (Clerk uses it in invitation emails). */
  renameOrg(clerkOrgId: string, name: string): Promise<void>;
  /** Send an invitation email. Returns Clerk's invitation id. */
  createInvitation(p: {
    clerkOrgId: string;
    email: string;
    role: "org:admin" | "org:member";
    inviterClerkUserId: string;
  }): Promise<string>;
  revokeInvitation(p: {
    clerkOrgId: string;
    invitationId: string;
    requestingClerkUserId: string;
  }): Promise<void>;
  setMemberRole(p: {
    clerkOrgId: string;
    clerkUserId: string;
    role: "org:admin" | "org:member";
  }): Promise<void>;
  /** Remove someone from the org, so they can't sign in to this firm. */
  removeMember(p: { clerkOrgId: string; clerkUserId: string }): Promise<void>;
};

export const settingsClerk: SettingsClerk = {
  async renameOrg(clerkOrgId, name) {
    const client = await clerkClient();
    await client.organizations.updateOrganization(clerkOrgId, { name });
  },
  async createInvitation({ clerkOrgId, email, role, inviterClerkUserId }) {
    const client = await clerkClient();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const invitation = await client.organizations.createOrganizationInvitation({
      organizationId: clerkOrgId,
      emailAddress: email,
      role,
      inviterUserId: inviterClerkUserId,
      redirectUrl: `${appUrl}/sign-up`,
    });
    return invitation.id;
  },
  async revokeInvitation({ clerkOrgId, invitationId, requestingClerkUserId }) {
    const client = await clerkClient();
    await client.organizations.revokeOrganizationInvitation({
      organizationId: clerkOrgId,
      invitationId,
      requestingUserId: requestingClerkUserId,
    });
  },
  async setMemberRole({ clerkOrgId, clerkUserId, role }) {
    const client = await clerkClient();
    await client.organizations.updateOrganizationMembership({
      organizationId: clerkOrgId,
      userId: clerkUserId,
      role,
    });
  },
  async removeMember({ clerkOrgId, clerkUserId }) {
    const client = await clerkClient();
    await client.organizations.deleteOrganizationMembership({
      organizationId: clerkOrgId,
      userId: clerkUserId,
    });
  },
};
