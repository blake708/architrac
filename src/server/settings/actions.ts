"use server";

import { requireSession } from "@/lib/auth/session";
import { settingsClerk } from "@/server/auth/clerk";
import { actorFrom } from "./common";
import { updateFirmProfileCore } from "./firm-profile";
import { updateModulesCore } from "./modules";
import {
  changeRoleCore,
  deactivateMemberCore,
  inviteUserCore,
  resendInviteCore,
  revokeInviteCore,
} from "./people";

// Server actions for Settings (settings-firm spec, Actions table).
//
// Every one works out who is asking from the session on the server; nothing
// the browser sends (like a firm id) is trusted. The *Core functions check
// the role (owner/admin, business rule 1) before doing anything.

async function actor() {
  return actorFrom(await requireSession());
}

export async function updateFirmProfile(values: unknown) {
  return updateFirmProfileCore(await actor(), values, settingsClerk);
}

export async function updateModules(keys: unknown) {
  return updateModulesCore(await actor(), keys);
}

export async function inviteUser(input: unknown) {
  return inviteUserCore(await actor(), input, settingsClerk);
}

export async function resendInvite(invitationId: unknown) {
  return resendInviteCore(await actor(), invitationId, settingsClerk);
}

export async function revokeInvite(invitationId: unknown) {
  return revokeInviteCore(await actor(), invitationId, settingsClerk);
}

export async function changeRole(membershipId: unknown, appRole: unknown) {
  return changeRoleCore(
    await actor(),
    { membershipId, appRole },
    settingsClerk,
  );
}

export async function deactivateMember(membershipId: unknown) {
  return deactivateMemberCore(await actor(), membershipId, settingsClerk);
}
