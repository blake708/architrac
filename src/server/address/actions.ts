"use server";

import { requireSession } from "@/lib/auth/session";
import { detailsCore, suggestCore } from "./google";

// Address lookup for the project and company forms. Anyone signed in to a
// firm can use it; the Google key stays on the server.

export async function suggestAddresses(input: unknown) {
  await requireSession();
  return suggestCore(input);
}

export async function addressDetails(input: unknown) {
  await requireSession();
  return detailsCore(input);
}
