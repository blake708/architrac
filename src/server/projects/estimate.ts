import { and, eq, isNull, sql } from "drizzle-orm";
import { projectPhases, projectTypeBenchmarks, projects } from "@/db/schema";
import type { TenantDb } from "@/db/tenant";
import {
  type Benchmark,
  type PastProject,
  benchmarkKey,
  pastRanges,
  settingsRange,
} from "@/lib/calc/benchmarks";

// Ranges for New project's estimate (Blake, 2026-11-04). Past projects are
// grouped by type + scope and by type alone; a group is only sent when it
// has 3 or more usable projects, and only as a range, so no single
// project's fee reaches the page. Settings ranges fill the gaps.

export type BenchmarkSources = {
  past: Record<string, Benchmark>;
  settings: Record<string, Benchmark>;
};

export async function loadBenchmarkSources(
  db: TenantDb,
): Promise<BenchmarkSources> {
  const rows = await db
    .select({
      projectType: projects.projectType,
      scopeKind: projects.scopeKind,
      squareFeet: projects.squareFeet,
      constructionCents: projects.constructionCostCents,
      feeCents: sql<string>`coalesce(sum(${projectPhases.feeCents}), 0)`,
    })
    .from(projects)
    .leftJoin(
      projectPhases,
      and(
        eq(projectPhases.projectId, projects.id),
        isNull(projectPhases.archivedAt),
      ),
    )
    .where(
      and(isNull(projects.archivedAt), sql`${projects.status} <> 'pursuit'`),
    )
    .groupBy(projects.id);

  const groups = new Map<string, { scoped: boolean; list: PastProject[] }>();
  const add = (key: string, scoped: boolean, p: PastProject) => {
    const g = groups.get(key) ?? { scoped, list: [] };
    g.list.push(p);
    groups.set(key, g);
  };
  for (const r of rows) {
    const p = {
      squareFeet: r.squareFeet ?? 0,
      constructionCents: r.constructionCents ?? 0,
      feeCents: Number(r.feeCents),
    };
    add(benchmarkKey(r.projectType, null), false, p);
    if (r.scopeKind) add(benchmarkKey(r.projectType, r.scopeKind), true, p);
  }
  const past: Record<string, Benchmark> = {};
  for (const [key, g] of groups) {
    const r = pastRanges(g.list);
    if (r)
      past[key] = {
        costPerSfCents: r.costPerSfCents,
        feeBp: r.feeBp,
        source: { kind: "past", count: r.count, scoped: g.scoped },
      };
  }

  const settings: Record<string, Benchmark> = {};
  const typed = await db
    .select()
    .from(projectTypeBenchmarks)
    .where(isNull(projectTypeBenchmarks.archivedAt));
  for (const t of typed)
    settings[benchmarkKey(t.projectType, t.scopeKind)] = {
      costPerSfCents: settingsRange(t.costPerSfLowCents, t.costPerSfHighCents),
      feeBp: settingsRange(t.feeLowBp, t.feeHighBp),
      source: { kind: "settings", scoped: t.scopeKind !== null },
    };
  return { past, settings };
}
