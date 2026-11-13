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
  setConsultantPercentCore,
  setPhasePercentCore,
  submitForReviewCore,
  toggleEntryCore,
  updateDraftSettingsCore,
} from "./builder";
import { withFirm } from "@/db/tenant";
import { loadSendDefaults } from "./detail";
import type { InvoiceActor } from "./draft";
import { deletePaymentCore, recordPaymentCore } from "./payments";
import { resendInvoiceCore, sendInvoiceCore, voidInvoiceCore } from "./send";

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
export async function setConsultantPercent(input: unknown) {
  return andRefresh(setConsultantPercentCore(await actor(), input));
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

/** The Send dialog's starting values (number it should get, today's date, email). */
export async function prepareSend(invoiceId: string) {
  const a = await actor();
  if (typeof invoiceId !== "string") return null;
  return withFirm(a.firmId, (db) => loadSendDefaults(db, a, invoiceId));
}
export async function sendInvoice(input: unknown) {
  const r = await sendInvoiceCore(await actor(), input);
  refresh();
  return r;
}
export async function resendInvoice(input: unknown) {
  return andRefresh(resendInvoiceCore(await actor(), input));
}
export async function voidInvoice(input: unknown) {
  const r = await voidInvoiceCore(await actor(), input);
  if (r.ok) refresh(r.data.projectId);
  return r;
}

// Payments (rule 9): owner and admin only.
export async function recordPayment(input: unknown) {
  const r = await recordPaymentCore(await actor(), input);
  if (r.ok) refresh(r.data.projectId);
  return r;
}
export async function deletePayment(input: unknown) {
  const r = await deletePaymentCore(await actor(), input);
  if (r.ok) refresh(r.data.projectId);
  return r;
}
