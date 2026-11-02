import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import {
  activityLog,
  firmRoles,
  firmSettings,
  memberships,
  rates,
} from "@/db/schema";
import { type TenantDb, withFirm } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import { planRateChange, rateOn } from "@/lib/calc/rates";
import {
  OVERHEAD_MAX_PCT,
  RATE_MESSAGES,
  type RateHistoryRow,
  type RatesView,
  type RoleView,
  addRoleSchema,
  archiveBlockedMessage,
  dollarsToCents,
  earliestDateMessage,
  editRoleSchema,
  rateErrors,
  saveRatesSchema,
} from "@/lib/settings/rates";
import {
  type ActionResult,
  SAVE_FAILED_MESSAGE,
  type SettingsActor,
  forbidden,
  isUniqueViolation,
} from "./common";
import { STALE_MESSAGE } from "./phases";

// Settings → Roles & rates (settings-rates-phases spec, section B).
// Cost rates and overhead are owner/admin only (CLAUDE.md rule 4): every
// function here checks rates.view / rates.edit before reading anything.

type Tx = TenantDb;
type RateRow = typeof rates.$inferSelect;

/** Roles with today's rate, people count and rate history. */
export async function loadRates(
  db: Tx,
  firmId: string,
  today: string,
): Promise<RatesView> {
  const roleRows = await db
    .select()
    .from(firmRoles)
    .where(isNull(firmRoles.archivedAt))
    .orderBy(asc(firmRoles.sortOrder), asc(firmRoles.createdAt));
  const rateRows = await db
    .select()
    .from(rates)
    .where(sql`${rates.firmRoleId} is not null`)
    .orderBy(desc(rates.effectiveFrom));
  const counts = await db
    .select({ roleId: memberships.firmRoleId, n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(and(eq(memberships.active, true), isNull(memberships.archivedAt)))
    .groupBy(memberships.firmRoleId);
  const [settings] = await db
    .select()
    .from(firmSettings)
    .where(eq(firmSettings.firmId, firmId));

  const people = new Map(counts.map((c) => [c.roleId, c.n]));
  const roles: RoleView[] = roleRows.map((r) => {
    const mine = rateRows.filter((x) => x.firmRoleId === r.id);
    const shown = rateOn(mine, today) ?? mine[0] ?? null;
    const history: RateHistoryRow[] = mine.map((x) => ({
      effectiveFrom: x.effectiveFrom,
      effectiveTo: x.effectiveTo,
      billCents: x.billRateCents,
      costCents: x.costRateCents,
    }));
    return {
      id: r.id,
      name: r.name,
      description: r.description ?? "",
      isBillable: r.isBillable,
      people: people.get(r.id) ?? 0,
      billCents: shown?.billRateCents ?? 0,
      costCents: shown?.costRateCents ?? 0,
      effectiveFrom: shown?.effectiveFrom ?? null,
      history,
    };
  });
  return {
    roles,
    overheadBp: settings.overheadRateBp,
    includeOverheadDefault: settings.includeOverheadDefault,
    today,
  };
}

function logger(db: Tx, actor: SettingsActor) {
  return (
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
}

/** The role's open-ended rate row (the one a change splits). */
async function openRate(db: Tx, roleId: string): Promise<RateRow | null> {
  const [row] = await db
    .select()
    .from(rates)
    .where(and(eq(rates.firmRoleId, roleId), isNull(rates.effectiveTo)))
    .for("update");
  return row ?? null;
}

/**
 * Apply a role's new rate from `from` (rule 8). Same start date → update in
 * place; later → close the open row the day before and insert a new one.
 * Returns the earliest allowed date if `from` is too early.
 */
async function applyRate(
  db: Tx,
  actor: SettingsActor,
  roleId: string,
  billCents: number,
  costCents: number,
  from: string,
): Promise<{ ok: true } | { ok: false; earliest: string }> {
  const log = logger(db, actor);
  const current = await openRate(db, roleId);
  if (!current) {
    const [row] = await db
      .insert(rates)
      .values({
        firmId: actor.firmId,
        firmRoleId: roleId,
        billRateCents: billCents,
        costRateCents: costCents,
        effectiveFrom: from,
        createdBy: actor.userId,
      })
      .returning({ id: rates.id });
    await log("rate", row.id, "created", {
      firm_role_id: roleId,
      bill_rate_cents: billCents,
      cost_rate_cents: costCents,
      effective_from: from,
    });
    return { ok: true };
  }

  const plan = planRateChange(current, from);
  if (plan.kind === "reject") return { ok: false, earliest: plan.earliest };
  const amounts = {
    bill_rate_cents: { before: current.billRateCents, after: billCents },
    cost_rate_cents: { before: current.costRateCents, after: costCents },
  };
  if (plan.kind === "update") {
    await db
      .update(rates)
      .set({ billRateCents: billCents, costRateCents: costCents })
      .where(eq(rates.id, current.id));
    await log("rate", current.id, "updated", amounts);
    return { ok: true };
  }
  // Close first: the no-overlap rule checks each statement.
  await db
    .update(rates)
    .set({ effectiveTo: plan.closeCurrentOn })
    .where(eq(rates.id, current.id));
  const [row] = await db
    .insert(rates)
    .values({
      firmId: actor.firmId,
      firmRoleId: roleId,
      billRateCents: billCents,
      costRateCents: costCents,
      effectiveFrom: from,
      createdBy: actor.userId,
    })
    .returning({ id: rates.id });
  await log("rate", current.id, "updated", {
    effective_to: { before: null, after: plan.closeCurrentOn },
  });
  await log("rate", row.id, "created", {
    firm_role_id: roleId,
    effective_from: from,
    ...amounts,
  });
  return { ok: true };
}

export type SaveRatesResult = ActionResult<string, { view: RatesView }>;

/**
 * Save (Rates): changed role rates from one date, plus the overhead rate and
 * switch. All or nothing.
 */
export async function saveRatesCore(
  actor: SettingsActor,
  raw: unknown,
  today: string,
): Promise<SaveRatesResult> {
  if (!can(actor.member, "rates.edit")) return forbidden;
  const parsed = saveRatesSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: STALE_MESSAGE };
  const input = parsed.data;

  const fieldErrors: Record<string, string> = {};
  if (
    !Number.isInteger(input.overheadPct) ||
    input.overheadPct < 0 ||
    input.overheadPct > OVERHEAD_MAX_PCT
  )
    fieldErrors.overhead = RATE_MESSAGES.overhead;

  try {
    const outcome = await withFirm(actor.firmId, async (db) => {
      const view = await loadRates(db, actor.firmId, today);
      const roles = new Map(view.roles.map((r) => [r.id, r]));

      // Which roles actually changed, and are their numbers valid?
      const changed: { role: RoleView; bill: number; cost: number }[] = [];
      for (const r of input.roles) {
        const role = roles.get(r.id);
        if (!role) return { stale: true } as const;
        const billDollars = role.isBillable ? r.billDollars : 0;
        const errs = rateErrors(role.isBillable, billDollars, r.costDollars);
        if (errs.bill) fieldErrors[`roles.${r.id}.bill`] = errs.bill;
        if (errs.cost) fieldErrors[`roles.${r.id}.cost`] = errs.cost;
        const bill = dollarsToCents(billDollars);
        const cost = dollarsToCents(r.costDollars);
        if (bill !== role.billCents || cost !== role.costCents)
          changed.push({ role, bill, cost });
      }
      if (changed.length > 0 && !input.effectiveFrom)
        fieldErrors.effectiveFrom = RATE_MESSAGES.date;
      if (Object.keys(fieldErrors).length > 0)
        return { errors: fieldErrors } as const;

      for (const c of changed) {
        const result = await applyRate(
          db,
          actor,
          c.role.id,
          c.bill,
          c.cost,
          input.effectiveFrom!,
        );
        if (!result.ok) {
          // Undo everything written so far in this transaction.
          throw new DateTooEarly(
            earliestDateMessage(result.earliest, c.role.name),
          );
        }
      }

      const overheadBp = input.overheadPct * 100;
      if (
        overheadBp !== view.overheadBp ||
        input.includeOverheadDefault !== view.includeOverheadDefault
      ) {
        await db
          .update(firmSettings)
          .set({
            overheadRateBp: overheadBp,
            includeOverheadDefault: input.includeOverheadDefault,
          })
          .where(eq(firmSettings.firmId, actor.firmId));
        const changes: Record<string, unknown> = {};
        if (overheadBp !== view.overheadBp)
          changes.overhead_rate_bp = { before: view.overheadBp, after: overheadBp };
        if (input.includeOverheadDefault !== view.includeOverheadDefault)
          changes.include_overhead_default = {
            before: view.includeOverheadDefault,
            after: input.includeOverheadDefault,
          };
        await logger(db, actor)("firm_settings", actor.firmId, "updated", changes);
      }
      return { view: await loadRates(db, actor.firmId, today) } as const;
    });
    if ("stale" in outcome) return { ok: false, error: STALE_MESSAGE };
    if ("errors" in outcome)
      return {
        ok: false,
        error: RATE_MESSAGES.summary,
        fieldErrors: outcome.errors,
      };
    return { ok: true, data: { view: outcome.view } };
  } catch (err) {
    if (err instanceof DateTooEarly)
      return {
        ok: false,
        error: err.message,
        fieldErrors: { effectiveFrom: err.message },
      };
    console.error("saveRates failed", err);
    return { ok: false, error: SAVE_FAILED_MESSAGE };
  }
}

class DateTooEarly extends Error {}

export type RoleResult = ActionResult<string, { view: RatesView }>;

function zodErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const out: Record<string, string> = {};
  for (const i of issues) out[String(i.path[0] ?? "form")] ??= i.message;
  return out;
}

/** Add role: saves straight away with its first rate. */
export async function addRoleCore(
  actor: SettingsActor,
  raw: unknown,
  today: string,
): Promise<RoleResult> {
  if (!can(actor.member, "rates.edit")) return forbidden;
  const parsed = addRoleSchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, fieldErrors: zodErrors(parsed.error.issues) };
  const input = parsed.data;
  const billDollars = input.isBillable ? input.billDollars : 0;
  const errs = rateErrors(input.isBillable, billDollars, input.costDollars);
  if (errs.bill || errs.cost)
    return {
      ok: false,
      fieldErrors: {
        ...(errs.bill && { billDollars: errs.bill }),
        ...(errs.cost && { costDollars: errs.cost }),
      },
    };

  try {
    const view = await withFirm(actor.firmId, async (db) => {
      const [{ max }] = await db
        .select({ max: sql<number>`coalesce(max(${firmRoles.sortOrder}), 0)::int` })
        .from(firmRoles);
      const [role] = await db
        .insert(firmRoles)
        .values({
          firmId: actor.firmId,
          name: input.name,
          description: input.description || null,
          isBillable: input.isBillable,
          sortOrder: max + 1,
          createdBy: actor.userId,
        })
        .returning({ id: firmRoles.id });
      await logger(db, actor)("firm_role", role.id, "created", {
        name: input.name,
        is_billable: input.isBillable,
      });
      await applyRate(
        db,
        actor,
        role.id,
        dollarsToCents(billDollars),
        dollarsToCents(input.costDollars),
        input.effectiveFrom,
      );
      return loadRates(db, actor.firmId, today);
    });
    return { ok: true, data: { view } };
  } catch (err) {
    if (isUniqueViolation(err))
      return { ok: false, fieldErrors: { name: RATE_MESSAGES.roleNameTaken } };
    console.error("addRole failed", err);
    return { ok: false, error: SAVE_FAILED_MESSAGE };
  }
}

/**
 * Edit role: name, description, billable. Switching billable off sets the
 * bill rate to 0 from today; switching it on needs a bill rate from today.
 */
export async function editRoleCore(
  actor: SettingsActor,
  raw: unknown,
  today: string,
): Promise<RoleResult> {
  if (!can(actor.member, "rates.edit")) return forbidden;
  const parsed = editRoleSchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, fieldErrors: zodErrors(parsed.error.issues) };
  const input = parsed.data;

  try {
    const outcome = await withFirm(actor.firmId, async (db) => {
      const [before] = await db
        .select()
        .from(firmRoles)
        .where(and(eq(firmRoles.id, input.id), isNull(firmRoles.archivedAt)))
        .for("update");
      if (!before) return { stale: true } as const;

      const turningOn = input.isBillable && !before.isBillable;
      const turningOff = !input.isBillable && before.isBillable;
      if (turningOn) {
        const errs = rateErrors(true, input.billDollars ?? 0, null);
        if (errs.bill) return { errors: { billDollars: errs.bill } } as const;
      }

      const description = input.description || null;
      const changes: Record<string, unknown> = {};
      if (before.name !== input.name)
        changes.name = { before: before.name, after: input.name };
      if (before.description !== description)
        changes.description = { before: before.description, after: description };
      if (before.isBillable !== input.isBillable)
        changes.is_billable = { before: before.isBillable, after: input.isBillable };
      if (Object.keys(changes).length > 0) {
        await db
          .update(firmRoles)
          .set({ name: input.name, description, isBillable: input.isBillable })
          .where(eq(firmRoles.id, before.id));
        await logger(db, actor)("firm_role", before.id, "updated", changes);
      }

      if (turningOn || turningOff) {
        const current = await openRate(db, before.id);
        const bill = turningOn ? dollarsToCents(input.billDollars ?? 0) : 0;
        const cost = current?.costRateCents ?? 0;
        // From today, or from the open rate's start if that's later.
        const from =
          current && current.effectiveFrom > today ? current.effectiveFrom : today;
        await applyRate(db, actor, before.id, bill, cost, from);
      }
      return { view: await loadRates(db, actor.firmId, today) } as const;
    });
    if ("stale" in outcome) return { ok: false, error: STALE_MESSAGE };
    if ("errors" in outcome) return { ok: false, fieldErrors: outcome.errors };
    return { ok: true, data: { view: outcome.view } };
  } catch (err) {
    if (isUniqueViolation(err))
      return { ok: false, fieldErrors: { name: RATE_MESSAGES.roleNameTaken } };
    console.error("editRole failed", err);
    return { ok: false, error: SAVE_FAILED_MESSAGE };
  }
}

/** Archive role: only when no active person has it. */
export async function archiveRoleCore(
  actor: SettingsActor,
  roleId: unknown,
  today: string,
): Promise<RoleResult> {
  if (!can(actor.member, "rates.edit")) return forbidden;
  if (typeof roleId !== "string") return { ok: false, error: STALE_MESSAGE };

  try {
    const outcome = await withFirm(actor.firmId, async (db) => {
      const view = await loadRates(db, actor.firmId, today);
      const role = view.roles.find((r) => r.id === roleId);
      if (!role) return { stale: true } as const;
      if (role.people > 0)
        return { error: archiveBlockedMessage(role.people, role.name) } as const;
      await db
        .update(firmRoles)
        .set({ archivedAt: new Date() })
        .where(eq(firmRoles.id, role.id));
      await logger(db, actor)("firm_role", role.id, "archived", {
        name: role.name,
      });
      return { view: await loadRates(db, actor.firmId, today) } as const;
    });
    if ("stale" in outcome) return { ok: false, error: STALE_MESSAGE };
    if ("error" in outcome) return { ok: false, error: outcome.error };
    return { ok: true, data: { view: outcome.view } };
  } catch (err) {
    console.error("archiveRole failed", err);
    return { ok: false, error: SAVE_FAILED_MESSAGE };
  }
}
