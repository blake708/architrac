"use server";

import { auth } from "@clerk/nextjs/server";
import { APP_ROLES, requireRole } from "@/lib/auth/permissions";
import { getSession, requireSession } from "@/lib/auth/session";
import {
  createClerkOrganization,
  deleteClerkOrganization,
  listClerkOrganizationIds,
  loadClerkUser,
} from "@/server/auth/clerk";
import { type CreateFirmResult, createFirmCore } from "./create-firm";
import { type MyFirm, listMyFirmsCore } from "./my-firms";

/**
 * Server action for the firm switcher: the firms I can switch to.
 * Permission: any active member (every role).
 */
export async function listMyFirms(): Promise<MyFirm[]> {
  const { firm, user, membership } = await requireSession();
  requireRole(membership, ...APP_ROLES);
  return listMyFirmsCore(user.id, firm.id, {
    listClerkOrgIds: () => listClerkOrganizationIds(user.clerkUserId),
  });
}

/**
 * Server action for /onboarding/create-firm.
 *
 * Permission: any signed-in person who isn't already in a firm. There's no
 * firm (and so no role) yet, so this is the one action that can't use
 * requireRole(); it checks the session instead. Making a second firm is not
 * in Release 0.
 */
export async function createFirm(
  _previous: CreateFirmResult | null,
  formData: FormData,
): Promise<CreateFirmResult> {
  const { userId } = await auth();
  if (!userId) {
    return { ok: false, error: "Your session ended. Sign in again." };
  }

  const current = await getSession();
  if (current.status !== "no_firm") {
    return { ok: false, error: "You already belong to a firm." };
  }

  return createFirmCore(
    {
      name: formData.get("name"),
      timezone: formData.get("timezone"),
      fiscalYearStartMonth: formData.get("fiscalYearStartMonth"),
    },
    {
      loadUser: () => loadClerkUser(userId),
      createOrg: (name) => createClerkOrganization(name, userId),
      deleteOrg: deleteClerkOrganization,
    },
  );
}
