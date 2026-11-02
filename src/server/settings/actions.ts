"use server";

import { requireSession } from "@/lib/auth/session";
import { todayIn } from "@/lib/format";
import { settingsClerk } from "@/server/auth/clerk";
import { actorFrom } from "./common";
import { updateFirmProfileCore } from "./firm-profile";
import { updateModulesCore } from "./modules";
import { savePhasesCore } from "./phases";
import {
  addRoleCore,
  archiveRoleCore,
  editRoleCore,
  saveRatesCore,
} from "./rates";
import { saveTimeListsCore } from "./time-lists";
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

// ── Work settings (settings-rates-phases spec, milestone 1.1) ───────────────

/** Today in the firm's time zone, from the session. */
async function actorAndToday() {
  const session = await requireSession();
  return { actor: actorFrom(session), today: todayIn(session.firm.timezone) };
}

export async function savePhases(form: unknown) {
  return savePhasesCore(await actor(), form);
}

export async function saveRates(input: unknown) {
  const { actor, today } = await actorAndToday();
  return saveRatesCore(actor, input, today);
}

export async function addRole(input: unknown) {
  const { actor, today } = await actorAndToday();
  return addRoleCore(actor, input, today);
}

export async function editRole(input: unknown) {
  const { actor, today } = await actorAndToday();
  return editRoleCore(actor, input, today);
}

export async function archiveRole(roleId: unknown) {
  const { actor, today } = await actorAndToday();
  return archiveRoleCore(actor, roleId, today);
}

export async function saveTimeLists(form: unknown) {
  return saveTimeListsCore(await actor(), form);
}
