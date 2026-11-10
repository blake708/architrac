"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { timeActorFrom } from "./actor";
import { approveManyCore, approveStepCore, reopenTimesheetCore, returnTimesheetCore } from "./approval";

// Approvals server actions (timesheet-approval spec, Actions). Who is asking
// always comes from the session; each core checks permission, validates the
// input and writes in one transaction.

const actor = async () => timeActorFrom(await requireSession());
const refresh = () => revalidatePath("/app/time", "layout");

export async function approveStep(input: unknown) {
  const r = await approveStepCore(await actor(), input);
  refresh();
  return r;
}
export async function approveMany(input: unknown) {
  const r = await approveManyCore(await actor(), input);
  refresh();
  return r;
}
export async function returnTimesheet(input: unknown) {
  const r = await returnTimesheetCore(await actor(), input);
  refresh();
  return r;
}
export async function reopenTimesheet(input: unknown) {
  const r = await reopenTimesheetCore(await actor(), input);
  refresh();
  return r;
}
