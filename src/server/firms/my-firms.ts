import { and, eq } from "drizzle-orm";
import { firms, memberships } from "@/db/schema";
import { findFirmIdByClerkOrg, withFirm } from "@/db/tenant";
import type { FirmSession } from "@/lib/auth/session";
import { listClerkOrganizationIds } from "@/server/auth/clerk";

// The firm switcher's list (app-shell spec, "Firm switcher menu list"):
// firms where I have an active membership, sorted by name.
//
// Row-level security only lets us look inside one firm at a time, so we ask
// Clerk which organizations the person is in, then check each firm through
// withFirm(). A person belongs to a handful of firms at most.

export type MyFirm = {
  clerkOrgId: string;
  name: string;
  logoUrl: string | null;
  current: boolean;
};

export type MyFirmsDeps = {
  /** Clerk organization ids this person belongs to. */
  listClerkOrgIds: () => Promise<string[]>;
};

/**
 * The signed-in person's firms, for the header (server code only). Loaded
 * when the page is drawn so the header knows whether to offer a switcher.
 */
export function listMyFirms({ firm, user }: FirmSession): Promise<MyFirm[]> {
  return listMyFirmsCore(user.id, firm.id, {
    listClerkOrgIds: () => listClerkOrganizationIds(user.clerkUserId),
  });
}

export async function listMyFirmsCore(
  userId: string,
  currentFirmId: string,
  deps: MyFirmsDeps,
): Promise<MyFirm[]> {
  const orgIds = await deps.listClerkOrgIds();

  const found = await Promise.all(
    orgIds.map(async (clerkOrgId): Promise<MyFirm | null> => {
      const firmId = await findFirmIdByClerkOrg(clerkOrgId);
      if (!firmId) return null;
      return withFirm(firmId, async (db) => {
        const [row] = await db
          .select({ name: firms.name, logoUrl: firms.logoUrl })
          .from(firms)
          .innerJoin(memberships, eq(memberships.firmId, firms.id))
          .where(
            and(
              eq(firms.id, firmId),
              eq(memberships.userId, userId),
              eq(memberships.active, true),
            ),
          );
        if (!row) return null;
        // Firm display names arrive in 0.6 (settings-firm spec).
        return {
          clerkOrgId,
          name: row.name,
          logoUrl: row.logoUrl,
          current: firmId === currentFirmId,
        };
      });
    }),
  );

  return found
    .filter((f): f is MyFirm => f !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}
