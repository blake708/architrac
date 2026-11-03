"use server";

import { requireSession } from "@/lib/auth/session";
import { actorFrom } from "@/server/settings/common";
import {
  archiveCompanyCore,
  archiveContactCore,
  saveCompanyCore,
  saveContactCore,
} from "./contacts";

// Contacts server actions (contacts spec, Actions). Who is asking comes from
// the session; each *Core checks the role first.

async function actor() {
  return actorFrom(await requireSession());
}

export async function saveCompany(input: unknown) {
  return saveCompanyCore(await actor(), input);
}

export async function saveContact(input: unknown) {
  return saveContactCore(await actor(), input);
}

export async function archiveCompany(id: unknown) {
  return archiveCompanyCore(await actor(), id);
}

export async function archiveContact(id: unknown) {
  return archiveContactCore(await actor(), id);
}
