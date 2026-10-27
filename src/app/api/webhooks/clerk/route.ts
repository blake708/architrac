import type { NextRequest } from "next/server";
import { handleClerkWebhook } from "@/server/auth/clerk-webhook";

// Clerk calls this when users and org memberships change.
// Not behind sign-in: it proves who it is with a Svix signature instead.
export function POST(req: NextRequest) {
  return handleClerkWebhook(req);
}
