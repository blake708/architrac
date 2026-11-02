import { asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { activityLog, phaseTemplates } from "@/db/schema";
import { type TenantDb, withFirm } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import {
  PHASE_MESSAGES,
  type PhaseList,
  type PhaseRow,
  type PhasesForm,
  cleanPhaseRow,
  phasesFormSchema,
  validatePhases,
} from "@/lib/settings/phases";
import {
  type ActionResult,
  SAVE_FAILED_MESSAGE,
  type SettingsActor,
  forbidden,
} from "./common";

// Settings → Phases & fees (settings-rates-phases spec, section A).

export const STALE_MESSAGE =
  "This page is out of date. Reload it and make your changes again.";

/** The firm's phase templates as the form shows them. */
export async function loadPhases(db: TenantDb): Promise<PhasesForm> {
  const rows = await db
    .select()
    .from(phaseTemplates)
    .where(isNull(phaseTemplates.archivedAt))
    .orderBy(asc(phaseTemplates.sortOrder), asc(phaseTemplates.createdAt));
  const toRow = (r: (typeof rows)[number]): PhaseRow => ({
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description ?? "",
    pct: r.defaultFeeShareBp / 100,
    feeType: r.defaultFeeType,
  });
  return {
    defaults: rows.filter((r) => !r.isOptional).map(toRow),
    optional: rows.filter((r) => r.isOptional).map(toRow),
  };
}

export type SavePhasesResult = ActionResult<string, { form: PhasesForm }>;

type Stored = typeof phaseTemplates.$inferSelect;
const TRACKED = [
  "code",
  "name",
  "description",
  "defaultFeeType",
  "defaultFeeShareBp",
  "sortOrder",
] as const;

/**
 * Save both lists (all or nothing). Removed rows are archived, never deleted.
 * Template changes never touch existing projects' phases.
 */
export async function savePhasesCore(
  actor: SettingsActor,
  raw: unknown,
): Promise<SavePhasesResult> {
  if (!can(actor.member, "settings.edit")) return forbidden;

  const parsed = phasesFormSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: STALE_MESSAGE };
  const form = parsed.data;
  const errors = validatePhases(form);
  if (Object.keys(errors).length > 0) {
    return {
      ok: false,
      error: errors.total ?? errors.list ?? PHASE_MESSAGES.summary,
      fieldErrors: errors,
    };
  }

  try {
    const outcome = await withFirm(actor.firmId, async (db) => {
      const existing = await db
        .select()
        .from(phaseTemplates)
        .where(isNull(phaseTemplates.archivedAt))
        .for("update");
      const byId = new Map(existing.map((r) => [r.id, r]));

      // Every row sent back must be one of ours, in the list it came from.
      const incoming: { row: PhaseRow; list: PhaseList; sortOrder: number }[] =
        [];
      for (const list of ["defaults", "optional"] as const) {
        form[list].forEach((row, i) =>
          incoming.push({ row, list, sortOrder: i + 1 }),
        );
      }
      const keptIds = new Set<string>();
      for (const { row, list } of incoming) {
        if (row.id === null) continue;
        const stored = byId.get(row.id);
        if (
          !stored ||
          keptIds.has(row.id) ||
          stored.isOptional !== (list === "optional")
        )
          return "stale" as const;
        keptIds.add(row.id);
      }

      const log = (
        entityId: string,
        action: string,
        changes: Record<string, unknown>,
      ) =>
        db.insert(activityLog).values({
          firmId: actor.firmId,
          actorUserId: actor.userId,
          entityType: "phase_template",
          entityId,
          action,
          changes,
        });

      // 1. Archive removed rows first, so their codes and names are free.
      const removed = existing.filter((r) => !keptIds.has(r.id));
      if (removed.length > 0) {
        await db
          .update(phaseTemplates)
          .set({ archivedAt: new Date() })
          .where(
            inArray(
              phaseTemplates.id,
              removed.map((r) => r.id),
            ),
          );
        for (const r of removed)
          await log(r.id, "archived", { code: r.code, name: r.name });
      }

      // 2. Work out which kept rows changed.
      const updates: { stored: Stored; values: ReturnType<typeof cleanPhaseRow> & { sortOrder: number } }[] = [];
      for (const { row, list, sortOrder } of incoming) {
        if (row.id === null) continue;
        const stored = byId.get(row.id)!;
        const values = { ...cleanPhaseRow(row, list), sortOrder };
        if (TRACKED.some((k) => stored[k] !== values[k]))
          updates.push({ stored, values });
      }

      // 3. Renames can swap codes between rows (SD ↔ DD), which would trip
      //    the unique index mid-way. Park changed codes/names on a
      //    placeholder first, then write the real values.
      const renamed = updates.filter(
        (u) =>
          u.stored.code !== u.values.code || u.stored.name !== u.values.name,
      );
      if (renamed.length > 0) {
        await db
          .update(phaseTemplates)
          .set({
            code: sql`'~' || ${phaseTemplates.id}::text`,
            name: sql`'~' || ${phaseTemplates.id}::text`,
          })
          .where(
            inArray(
              phaseTemplates.id,
              renamed.map((u) => u.stored.id),
            ),
          );
      }
      for (const { stored, values } of updates) {
        await db
          .update(phaseTemplates)
          .set(values)
          .where(eq(phaseTemplates.id, stored.id));
        const changes: Record<string, { before: unknown; after: unknown }> =
          {};
        for (const k of TRACKED)
          if (stored[k] !== values[k])
            changes[k] = { before: stored[k], after: values[k] };
        await log(stored.id, "updated", changes);
      }

      // 4. New rows.
      for (const { row, list, sortOrder } of incoming) {
        if (row.id !== null) continue;
        const values = { ...cleanPhaseRow(row, list), sortOrder };
        const [created] = await db
          .insert(phaseTemplates)
          .values({ ...values, firmId: actor.firmId, createdBy: actor.userId })
          .returning({ id: phaseTemplates.id });
        await log(created.id, "created", values);
      }

      return loadPhases(db);
    });
    if (outcome === "stale") return { ok: false, error: STALE_MESSAGE };
    return { ok: true, data: { form: outcome } };
  } catch (err) {
    console.error("savePhases failed", err);
    return { ok: false, error: SAVE_FAILED_MESSAGE };
  }
}

