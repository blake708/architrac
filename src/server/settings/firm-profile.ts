import { eq } from "drizzle-orm";
import { activityLog, firms } from "@/db/schema";
import { withFirm } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import {
  type FirmProfileField,
  type FirmProfileForm,
  firmDisplayName,
  firmProfileChanges,
  firmProfileForm,
  parseFirmProfile,
} from "@/lib/settings/firm-profile";
import type { SettingsClerk } from "@/server/auth/clerk";
import {
  type ActionResult,
  SAVE_FAILED_MESSAGE,
  type SettingsActor,
  forbidden,
} from "./common";

export type UpdateFirmProfileResult = ActionResult<
  FirmProfileField,
  { values: FirmProfileForm }
>;

/**
 * Save Settings → Firm profile (settings-firm spec, "Save changes (Firm)").
 *
 * All or nothing: the firm row, the activity log and the Clerk org rename run
 * in one transaction, so if Clerk fails nothing is saved. Returns the cleaned
 * values so the form shows "(843) 555-0100" after saving "843.555.0100".
 */
export async function updateFirmProfileCore(
  actor: SettingsActor,
  raw: unknown,
  clerk: Pick<SettingsClerk, "renameOrg">,
): Promise<UpdateFirmProfileResult> {
  if (!can(actor.member, "settings.edit")) return forbidden;

  const parsed = parseFirmProfile(raw);
  if (!parsed.ok) return { ok: false, fieldErrors: parsed.fieldErrors };
  const values = parsed.values;

  try {
    await withFirm(actor.firmId, async (db) => {
      const [before] = await db
        .select()
        .from(firms)
        .where(eq(firms.id, actor.firmId))
        .for("update");
      const changes = firmProfileChanges(before, values);
      if (Object.keys(changes).length === 0) return;

      await db.update(firms).set(values).where(eq(firms.id, actor.firmId));
      await db.insert(activityLog).values({
        firmId: actor.firmId,
        actorUserId: actor.userId,
        entityType: "firm",
        entityId: actor.firmId,
        action: "updated",
        changes,
      });

      // Clerk's org name is what invitation emails say ("{Firm} invited you").
      const shown = firmDisplayName(values);
      if (shown !== firmDisplayName(before)) {
        await clerk.renameOrg(actor.clerkOrgId, shown);
      }
    });
  } catch (err) {
    console.error("updateFirmProfile failed", err);
    return { ok: false, error: SAVE_FAILED_MESSAGE };
  }

  return { ok: true, data: { values: firmProfileForm(values) } };
}
