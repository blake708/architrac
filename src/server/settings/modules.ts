import { eq } from "drizzle-orm";
import { z } from "zod";
import { activityLog, firmSettings } from "@/db/schema";
import { withFirm } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import { MODULE_KEYS, type ModuleKey, normalizeModules } from "@/lib/modules";
import {
  type ActionResult,
  SAVE_FAILED_MESSAGE,
  type SettingsActor,
  forbidden,
} from "./common";

const modulesSchema = z.array(z.enum(MODULE_KEYS)).max(MODULE_KEYS.length * 2);

export type UpdateModulesResult = ActionResult<never, { modules: ModuleKey[] }>;

/**
 * Save Settings → Modules & plan (settings-firm spec, "Save changes
 * (Modules)"). Stores the modules that are on, in card order.
 */
export async function updateModulesCore(
  actor: SettingsActor,
  raw: unknown,
): Promise<UpdateModulesResult> {
  if (!can(actor.member, "modules.manage")) return forbidden;

  const parsed = modulesSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Unknown module. Reload the page and try again.",
    };
  }
  const after = normalizeModules(parsed.data);

  try {
    await withFirm(actor.firmId, async (db) => {
      const [row] = await db
        .select({ modules: firmSettings.modulesEnabled })
        .from(firmSettings)
        .where(eq(firmSettings.firmId, actor.firmId))
        .for("update");
      const before = row.modules;
      if (
        before.length === after.length &&
        before.every((k, i) => k === after[i])
      )
        return;

      await db
        .update(firmSettings)
        .set({ modulesEnabled: after })
        .where(eq(firmSettings.firmId, actor.firmId));
      await db.insert(activityLog).values({
        firmId: actor.firmId,
        actorUserId: actor.userId,
        entityType: "firm_settings",
        entityId: actor.firmId,
        action: "updated",
        changes: { modules_enabled: { before, after } },
      });
    });
  } catch (err) {
    console.error("updateModules failed", err);
    return { ok: false, error: SAVE_FAILED_MESSAGE };
  }
  return { ok: true, data: { modules: after } };
}
