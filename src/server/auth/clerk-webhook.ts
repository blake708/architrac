import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { NextRequest } from "next/server";
import { findFirmIdByClerkOrg } from "@/db/tenant";
import { loadClerkUser } from "./clerk";
import { deactivateMembership, ensureMembership } from "./memberships";
import { findUserByClerkId, upsertUser, userFactsFromClerkJson } from "./users";

/**
 * Handle one Clerk webhook (app-shell spec, business rule 7).
 *
 * 1. Check the Svix signature using CLERK_WEBHOOK_SIGNING_SECRET. A bad or
 *    missing signature gets 400 and nothing is written.
 * 2. Keep our users and memberships in step with Clerk. Every step is safe to
 *    receive twice; Clerk retries on any non-2xx answer.
 *
 * Firms are NOT created here: the create-firm form does that, so it can save
 * the time zone and fiscal year and undo the Clerk org if something fails.
 */
export async function handleClerkWebhook(req: NextRequest): Promise<Response> {
  let evt: Awaited<ReturnType<typeof verifyWebhook>>;
  try {
    evt = await verifyWebhook(req);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    switch (evt.type) {
      case "user.created":
      case "user.updated": {
        const facts = userFactsFromClerkJson(evt.data);
        if (facts) await upsertUser(facts);
        break;
      }

      case "organizationMembership.created": {
        const firmId = await findFirmIdByClerkOrg(evt.data.organization.id);
        // No firm yet: the create-firm form is still saving it, or the org was
        // made outside ArchiTrac. The sign-in check fills this in later.
        if (!firmId) break;
        const clerkUserId = evt.data.public_user_data.user_id;
        const user =
          (await findUserByClerkId(clerkUserId)) ??
          (await upsertUser(await loadClerkUser(clerkUserId)));
        await ensureMembership(firmId, user.id, { reactivate: true });
        break;
      }

      case "organizationMembership.deleted": {
        const firmId = await findFirmIdByClerkOrg(evt.data.organization.id);
        const user = await findUserByClerkId(evt.data.public_user_data.user_id);
        if (firmId && user) await deactivateMembership(firmId, user.id);
        break;
      }

      default:
        // Other events are ignored. Answer 200 so Clerk doesn't retry them.
        break;
    }
  } catch (err) {
    console.error(`Clerk webhook ${evt.type} failed`, err);
    return new Response("Webhook handler failed", { status: 500 });
  }

  return new Response("OK", { status: 200 });
}
