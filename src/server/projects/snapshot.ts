import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { memberships, projectPhaseRoles, projectPhases, projects, users } from "@/db/schema";
import type { TenantDb } from "@/db/tenant";
import { requireCan } from "@/lib/auth/permissions";
import type { FeeType, PhaseStatus } from "@/lib/calc/projects";
import { projectBilled } from "@/lib/calc/projects";
import {
  type SnapshotEntry,
  type SnapshotVariant,
  firmAverageCostRate,
  plannedRateFromRoles,
  snapshotVariant,
} from "@/lib/calc/snapshot";
import { todayIn } from "@/lib/format";
import { initials as initialsFrom } from "@/lib/initials";
import { loadRates } from "@/server/settings/rates";
import { invoiceFacts } from "./page";
import type { Viewer } from "./view";
import { costedHours } from "@/server/time/used";

// Project snapshot (release-2/project-snapshot.md, built in 1.5 C). Owner and
// admin only: it starts with requireCan("financials.view"), so a PM or staff
// call throws. Cost rates stay here; only per-person rate text and costs go
// out. Both variants (overhead off and on) are worked out so the switch is
// instant.

export type SnapshotPhaseRow = {
  id: string;
  code: string;
  name: string;
  status: PhaseStatus;
  feeType: FeeType;
  feeCents: number;
  budgetHours: number;
  billedCents: number;
};

export type ProjectSnapshot = {
  overheadBp: number;
  includeOverheadDefault: boolean;
  phases: SnapshotPhaseRow[];
  people: Record<string, { name: string; initials: string; title: string | null }>;
  off: SnapshotVariant;
  on: SnapshotVariant;
};

/**
 * Counted hours per phase, person and cost rate:
 * the frozen rate once approved, else the rate in force on the work date
 * (Rule 1). Drafts count too (decision #20).
 */
function snapshotEntries(db: TenantDb, projectId: string): Promise<(SnapshotEntry & { phaseId: string })[]> {
  return costedHours(db, projectId);
}

export async function loadProjectSnapshot(
  db: TenantDb,
  viewer: Viewer,
  projectId: string,
  firm: { id: string; timezone: string },
): Promise<ProjectSnapshot | null> {
  requireCan(viewer, "financials.view");
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return null;
  const [p] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.archivedAt)));
  if (!p) return null;

  const phaseRows = await db
    .select({
      id: projectPhases.id,
      code: projectPhases.code,
      name: projectPhases.name,
      status: projectPhases.status,
      feeType: projectPhases.feeType,
      feeCents: projectPhases.feeCents,
      budgetHours: projectPhases.budgetHours,
    })
    .from(projectPhases)
    .where(and(eq(projectPhases.projectId, p.id), isNull(projectPhases.archivedAt)))
    .orderBy(asc(projectPhases.sortOrder));
  const mix = phaseRows.length
    ? await db
        .select({ phaseId: projectPhaseRoles.projectPhaseId, firmRoleId: projectPhaseRoles.firmRoleId, hours: projectPhaseRoles.hours })
        .from(projectPhaseRoles)
        .where(and(inArray(projectPhaseRoles.projectPhaseId, phaseRows.map((x) => x.id)), isNull(projectPhaseRoles.archivedAt)))
    : [];

  const rates = await loadRates(db, firm.id, todayIn(firm.timezone));
  const costOf = new Map(rates.roles.map((r) => [r.id, r.costCents]));
  const firmAverage = firmAverageCostRate(rates.roles);
  const inv = await invoiceFacts(db, p.id);
  const entries = await snapshotEntries(db, p.id);

  const phases: SnapshotPhaseRow[] = phaseRows.map((x) => ({
    ...x,
    budgetHours: Number(x.budgetHours),
    billedCents: projectBilled([{ id: x.id, feeType: x.feeType }], inv.lines),
  }));
  const inputs = phases.map((x) => {
    // Planned cost per hour from the phase's roles, else the firm average.
    const fromRoles = plannedRateFromRoles(
      mix.filter((m) => m.phaseId === x.id).map((m) => ({ hours: Number(m.hours), costCents: costOf.get(m.firmRoleId) ?? 0 })),
    );
    return {
      id: x.id,
      status: x.status,
      feeCents: x.feeCents,
      budgetHours: x.budgetHours,
      billedCents: x.billedCents,
      plannedRateCents: fromRoles ?? firmAverage,
      plannedEstimated: fromRoles === null,
      entries: entries.filter((e) => e.phaseId === x.id).map(({ membershipId, hours, rateCents }) => ({ membershipId, hours, rateCents })),
    };
  });

  const ids = [...new Set(entries.map((e) => e.membershipId))];
  const who = ids.length
    ? await db
        .select({ id: memberships.id, title: memberships.title, firstName: users.firstName, lastName: users.lastName, email: users.email, initials: users.initials })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(inArray(memberships.id, ids))
    : [];
  const people: ProjectSnapshot["people"] = {};
  for (const w of who) {
    const name = `${w.firstName} ${w.lastName}`.trim() || w.email;
    people[w.id] = { name, initials: w.initials || initialsFrom(name), title: w.title };
  }

  return {
    overheadBp: rates.overheadBp,
    includeOverheadDefault: rates.includeOverheadDefault,
    phases,
    people,
    off: snapshotVariant(inputs, rates.overheadBp, false),
    on: snapshotVariant(inputs, rates.overheadBp, true),
  };
}
