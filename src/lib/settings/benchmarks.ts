import { z } from "zod";
import { SCOPE_KINDS, type ScopeKind } from "@/lib/projects/form";

// Settings → Phases → Project type ranges (Blake, 2026-11-04): per project
// type (and optionally scope), a construction cost per SF range and an
// architectural fee % range. New project uses them when the firm has fewer
// than 3 similar past projects.

export type BenchmarkRow = {
  id: string | null;
  projectType: string;
  scopeKind: ScopeKind | null;
  costPerSfLowCents: number;
  costPerSfHighCents: number;
  feeLowBp: number;
  feeHighBp: number;
};

export const BENCHMARK_MESSAGES = {
  type: "Enter a project type (up to 60 characters)",
  cost: "Enter a cost per SF over $0",
  costOrder: "High must be at least low",
  fee: "Use a % between 0.01 and 100",
  feeOrder: "High must be at least low",
  duplicate: "This type and scope already has a range",
  saved: "Project type ranges saved",
} as const;

const row = z
  .object({
    id: z.uuid().nullable(),
    projectType: z
      .string()
      .trim()
      .min(1, { error: BENCHMARK_MESSAGES.type })
      .max(60, { error: BENCHMARK_MESSAGES.type }),
    scopeKind: z.enum(SCOPE_KINDS).nullable(),
    costPerSfLowCents: z
      .number()
      .int()
      .positive({ error: BENCHMARK_MESSAGES.cost })
      .max(100_000_00),
    costPerSfHighCents: z
      .number()
      .int()
      .positive({ error: BENCHMARK_MESSAGES.cost })
      .max(100_000_00),
    feeLowBp: z
      .number()
      .int()
      .min(1, { error: BENCHMARK_MESSAGES.fee })
      .max(10_000, { error: BENCHMARK_MESSAGES.fee }),
    feeHighBp: z
      .number()
      .int()
      .min(1, { error: BENCHMARK_MESSAGES.fee })
      .max(10_000, { error: BENCHMARK_MESSAGES.fee }),
  })
  .superRefine((v, ctx) => {
    if (v.costPerSfHighCents < v.costPerSfLowCents)
      ctx.addIssue({
        code: "custom",
        path: ["costPerSfHighCents"],
        message: BENCHMARK_MESSAGES.costOrder,
      });
    if (v.feeHighBp < v.feeLowBp)
      ctx.addIssue({
        code: "custom",
        path: ["feeHighBp"],
        message: BENCHMARK_MESSAGES.feeOrder,
      });
  });

/** The whole list is saved at once; rows left out are archived. */
export const benchmarksSchema = z
  .object({ rows: z.array(row).max(200) })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.rows.forEach((r, i) => {
      const k = `${r.projectType.trim().toLowerCase()}|${r.scopeKind ?? ""}`;
      if (seen.has(k))
        ctx.addIssue({
          code: "custom",
          path: ["rows", i, "projectType"],
          message: BENCHMARK_MESSAGES.duplicate,
        });
      seen.add(k);
    });
  });
export type BenchmarksInput = z.input<typeof benchmarksSchema>;
