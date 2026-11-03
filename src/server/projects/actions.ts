"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { FLASH_COOKIE, FLASH_MAX_AGE_SECONDS } from "@/lib/flash/flash";
import { PROJECT_MESSAGES } from "@/lib/projects/form";
import { requireSession } from "@/lib/auth/session";
import { actorFrom } from "@/server/settings/common";
import { createProjectCore } from "./create";
import {
  addLinkCore,
  removeConsultantCore,
  removeLinkCore,
  removeMemberCore,
  saveConsultantCore,
  saveMemberCore,
  updateProjectCore,
} from "./edit";

// Projects server actions (projects-list spec, Actions). Who is asking comes
// from the session; createProjectCore checks the role first.

export async function createProject(input: unknown) {
  const result = await createProjectCore(actorFrom(await requireSession()), input);
  if (result.ok) {
    revalidatePath("/app/projects");
    revalidatePath("/app/contacts");
    // "Project 2026-023 created" shows on the project's page.
    (await cookies()).set(FLASH_COOKIE, PROJECT_MESSAGES.created(result.data.number), {
      maxAge: FLASH_MAX_AGE_SECONDS,
      path: "/",
      sameSite: "lax",
    });
  }
  return result;
}

// ---------- Project page (project-detail spec) ----------

async function done<T extends { ok: boolean }>(projectId: unknown, result: T) {
  if (result.ok && typeof projectId === "string") {
    revalidatePath(`/app/projects/${projectId}`, "layout");
    revalidatePath("/app/projects");
    revalidatePath("/app/contacts");
  }
  return result;
}
const idOf = (input: unknown, key: "id" | "projectId") =>
  input && typeof input === "object" ? (input as Record<string, unknown>)[key] : undefined;

export async function updateProject(input: unknown) {
  const session = await requireSession();
  return done(idOf(input, "id"), await updateProjectCore(actorFrom(session), input, session.firm.timezone));
}
export async function saveMember(input: unknown) {
  return done(idOf(input, "projectId"), await saveMemberCore(actorFrom(await requireSession()), input));
}
export async function removeMember(input: unknown) {
  return done(idOf(input, "projectId"), await removeMemberCore(actorFrom(await requireSession()), input));
}
export async function saveConsultant(input: unknown) {
  return done(idOf(input, "projectId"), await saveConsultantCore(actorFrom(await requireSession()), input));
}
export async function removeConsultant(input: unknown) {
  return done(idOf(input, "projectId"), await removeConsultantCore(actorFrom(await requireSession()), input));
}
export async function addLink(input: unknown) {
  return done(idOf(input, "projectId"), await addLinkCore(actorFrom(await requireSession()), input));
}
export async function removeLink(input: unknown) {
  return done(idOf(input, "projectId"), await removeLinkCore(actorFrom(await requireSession()), input));
}
