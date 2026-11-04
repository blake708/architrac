import { asc, eq, inArray, isNull } from "drizzle-orm";
import { activityLog, projectTypeBenchmarks } from "@/db/schema";
import { type TenantDb, withFirm } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import {
  BENCHMARK_MESSAGES,
  type BenchmarkRow,
  benchmarksSchema,
} from "@/lib/settings/benchmarks";
import {
  type ActionResult,
  SAVE_FAILED_MESSAGE,
  type SettingsActor,
  forbidden,
  isUniqueViolation,
} from "./common";
import { STALE_MESSAGE } from "./phases";

// Settings → Phases → Project type ranges (Blake, 2026-11-04). Owner/admin.
// The list is saved as a whole: new rows are added, changed rows updated,
// rows left out archived (never deleted). Every change goes to activity_log.

export async function loadBenchmarks(db: TenantDb): Promise<BenchmarkRow[]> {
  const rows = await db
    .select()
    .from(projectTypeBenchmarks)
    .where(isNull(projectTypeBenchmarks.archivedAt))
    .orderBy(
      asc(projectTypeBenchmarks.projectType),
      asc(projectTypeBenchmarks.scopeKind),
    );
  return rows.map((r) => ({
    id: r.id,
    projectType: r.projectType,
    scopeKind: r.scopeKind,
    costPerSfLowCents: r.costPerSfLowCents,
    costPerSfHighCents: r.costPerSfHighCents,
    feeLowBp: r.feeLowBp,
    feeHighBp: r.feeHighBp,
  }));
}

const FIELDS = [
  "projectType",
  "scopeKind",
  "costPerSfLowCents",
  "costPerSfHighCents",
  "feeLowBp",
  "feeHighBp",
] as const;

export type SaveBenchmarksResult = ActionResult<
  string,
  { rows: BenchmarkRow[] }
>;

export async function saveBenchmarksCore(
  actor: SettingsActor,
  raw: unknown,
): Promise<SaveBenchmarksResult> {
  if (!can(actor.member, "settings.edit")) return forbidden;
  const parsed = benchmarksSchema.safeParse(raw);
  if (!parsed.success) {
    // Errors by row: "rows.2.feeHighBp".
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues)
      fieldErrors[i.path.join(".")] ??= i.message;
    return { ok: false, error: "Fix the ranges marked in red.", fieldErrors };
  }
  const incoming = parsed.data.rows;

  try {
    const outcome = await withFirm(actor.firmId, async (db) => {
      const existing = await db
        .select()
        .from(projectTypeBenchmarks)
        .where(isNull(projectTypeBenchmarks.archivedAt))
        .for("update");
      const byId = new Map(existing.map((r) => [r.id, r]));
      if (incoming.some((r) => r.id !== null && !byId.has(r.id)))
        return "stale" as const;
      const log = (
        entityId: string,
        action: string,
        changes: Record<string, unknown>,
      ) =>
        db.insert(activityLog).values({
          firmId: actor.firmId,
          actorUserId: actor.userId,
          entityType: "project_type_benchmark",
          entityId,
          action,
          changes,
        });

      // Archive removed rows first, so their type and scope are free again.
      const kept = new Set(incoming.flatMap((r) => (r.id ? [r.id] : [])));
      const removed = existing.filter((r) => !kept.has(r.id));
      if (removed.length) {
        await db
          .update(projectTypeBenchmarks)
          .set({ archivedAt: new Date() })
          .where(
            inArray(
              projectTypeBenchmarks.id,
              removed.map((r) => r.id),
            ),
          );
        for (const r of removed)
          await log(r.id, "archived", {
            projectType: r.projectType,
            scopeKind: r.scopeKind,
          });
      }

      for (const r of incoming) {
        const values = {
          projectType: r.projectType.trim(),
          scopeKind: r.scopeKind,
          costPerSfLowCents: r.costPerSfLowCents,
          costPerSfHighCents: r.costPerSfHighCents,
          feeLowBp: r.feeLowBp,
          feeHighBp: r.feeHighBp,
        };
        if (r.id) {
          const before = byId.get(r.id)!;
          const changes: Record<string, { before: unknown; after: unknown }> =
            {};
          for (const f of FIELDS)
            if (before[f] !== values[f])
              changes[f] = { before: before[f], after: values[f] };
          if (Object.keys(changes).length) {
            await db
              .update(projectTypeBenchmarks)
              .set({ ...values, updatedAt: new Date() })
              .where(eq(projectTypeBenchmarks.id, r.id));
            await log(r.id, "updated", changes);
          }
        } else {
          const [row] = await db
            .insert(projectTypeBenchmarks)
            .values({
              firmId: actor.firmId,
              ...values,
              createdBy: actor.userId,
            })
            .returning({ id: projectTypeBenchmarks.id });
          await log(row.id, "created", values);
        }
      }
      return loadBenchmarks(db);
    });
    if (outcome === "stale") return { ok: false, error: STALE_MESSAGE };
    return { ok: true, data: { rows: outcome } };
  } catch (err) {
    if (isUniqueViolation(err))
      return { ok: false, error: BENCHMARK_MESSAGES.duplicate };
    console.error("saveBenchmarks failed", err);
    return { ok: false, error: SAVE_FAILED_MESSAGE };
  }
}
