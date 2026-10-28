"use server";

import { auth } from "@clerk/nextjs/server";
import { getSession } from "@/lib/auth/session";
import {
  createClerkOrganization,
  deleteClerkOrganization,
  loadClerkUser,
} from "@/server/auth/clerk";
import { type CreateFirmResult, createFirmCore } from "./create-firm";

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
