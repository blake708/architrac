import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { activityLog, firmRoles, phaseTemplateRoles, phaseTemplates, projectPhaseRoles } from "@/db/schema";
import { type TenantDb, withFirm } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import { mixHours } from "@/lib/calc/phase-edit";
import { mixSchema } from "@/lib/projects/form";
import { blendedBillRateCents } from "@/lib/calc/rates";
import { type ActionResult, SAVE_FAILED_MESSAGE, type SettingsActor, forbidden } from "@/server/settings/common";
import { loadRates } from "@/server/settings/rates";

// Role mixes (Blake, 2026-11-03): each phase's fee split by role; hours =
// share × fee ÷ the role's bill rate on the day of the edit. Only BILL rates
// leave the server (PMs may see them, decision #4); cost never does.

export type RoleRate = { id: string; name: string; billCents: number };

/** Billable roles with today's bill rate, plus the firm's blended bill rate. */
export async function billRates(db: TenantDb, firmId: string, today: string) {
  const view = await loadRates(db, firmId, today);
  const roles: RoleRate[] = view.roles.filter((r) => r.isBillable).map((r) => ({ id: r.id, name: r.name, billCents: r.billCents }));
  const blended = blendedBillRateCents(view.roles.map((r) => ({ billCents: r.billCents, costCents: r.costCents, people: r.people })));
  return { roles, blended };
}

export type MixInput = { firmRoleId: string; shareBp: number }[];

/** Active template mixes by template id. */
export async function templateMixes(db: TenantDb): Promise<Map<string, MixInput>> {
  const rows = await db
    .select({ templateId: phaseTemplateRoles.phaseTemplateId, firmRoleId: phaseTemplateRoles.firmRoleId, shareBp: phaseTemplateRoles.shareBp })
    .from(phaseTemplateRoles)
    .where(isNull(phaseTemplateRoles.archivedAt))
    .orderBy(asc(phaseTemplateRoles.sortOrder));
  const out = new Map<string, MixInput>();
  for (const r of rows) out.set(r.templateId, [...(out.get(r.templateId) ?? []), { firmRoleId: r.firmRoleId, shareBp: r.shareBp }]);
  return out;
}

/**
 * Replace a project phase's mix (old rows archived, never deleted), saving
 * today's rates and the hours they give. Returns the phase's total hours.
 */
export async function writePhaseMix(
  db: TenantDb,
  firmId: string,
  phaseId: string,
  feeCents: number,
  mix: MixInput,
  rates: ReadonlyMap<string, number>,
): Promise<number> {
  await db
    .update(projectPhaseRoles)
    .set({ archivedAt: new Date() })
    .where(and(eq(projectPhaseRoles.projectPhaseId, phaseId), isNull(projectPhaseRoles.archivedAt)));
  if (mix.length === 0) return 0;
  const calc = mixHours(
    feeCents,
    mix.map((m) => ({ roleId: m.firmRoleId, shareBp: m.shareBp, rateCents: rates.get(m.firmRoleId) ?? 0 })),
  );
  await db.insert(projectPhaseRoles).values(
    mix.map((m, i) => ({
      firmId,
      projectPhaseId: phaseId,
      firmRoleId: m.firmRoleId,
      shareBp: m.shareBp,
      rateCents: rates.get(m.firmRoleId) ?? 0,
      hours: String(calc.roles[i].hours),
      sortOrder: i,
    })),
  );
  return calc.total;
}

/** A phase's current mix (active rows), or [] when it has none. */
export async function phaseMix(db: TenantDb, phaseId: string): Promise<MixInput> {
  const rows = await db
    .select({ firmRoleId: projectPhaseRoles.firmRoleId, shareBp: projectPhaseRoles.shareBp })
    .from(projectPhaseRoles)
    .where(and(eq(projectPhaseRoles.projectPhaseId, phaseId), isNull(projectPhaseRoles.archivedAt)))
    .orderBy(asc(projectPhaseRoles.sortOrder));
  return rows;
}

// ---------- Settings: a template's default mix ----------

const templateMixInput = z.object({ templateId: z.uuid(), mix: mixSchema });

export async function saveTemplateMixCore(actor: SettingsActor, raw: unknown): Promise<ActionResult<string, { mix: MixInput }>> {
  if (!can(actor.member, "settings.edit")) return forbidden;
  const parsed = templateMixInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? SAVE_FAILED_MESSAGE };
  const { templateId, mix } = parsed.data;
  try {
    return await withFirm(actor.firmId, async (db) => {
      const [t] = await db
        .select({ id: phaseTemplates.id, isOptional: phaseTemplates.isOptional })
        .from(phaseTemplates)
        .where(and(eq(phaseTemplates.id, templateId), isNull(phaseTemplates.archivedAt)));
      if (!t) return { ok: false, error: "That phase no longer exists. Reload the page." } as const;
      if (mix.length) {
        const roles = await db
          .select({ id: firmRoles.id })
          .from(firmRoles)
          .where(and(inArray(firmRoles.id, mix.map((m) => m.firmRoleId)), isNull(firmRoles.archivedAt)));
        if (roles.length !== mix.length) return { ok: false, error: "A role in the mix no longer exists. Reload the page." } as const;
      }
      const before = (await templateMixes(db)).get(templateId) ?? [];
      await db
        .update(phaseTemplateRoles)
        .set({ archivedAt: new Date() })
        .where(and(eq(phaseTemplateRoles.phaseTemplateId, templateId), isNull(phaseTemplateRoles.archivedAt)));
      if (mix.length)
        await db
          .insert(phaseTemplateRoles)
          .values(mix.map((m, i) => ({ firmId: actor.firmId, phaseTemplateId: templateId, ...m, sortOrder: i })));
      await db.insert(activityLog).values({
        firmId: actor.firmId,
        actorUserId: actor.userId,
        entityType: "phase_template",
        entityId: templateId,
        action: "updated",
        changes: { roleMix: { before, after: mix } },
      });
      return { ok: true, data: { mix } } as const;
    });
  } catch (err) {
    console.error("saveTemplateMix failed", err);
    return { ok: false, error: SAVE_FAILED_MESSAGE };
  }
}
