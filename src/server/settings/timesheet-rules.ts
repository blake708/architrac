import { eq } from "drizzle-orm";
import { activityLog, firmSettings } from "@/db/schema";
import { type TenantDb, withFirm } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import { type TimesheetRules, shortTime, timesheetRulesSchema } from "@/lib/settings/timesheet-rules";
import { type ActionResult, SAVE_FAILED_MESSAGE, type SettingsActor, forbidden } from "./common";
import { STALE_MESSAGE } from "./phases";

// Settings → Time & approvals → "Timesheets" card. Saves straight away
// (decision #18), owner/admin only, and logs what changed.

export async function loadTimesheetRules(db: TenantDb): Promise<TimesheetRules> {
  const [s] = await db.select().from(firmSettings);
  return {
    lockDay: s.timesheetLockDay,
    dueTime: shortTime(s.timesheetDueTime),
    billableNotesRequired: s.billableNotesRequired,
  };
}

export async function saveTimesheetRulesCore(
  actor: SettingsActor,
  raw: unknown,
): Promise<ActionResult<never, { rules: TimesheetRules }>> {
  if (!can(actor.member, "settings.edit")) return forbidden;
  const parsed = timesheetRulesSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: STALE_MESSAGE };
  const next = parsed.data;
  try {
    const rules = await withFirm(actor.firmId, async (db) => {
      const before = await loadTimesheetRules(db);
      await db
        .update(firmSettings)
        .set({ timesheetLockDay: next.lockDay, timesheetDueTime: next.dueTime, billableNotesRequired: next.billableNotesRequired })
        .where(eq(firmSettings.firmId, actor.firmId));
      const changes: Record<string, { before: unknown; after: unknown }> = {};
      if (before.lockDay !== next.lockDay) changes.timesheet_lock_day = { before: before.lockDay, after: next.lockDay };
      if (before.dueTime !== next.dueTime) changes.timesheet_due_time = { before: before.dueTime, after: next.dueTime };
      if (before.billableNotesRequired !== next.billableNotesRequired)
        changes.billable_notes_required = { before: before.billableNotesRequired, after: next.billableNotesRequired };
      if (Object.keys(changes).length)
        await db.insert(activityLog).values({
          firmId: actor.firmId,
          actorUserId: actor.userId,
          entityType: "firm_settings",
          entityId: actor.firmId,
          action: "updated",
          changes,
        });
      return loadTimesheetRules(db);
    });
    return { ok: true, data: { rules } };
  } catch (err) {
    console.error("saveTimesheetRules failed", err);
    return { ok: false, error: SAVE_FAILED_MESSAGE };
  }
}
