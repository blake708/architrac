import { asc, eq } from "drizzle-orm";
import { activities, activityLog, overheadCategories } from "@/db/schema";
import { type TenantDb, withFirm } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import {
  type ListItem,
  TIME_LIST_MESSAGES,
  type TimeListsForm,
  timeListsSchema,
  validateTimeLists,
} from "@/lib/settings/time-lists";
import {
  type ActionResult,
  SAVE_FAILED_MESSAGE,
  type SettingsActor,
  forbidden,
} from "./common";
import { STALE_MESSAGE } from "./phases";

// Settings → Time & approvals → "Timesheet phases & activities"
// (settings-rates-phases spec, section C and rule 11). Nothing is deleted:
// removing sets active = false, and adding a name that was removed brings
// the same row back.

type Tx = TenantDb;
type Activity = typeof activities.$inferSelect;
type Category = typeof overheadCategories.$inferSelect;

export const PTO_CODE = "PTO";

/**
 * Hours logged to each overhead phase, for the "{hours} h are logged…"
 * question. Time entries arrive in milestone 1.6; until then this is empty
 * and removing a phase doesn't ask.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- reads time_entries from 1.6
export async function loggedHoursByCategory(db: Tx): Promise<Map<string, number>> {
  return new Map();
}

export async function loadTimeLists(db: Tx): Promise<TimeListsForm> {
  const cats = await db
    .select()
    .from(overheadCategories)
    .where(eq(overheadCategories.active, true))
    .orderBy(asc(overheadCategories.sortOrder), asc(overheadCategories.createdAt));
  const acts = await db
    .select()
    .from(activities)
    .where(eq(activities.active, true))
    .orderBy(asc(activities.sortOrder), asc(activities.createdAt));
  const hours = await loggedHoursByCategory(db);
  const item = (a: Activity): ListItem => ({ id: a.id, name: a.name });
  const pto = cats.find((c) => c.code === PTO_CODE);
  return {
    projectActivities: acts.filter((a) => a.appliesTo === "project").map(item),
    overheadPhases: cats
      .filter((c) => !c.isLeave)
      .map((c) => ({
        id: c.id,
        name: c.name,
        activities: acts
          .filter((a) => a.overheadCategoryId === c.id)
          .map(item),
        loggedHours: hours.get(c.id) ?? 0,
      })),
    leaveTypes: pto
      ? acts.filter((a) => a.overheadCategoryId === pto.id).map(item)
      : [],
  };
}

export type SaveTimeListsResult = ActionResult<string, { form: TimeListsForm }>;

class Stale extends Error {}
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export async function saveTimeListsCore(
  actor: SettingsActor,
  raw: unknown,
): Promise<SaveTimeListsResult> {
  if (!can(actor.member, "settings.edit")) return forbidden;
  const parsed = timeListsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: STALE_MESSAGE };
  const form = parsed.data;
  const errors = validateTimeLists(form);
  if (Object.keys(errors).length > 0)
    return { ok: false, error: TIME_LIST_MESSAGES.summary, fieldErrors: errors };

  try {
    const result = await withFirm(actor.firmId, async (db) => {
      const cats = await db.select().from(overheadCategories).for("update");
      const acts = await db.select().from(activities).for("update");
      const pto = cats.find((c) => c.code === PTO_CODE);
      if (!pto) throw new Stale();

      const log = (
        entityType: string,
        entityId: string,
        action: string,
        changes: Record<string, unknown>,
      ) =>
        db.insert(activityLog).values({
          firmId: actor.firmId,
          actorUserId: actor.userId,
          entityType,
          entityId,
          action,
          changes,
        });

      /** Make one activity list match `items`, in order. */
      async function syncActivities(
        scope: { appliesTo: "project" | "overhead"; categoryId: string | null },
        items: readonly ListItem[],
      ) {
        const pool = acts.filter(
          (a) =>
            a.appliesTo === scope.appliesTo &&
            a.overheadCategoryId === scope.categoryId,
        );
        const kept = new Set<string>();
        for (const [i, it] of items.entries()) {
          const sortOrder = i + 1;
          const name = it.name.trim();
          let row: Activity | undefined;
          if (it.id) {
            row = pool.find((a) => a.id === it.id && a.active);
            if (!row || kept.has(row.id)) throw new Stale();
          } else {
            // A removed activity with this name comes back (same id).
            row = pool.find((a) => !a.active && same(a.name, name));
          }
          if (row) {
            kept.add(row.id);
            if (!row.active || row.sortOrder !== sortOrder) {
              await db
                .update(activities)
                .set({ active: true, sortOrder })
                .where(eq(activities.id, row.id));
              if (!row.active)
                await log("activity", row.id, "updated", {
                  active: { before: false, after: true },
                });
            }
          } else {
            const [created] = await db
              .insert(activities)
              .values({
                firmId: actor.firmId,
                name,
                appliesTo: scope.appliesTo,
                overheadCategoryId: scope.categoryId,
                sortOrder,
                createdBy: actor.userId,
              })
              .returning({ id: activities.id });
            kept.add(created.id);
            await log("activity", created.id, "created", {
              name,
              applies_to: scope.appliesTo,
              overhead_category_id: scope.categoryId,
            });
          }
        }
        for (const a of pool) {
          if (a.active && !kept.has(a.id)) {
            await db
              .update(activities)
              .set({ active: false })
              .where(eq(activities.id, a.id));
            await log("activity", a.id, "archived", { name: a.name });
          }
        }
      }

      await syncActivities(
        { appliesTo: "project", categoryId: null },
        form.projectActivities,
      );
      await syncActivities(
        { appliesTo: "overhead", categoryId: pto.id },
        form.leaveTypes,
      );

      // Overhead phases (not leave).
      const phasePool = cats.filter((c) => !c.isLeave);
      const keptCats = new Set<string>();
      for (const [i, p] of form.overheadPhases.entries()) {
        const sortOrder = i + 1;
        const name = p.name.trim();
        let row: Category | undefined;
        if (p.id) {
          row = phasePool.find((c) => c.id === p.id && c.active);
          if (!row || keptCats.has(row.id)) throw new Stale();
        } else {
          row = phasePool.find((c) => !c.active && same(c.name, name));
        }
        let catId: string;
        if (row) {
          catId = row.id;
          const changes: Record<string, unknown> = {};
          if (row.name !== name) changes.name = { before: row.name, after: name };
          if (!row.active) changes.active = { before: false, after: true };
          if (Object.keys(changes).length > 0 || row.sortOrder !== sortOrder) {
            await db
              .update(overheadCategories)
              .set({ name, sortOrder, active: true })
              .where(eq(overheadCategories.id, row.id));
          }
          if (Object.keys(changes).length > 0)
            await log("overhead_category", row.id, "updated", changes);
        } else {
          const [created] = await db
            .insert(overheadCategories)
            .values({
              firmId: actor.firmId,
              name,
              isLeave: false,
              sortOrder,
              createdBy: actor.userId,
            })
            .returning({ id: overheadCategories.id });
          catId = created.id;
          await log("overhead_category", catId, "created", { name });
        }
        keptCats.add(catId);
        await syncActivities(
          { appliesTo: "overhead", categoryId: catId },
          p.activities,
        );
      }
      for (const c of phasePool) {
        if (c.active && !keptCats.has(c.id)) {
          await db
            .update(overheadCategories)
            .set({ active: false })
            .where(eq(overheadCategories.id, c.id));
          await log("overhead_category", c.id, "archived", { name: c.name });
        }
      }

      return loadTimeLists(db);
    });
    return { ok: true, data: { form: result } };
  } catch (err) {
    if (err instanceof Stale) return { ok: false, error: STALE_MESSAGE };
    console.error("saveTimeLists failed", err);
    return { ok: false, error: SAVE_FAILED_MESSAGE };
  }
}

