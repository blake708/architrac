"use server";

import { requireSession } from "@/lib/auth/session";
import { settingsClerk } from "@/server/auth/clerk";
import { actorFrom } from "@/server/settings/common";
import {
  archiveTeamCore,
  editProfileCore,
  movePersonCore,
  saveTeamCore,
  teamInviteCore,
} from "./team";

// Team page server actions (team spec, Actions). Who is asking comes from the
// session; each *Core checks owner/admin before doing anything. Access level,
// deactivate, resend and revoke are the Settings actions in
// src/server/settings/actions.ts, shared with Users & access.

async function actor() {
  return actorFrom(await requireSession());
}

export async function invitePerson(input: unknown) {
  return teamInviteCore(await actor(), input, settingsClerk);
}

export async function editProfile(input: unknown) {
  return editProfileCore(await actor(), input);
}

export async function movePerson(input: unknown) {
  return movePersonCore(await actor(), input);
}

export async function saveTeam(input: unknown) {
  return saveTeamCore(await actor(), input);
}

export async function archiveTeam(teamId: unknown) {
  return archiveTeamCore(await actor(), teamId);
}
