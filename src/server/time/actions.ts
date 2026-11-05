"use server";

import { requireSession } from "@/lib/auth/session";
import { timeActorFrom } from "./actor";
import {
  addRowCore,
  copyLastWeekCore,
  recallTimesheetCore,
  removeRowCore,
  setHoursCore,
  setNoteCore,
  submitTimesheetCore,
  updateRowCore,
} from "./write";

// Timesheet server actions (timesheet spec, Actions). Who is asking always
// comes from the session, never from the input.

const actor = async () => timeActorFrom(await requireSession());

export async function addRow(input: unknown) {
  return addRowCore(await actor(), input);
}
export async function updateRow(input: unknown) {
  return updateRowCore(await actor(), input);
}
export async function removeRow(input: unknown) {
  return removeRowCore(await actor(), input);
}
export async function setHours(input: unknown) {
  return setHoursCore(await actor(), input);
}
export async function submitTimesheet(input: unknown) {
  return submitTimesheetCore(await actor(), input);
}
export async function recallTimesheet(input: unknown) {
  return recallTimesheetCore(await actor(), input);
}
export async function setNote(input: unknown) {
  return setNoteCore(await actor(), input);
}
export async function copyLastWeek(input: unknown) {
  return copyLastWeekCore(await actor(), input);
}
