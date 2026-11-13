import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { memberships, timeEntries, timesheets } from "@/db/schema";
import type { TenantDb } from "@/db/tenant";
import { loadRateBook } from "./rate-book";

// Logged time, for the screens that read it (project page, projects list,
// snapshot, Settings). Every non-archived entry counts, drafts included
// (decision #20, Blake, 2026-11-05).

const live = isNull(timeEntries.archivedAt);
const sumHours = sql<string>`sum(${timeEntries.hours})`;

/** Hours per phase and person on one project. */
export async function hoursByPhaseAndPerson(db: TenantDb, projectId: string) {
  const rows = await db
    .select({ phaseId: timeEntries.projectPhaseId, membershipId: timesheets.membershipId, hours: sumHours })
    .from(timeEntries)
    .innerJoin(timesheets, eq(timesheets.id, timeEntries.timesheetId))
    .where(and(eq(timeEntries.projectId, projectId), isNotNull(timeEntries.projectPhaseId), live))
    .groupBy(timeEntries.projectPhaseId, timesheets.membershipId);
  return rows.map((r) => ({ phaseId: r.phaseId!, membershipId: r.membershipId, hours: Number(r.hours) }));
}

/** Hours per phase across several projects. */
export async function hoursByPhase(db: TenantDb, projectIds: string[]): Promise<Map<string, number>> {
  if (!projectIds.length) return new Map();
  const rows = await db
    .select({ phaseId: timeEntries.projectPhaseId, hours: sumHours })
    .from(timeEntries)
    .where(and(inArray(timeEntries.projectId, projectIds), isNotNull(timeEntries.projectPhaseId), live))
    .groupBy(timeEntries.projectPhaseId);
  return new Map(rows.map((r) => [r.phaseId!, Number(r.hours)]));
}

/** Phases (of these) that have any time logged. */
export async function phasesWithTime(db: TenantDb, phaseIds: string[]): Promise<Set<string>> {
  if (!phaseIds.length) return new Set();
  const rows = await db
    .selectDistinct({ phaseId: timeEntries.projectPhaseId })
    .from(timeEntries)
    .where(and(inArray(timeEntries.projectPhaseId, phaseIds), live));
  return new Set(rows.map((r) => r.phaseId!));
}

/** Hours per overhead or leave category. */
export async function hoursByCategory(db: TenantDb): Promise<Map<string, number>> {
  const rows = await db
    .select({ categoryId: timeEntries.overheadCategoryId, hours: sumHours })
    .from(timeEntries)
    .where(and(isNotNull(timeEntries.overheadCategoryId), live))
    .groupBy(timeEntries.overheadCategoryId);
  return new Map(rows.map((r) => [r.categoryId!, Number(r.hours)]));
}

/**
 * Hours per phase, person and cost rate on one project, for the snapshot:
 * the rate frozen at approval, else the rate book's cost on the work date
 * (their pay, else their role; ADR 0008). Null = no rate (counts hours, no cost).
 * Owner/admin only: callers check financials.view first.
 */
export async function costedHours(db: TenantDb, projectId: string) {
  const rows = await db
    .select({
      phaseId: timeEntries.projectPhaseId,
      membershipId: timesheets.membershipId,
      firmRoleId: memberships.firmRoleId,
      workDate: timeEntries.workDate,
      hours: timeEntries.hours,
      frozen: timeEntries.costRateCents,
    })
    .from(timeEntries)
    .innerJoin(timesheets, eq(timesheets.id, timeEntries.timesheetId))
    .innerJoin(memberships, eq(memberships.id, timesheets.membershipId))
    .where(and(eq(timeEntries.projectId, projectId), isNotNull(timeEntries.projectPhaseId), live));
  if (!rows.length) return [];
  const { rateOf } = await loadRateBook(db, rows, [projectId]);
  const grouped = new Map<string, { phaseId: string; membershipId: string; rateCents: number | null; hours: number }>();
  for (const r of rows) {
    const rateCents =
r.frozen ?? rateOf(r.membershipId, r.firmRoleId, r.workDate, projectId)?.costRateCents ?? null;
    const key = `${r.phaseId}|${r.membershipId}|${rateCents}`;
    const g = grouped.get(key) ?? { phaseId: r.phaseId!, membershipId: r.membershipId, rateCents, hours: 0 };
    g.hours += Number(r.hours);
    grouped.set(key, g);
  }
  return [...grouped.values()];
}
