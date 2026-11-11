"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { actorFrom } from "@/server/settings/common";
import {
  createDraftInvoiceCore,
  deleteDraftCore,
  recalculateDraftCore,
  removeLineCore,
  returnToDraftCore,
  saveAdjustmentCore,
  saveConsultantLineCore,
  setPhasePercentCore,
  submitForReviewCore,
  toggleEntryCore,
  updateDraftSettingsCore,
} from "./builder";
import type { InvoiceActor } from "./draft";

// Invoice server actions (invoicing spec, Actions). Who is asking comes from
// the session; each *Core function checks permission before doing anything.

async function actor(): Promise<InvoiceActor> {
  const session = await requireSession();
  return { ...actorFrom(session), timezone: session.firm.timezone };
}

/** Pages that show invoice money: refresh them after a change. */
function refresh(projectId?: string) {
  revalidatePath("/app/invoices");
  revalidatePath("/app/projects");
  revalidatePath("/app/contacts");
  if (projectId) revalidatePath(`/app/projects/${projectId}`, "layout");
}

async function andRefresh<T extends { ok: boolean }>(result: Promise<T>): Promise<T> {
  const r = await result;
  if (r.ok) refresh();
  return r;
}

export async function createDraftInvoice(input: unknown) {
  return andRefresh(createDraftInvoiceCore(await actor(), input));
}
export async function updateDraftSettings(input: unknown) {
  return andRefresh(updateDraftSettingsCore(await actor(), input));
}
export async function setPhasePercent(input: unknown) {
  return andRefresh(setPhasePercentCore(await actor(), input));
}
export async function toggleEntry(input: unknown) {
  return andRefresh(toggleEntryCore(await actor(), input));
}
export async function recalculateDraft(input: unknown) {
  return andRefresh(recalculateDraftCore(await actor(), input));
}
export async function saveConsultantLine(input: unknown) {
  return andRefresh(saveConsultantLineCore(await actor(), input));
}
export async function saveAdjustment(input: unknown) {
  return andRefresh(saveAdjustmentCore(await actor(), input));
}
export async function removeLine(input: unknown) {
  return andRefresh(removeLineCore(await actor(), input));
}
export async function submitForReview(input: unknown) {
  return andRefresh(submitForReviewCore(await actor(), input));
}
export async function returnToDraft(input: unknown) {
  return andRefresh(returnToDraftCore(await actor(), input));
}
export async function deleteDraft(input: unknown) {
  const r = await deleteDraftCore(await actor(), input);
  if (r.ok) refresh(r.data.projectId);
  return r;
}
