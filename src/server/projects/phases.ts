import { and, eq, isNull, max } from "drizzle-orm";
import { z } from "zod";
import { activityLog, phaseTemplates, projectPhases, projects } from "@/db/schema";
import { type TenantDb, withFirm } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import { type PhaseFacts, phaseEditProblems } from "@/lib/calc/phase-edit";
import { hoursFromFee } from "@/lib/calc/projects";
import { formatMoney, todayIn } from "@/lib/format";
import { PROJECT_MESSAGES } from "@/lib/projects/form";
import { SAVE_FAILED_MESSAGE, type SettingsActor } from "@/server/settings/common";
import { mixSchema } from "@/lib/projects/form";
import { type MixInput, billRates, phaseMix, templateMixes, writePhaseMix } from "./roles";
import { phaseBilling } from "@/server/invoices/facts";
import { phasesWithTime } from "@/server/time/used";

// Editing a project's phases (project-detail spec, Actions: Edit phases, Add
// phase, Archive phase, Redistribute). Owners, admins and the project's own
// PM. Saves are all or nothing; every changed phase gets its own log row.

export const PHASE_MESSAGES = {
  stale: "Someone else changed these phases. Reload to see their changes.",
  fix: (n: number) => `${n} ${n === 1 ? "phase needs" : "phases need"} attention`,
  hasHistory: "Has time or invoices. Set status to Closed instead.",
} as const;

export type PhaseSaveResult =
  | { ok: true; data: { count: number } }
  | { ok: false; error?: string; rowErrors?: Record<number, Record<string, string>> };

const isoDate = z
  .string()
  .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v))
  .transform((v) => (v === "" ? null : v));

const editRow = z.object({
  id: z.uuid().nullable(),
  code: z.string().trim().max(12),
  name: z.string().trim().max(80),
  description: z
    .string()
    .trim()
    .max(500)
    .transform((v) => (v === "" ? null : v)),
  feeType: z.enum(["fixed", "hourly", "nte"]),
  feeCents: z.number().int().min(0).max(1e13),
  budgetHours: z.number().min(0).max(999_999.75),
  budgetHoursManual: z.boolean(),
  percentCompleteBp: z.number().int().min(0).max(10_000),
  status: z.enum(["upcoming", "current", "complete", "closed"]),
  startDate: isoDate,
  endDate: isoDate,
  isAdditionalService: z.boolean(),
  /** Undefined = keep the phase's mix (recalculated if the fee changed). */
  mix: mixSchema.optional(),
  /** Archive this phase. */
  archived: z.boolean(),
});

const updateInput = z.object({
  projectId: z.uuid(),
  /** When the page loaded the phases; later changes by anyone refuse the save. */
  loadedAt: z.iso.datetime(),
  rows: z.array(editRow).max(50),
});

async function editableProject(db: TenantDb, actor: SettingsActor, projectId: string) {
  const [p] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.archivedAt)))
    .for("update");
  if (!p) return null;
  const own = p.pmMembershipId === actor.member.membershipId || p.principalMembershipId === actor.member.membershipId;
  return can(actor.member, "projects.edit_fees", { isProjectManager: own }) ? p : null;
}

/** Billing facts per phase: billed, last billed %, any invoice lines. */
function billingFacts(db: TenantDb, phaseIds: string[]): Promise<Map<string, Omit<PhaseFacts, "feeType">>> {
  return phaseBilling(db, phaseIds);
}

/** Phases with time or invoice lines can't be archived. */
async function phasesWithHistory(db: TenantDb, phaseIds: string[]): Promise<Set<string>> {
  const [time, billing] = await Promise.all([phasesWithTime(db, phaseIds), phaseBilling(db, phaseIds)]);
  return new Set([...time, ...billing.keys()]);
}

function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const out: Record<string, { before: unknown; after: unknown }> = {};
  for (const [k, v] of Object.entries(after))
    if (JSON.stringify(before[k] ?? null) !== JSON.stringify(v ?? null)) out[k] = { before: before[k] ?? null, after: v };
  return out;
}

export async function updatePhasesCore(actor: SettingsActor, raw: unknown, timezone: string): Promise<PhaseSaveResult> {
  const parsed = updateInput.safeParse(raw);
  if (!parsed.success) {
    const rowErrors: Record<number, Record<string, string>> = {};
    for (const i of parsed.error.issues) {
      const [, idx, field] = i.path;
      if (typeof idx === "number") (rowErrors[idx] ??= {})[String(field ?? "row")] ??= i.message;
    }
    return Object.keys(rowErrors).length
      ? { ok: false, error: PHASE_MESSAGES.fix(Object.keys(rowErrors).length), rowErrors }
      : { ok: false, error: SAVE_FAILED_MESSAGE };
  }
  const { projectId, loadedAt, rows } = parsed.data;

  try {
    return await withFirm(actor.firmId, async (db): Promise<PhaseSaveResult> => {
      const project = await editableProject(db, actor, projectId);
      if (!project) return { ok: false, error: PROJECT_MESSAGES.editForbidden };

      const current = await db
        .select()
        .from(projectPhases)
        .where(and(eq(projectPhases.projectId, projectId), isNull(projectPhases.archivedAt)))
        .for("update");
      const byId = new Map(current.map((p) => [p.id, p]));
      const sentIds = new Set(rows.flatMap((r) => (r.id ? [r.id] : [])));
      // Someone saved after this page loaded, or added/removed a phase.
      if (
        current.some((p) => p.updatedAt > new Date(loadedAt)) ||
        current.some((p) => !sentIds.has(p.id)) ||
        [...sentIds].some((id) => !byId.has(id))
      )
        return { ok: false, error: PHASE_MESSAGES.stale };

      // Rule 5 checks on the phases that stay.
      const kept = rows.map((r, i) => ({ r, i })).filter(({ r }) => !r.archived);
      const billing = await billingFacts(db, current.map((p) => p.id));
      const facts = new Map<string, PhaseFacts>(
        current.map((p) => [
          p.id,
          { feeType: p.feeType, billedCents: 0, lastBilledPctBp: 0, hasInvoiceLines: false, ...billing.get(p.id) },
        ]),
      );
      const found = phaseEditProblems(
        kept.map(({ r }) => r),
        facts,
        (c) => formatMoney(c),
      );
      const rowErrors: Record<number, Record<string, string>> = {};
      for (const [k, v] of Object.entries(found)) rowErrors[kept[Number(k)].i] = v;
      const history = await phasesWithHistory(db, current.map((p) => p.id));
      rows.forEach((r, i) => {
        if (r.archived && r.id && history.has(r.id)) (rowErrors[i] ??= {}).archived = PHASE_MESSAGES.hasHistory;
      });
      if (Object.keys(rowErrors).length)
        return { ok: false, error: PHASE_MESSAGES.fix(Object.keys(rowErrors).length), rowErrors };

      const { roles } = await billRates(db, actor.firmId, todayIn(timezone));
      const rates = new Map(roles.map((r) => [r.id, r.billCents]));
      const log = (entityId: string, action: string, changes: Record<string, unknown>) =>
        db.insert(activityLog).values({ firmId: actor.firmId, actorUserId: actor.userId, entityType: "project_phase", entityId, action, changes });

      let count = 0;
      for (const [order, { r }] of kept.entries()) {
        const { id, mix } = r;
        // Only these columns can be changed from the page.
        const values = {
          code: r.code.trim(),
          name: r.name.trim(),
          description: r.description,
          feeType: r.feeType,
          feeCents: r.feeCents,
          budgetHours: r.budgetHours,
          budgetHoursManual: r.budgetHoursManual,
          percentCompleteBp: r.percentCompleteBp,
          status: r.status,
          startDate: r.startDate,
          endDate: r.endDate,
          isAdditionalService: r.isAdditionalService,
          sortOrder: order + 1,
        };
        if (!id) {
          if (values.feeType !== "fixed") values.percentCompleteBp = 0;
          const [row] = await db
            .insert(projectPhases)
            .values({ firmId: actor.firmId, projectId, ...values, budgetHours: String(values.budgetHours) })
            .returning({ id: projectPhases.id });
          if (mix?.length) {
            const total = await writePhaseMix(db, actor.firmId, row.id, values.feeCents, mix, rates);
            if (!values.budgetHoursManual) await db.update(projectPhases).set({ budgetHours: String(total) }).where(eq(projectPhases.id, row.id));
          }
          await log(row.id, "created", { code: values.code, feeCents: values.feeCents });
          count += 1;
          continue;
        }
        const before = byId.get(id)!;
        // % complete is only for fixed-fee phases; others keep theirs (rule 5).
        if (values.feeType !== "fixed") values.percentCompleteBp = before.percentCompleteBp;
        let budgetHours = values.budgetHours;
        // A new mix, or a fee change on a phase that has one: hours at today's rates.
        const existing: MixInput = mix ?? (values.feeCents !== before.feeCents ? await phaseMix(db, id) : []);
        if (mix !== undefined || existing.length) {
          const total = await writePhaseMix(db, actor.firmId, id, values.feeCents, existing, rates);
          if (!values.budgetHoursManual && existing.length) budgetHours = total;
        }
        const after = { ...values, budgetHours: String(budgetHours) };
        const changes = diff(
          { ...before, budgetHours: before.budgetHours, startDate: before.startDate, endDate: before.endDate },
          { ...after, budgetHours: Number(after.budgetHours).toFixed(2) },
        );
        if (mix !== undefined) changes.roleMix = { before: null, after: mix };
        if (Object.keys(changes).length) {
          await db.update(projectPhases).set(after).where(eq(projectPhases.id, id));
          await log(id, changes.status && Object.keys(changes).length === 1 ? "status_changed" : "updated", changes);
          count += 1;
        }
      }
      for (const r of rows.filter((x) => x.archived && x.id)) {
        await db.update(projectPhases).set({ archivedAt: new Date() }).where(eq(projectPhases.id, r.id!));
        await log(r.id!, "archived", { code: r.code });
        count += 1;
      }
      return { ok: true, data: { count } };
    });
  } catch (err) {
    console.error("updatePhases failed", err);
    return { ok: false, error: SAVE_FAILED_MESSAGE };
  }
}

// ---------- Add phase ----------

const addInput = z.object({
  projectId: z.uuid(),
  templateId: z.uuid().nullable(),
  code: z.string().trim().max(12),
  name: z.string().trim().max(80),
  description: z
    .string()
    .trim()
    .max(500)
    .transform((v) => (v === "" ? null : v)),
  feeType: z.enum(["fixed", "hourly", "nte"]),
  feeCents: z.number().int().min(0).max(1e13),
  /** Null = work it out from the fee (role mix, else blended bill rate). */
  budgetHours: z.number().min(0).max(999_999.75).nullable(),
  isAdditionalService: z.boolean(),
});

export async function addPhaseCore(actor: SettingsActor, raw: unknown, timezone: string): Promise<PhaseSaveResult> {
  const parsed = addInput.safeParse(raw);
  if (!parsed.success) return { ok: false, rowErrors: { 0: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])) } };
  const v = parsed.data;
  try {
    return await withFirm(actor.firmId, async (db): Promise<PhaseSaveResult> => {
      const project = await editableProject(db, actor, v.projectId);
      if (!project) return { ok: false, error: PROJECT_MESSAGES.editForbidden };
      const current = await db
        .select({ code: projectPhases.code })
        .from(projectPhases)
        .where(and(eq(projectPhases.projectId, v.projectId), isNull(projectPhases.archivedAt)));
      const row = {
        id: null,
        code: v.code,
        name: v.name,
        feeType: v.feeType,
        feeCents: v.feeCents,
        budgetHours: v.budgetHours ?? 0,
        percentCompleteBp: 0,
        status: "upcoming" as const,
        startDate: null,
        endDate: null,
      };
      // Existing codes first, the new phase last, so a clash is reported on it.
      const all = [...current.map((c) => ({ ...row, code: c.code, name: "x", feeCents: 1, feeType: "fixed" as const })), row];
      const mine = phaseEditProblems(all, new Map(), formatMoney)[all.length - 1];
      if (mine) return { ok: false, rowErrors: { 0: mine } };

      // From an optional template: its description (server copy) and default mix.
      let description = v.description;
      let mix: MixInput = [];
      if (v.templateId) {
        const [t] = await db
          .select({ description: phaseTemplates.description })
          .from(phaseTemplates)
          .where(and(eq(phaseTemplates.id, v.templateId), isNull(phaseTemplates.archivedAt)));
        if (t && description === null) description = t.description;
        mix = (await templateMixes(db)).get(v.templateId) ?? [];
      }
      const [{ top }] = await db
        .select({ top: max(projectPhases.sortOrder) })
        .from(projectPhases)
        .where(eq(projectPhases.projectId, v.projectId));
      const [created] = await db
        .insert(projectPhases)
        .values({
          firmId: actor.firmId,
          projectId: v.projectId,
          code: v.code,
          name: v.name,
          description,
          feeType: v.feeType,
          feeCents: v.feeCents,
          budgetHours: "0",
          budgetHoursManual: v.budgetHours !== null,
          isAdditionalService: v.isAdditionalService,
          sortOrder: (top ?? 0) + 1,
          status: "upcoming",
        })
        .returning({ id: projectPhases.id });

      const { roles, blended } = await billRates(db, actor.firmId, todayIn(timezone));
      let hours = v.budgetHours;
      if (mix.length) {
        const total = await writePhaseMix(db, actor.firmId, created.id, v.feeCents, mix, new Map(roles.map((r) => [r.id, r.billCents])));
        hours ??= total;
      }
      hours ??= v.feeType === "hourly" ? 0 : (hoursFromFee(v.feeCents, blended) ?? 0);
      await db.update(projectPhases).set({ budgetHours: String(hours) }).where(eq(projectPhases.id, created.id));
      await db.insert(activityLog).values({
        firmId: actor.firmId,
        actorUserId: actor.userId,
        entityType: "project_phase",
        entityId: created.id,
        action: "created",
        changes: { code: v.code, feeCents: v.feeCents, budgetHours: hours },
      });
      return { ok: true, data: { count: 1 } };
    });
  } catch (err) {
    console.error("addPhase failed", err);
    return { ok: false, error: SAVE_FAILED_MESSAGE };
  }
}
