import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";
import { firmSettings, firms, memberships } from "@/db/schema";
import { findFirmIdByClerkOrg, withFirm } from "@/db/tenant";
import { hasAnyClerkOrganization, loadClerkUser } from "@/server/auth/clerk";
import { type Membership, ensureMembership } from "@/server/auth/memberships";
import { type User, findUserByClerkId, upsertUser } from "@/server/auth/users";

export type Firm = typeof firms.$inferSelect;
export type FirmSettings = typeof firmSettings.$inferSelect;

/** Everything a signed-in page needs to know about who is asking. */
export type FirmSession = {
  firm: Firm;
  settings: FirmSettings;
  user: User;
  membership: Membership;
};

export type SessionResult =
  | { status: "signed_out" }
  /** Belongs to a firm in Clerk but none is selected in this browser. */
  | { status: "choose_firm" }
  /** Signed in, but no firm yet: send to create-firm. */
  | { status: "no_firm" }
  /** Their membership in the selected firm is switched off. */
  | { status: "deactivated"; firm: Firm }
  | { status: "ok"; session: FirmSession };

/**
 * Work out who is signed in and which firm they're working in
 * (app-shell spec, business rules 1 and 2).
 *
 * Clerk session → firm (by Clerk organization id) → our user row → membership.
 * Fills in the user and membership rows if Clerk's webhook hasn't arrived yet.
 * Cached per request, so calling it from a layout and a page costs one lookup.
 */
export const getSession = cache(async (): Promise<SessionResult> => {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) return { status: "signed_out" };

  if (!orgId) {
    return (await hasAnyClerkOrganization(clerkUserId))
      ? { status: "choose_firm" }
      : { status: "no_firm" };
  }

  const firmId = await findFirmIdByClerkOrg(orgId);
  if (!firmId) return { status: "no_firm" };

  const user =
    (await findUserByClerkId(clerkUserId)) ??
    (await upsertUser(await loadClerkUser(clerkUserId)));

  const loaded = await withFirm(firmId, async (db) => {
    const [firm] = await db.select().from(firms).where(eq(firms.id, firmId));
    const [settings] = await db
      .select()
      .from(firmSettings)
      .where(eq(firmSettings.firmId, firmId));
    const [membership] = await db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, user.id));
    return { firm, settings, membership };
  });

  // Clerk says they're in this org but we have no row yet (webhook late).
  const membership =
    loaded.membership ??
    (await ensureMembership(firmId, user.id, { reactivate: false }));

  if (!membership.active) return { status: "deactivated", firm: loaded.firm };

  return {
    status: "ok",
    session: { firm: loaded.firm, settings: loaded.settings, user, membership },
  };
});

/**
 * For pages and server actions under /app: returns the session, or sends the
 * person where they need to go (sign-in, choose a firm, create a firm, or the
 * "access turned off" page).
 */
export async function requireSession(): Promise<FirmSession> {
  const result = await getSession();
  switch (result.status) {
    case "ok":
      return result.session;
    case "signed_out":
      redirect("/sign-in");
    case "choose_firm":
      redirect("/onboarding/choose-firm");
    case "no_firm":
      redirect("/onboarding/create-firm");
    case "deactivated":
      redirect("/onboarding/access-off");
  }
}
