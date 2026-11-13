import { and, desc, inArray, isNull, or } from "drizzle-orm";
import { membershipPay, memberships, projectMembers, rates } from "@/db/schema";
import type { TenantDb } from "@/db/tenant";
import { type PayPeriod, type RateRow, resolveRate } from "@/lib/calc/pay";

// Everything that decides people's rates, loaded once (ADR 0008). Pay and
// cost are owner/admin only: callers that show them check that first.

type Person = { membershipId: string; firmRoleId: string | null };
type Rate = { billRateCents: number; costRateCents: number };

export type RateBook = {
  /** The rate for one person's hour on one date, on a project or not (null = none). */
  rateOf: (membershipId: string, firmRoleId: string | null, workDate: string, projectId?: string | null) => Rate | null;
  /** The role their time on this project counts as: their role there, else their own. */
  roleOf: (membershipId: string, firmRoleId: string | null, projectId?: string | null) => string | null;
};

/** Load the rate book for these people, and their roles on these projects. */
export async function loadRateBook(
  db: TenantDb,
  people: readonly Person[],
  projectIds: readonly (string | null)[] = [],
): Promise<RateBook> {
  const ids = [...new Set(people.map((p) => p.membershipId))];
  const projects = [...new Set(projectIds.filter((p): p is string => !!p))];
  if (!ids.length) return { rateOf: () => null, roleOf: (_m, role) => role };

  const [hours, pay, teamRows] = await Promise.all([
    db
      .select({ id: memberships.id, weekly: memberships.weeklyCapacityHours })
      .from(memberships)
      .where(inArray(memberships.id, ids)),
    db
      .select({
        membershipId: membershipPay.membershipId,
        payType: membershipPay.payType,
        amountCents: membershipPay.amountCents,
        burdenBp: membershipPay.burdenBp,
        effectiveFrom: membershipPay.effectiveFrom,
        effectiveTo: membershipPay.effectiveTo,
      })
      .from(membershipPay)
      .where(inArray(membershipPay.membershipId, ids))
      .orderBy(desc(membershipPay.effectiveFrom)),
    projects.length
      ? db
          .select({
            projectId: projectMembers.projectId,
            membershipId: projectMembers.membershipId,
            firmRoleId: projectMembers.firmRoleId,
            override: projectMembers.billRateOverrideCents,
          })
          .from(projectMembers)
          .where(
            and(
              inArray(projectMembers.projectId, projects),
              inArray(projectMembers.membershipId, ids),
              isNull(projectMembers.archivedAt),
            ),
          )
      : Promise.resolve([]),
  ]);

  const roleIds = [
    ...new Set([...people.map((p) => p.firmRoleId), ...teamRows.map((t) => t.firmRoleId)].filter((r): r is string => !!r)),
  ];
  // Latest start first, so the newest of overlapping periods wins.
  const rateRows: (RateRow & { membershipId: string | null; firmRoleId: string | null })[] = await db
    .select({
      membershipId: rates.membershipId,
      firmRoleId: rates.firmRoleId,
      effectiveFrom: rates.effectiveFrom,
      effectiveTo: rates.effectiveTo,
      billRateCents: rates.billRateCents,
      costRateCents: rates.costRateCents,
    })
    .from(rates)
    .where(roleIds.length ? or(inArray(rates.membershipId, ids), inArray(rates.firmRoleId, roleIds)) : inArray(rates.membershipId, ids))
    .orderBy(desc(rates.effectiveFrom));

  const weekly = new Map(hours.map((h) => [h.id, Number(h.weekly)]));
  const payOf = (m: string): PayPeriod[] => pay.filter((p) => p.membershipId === m);
  const roleRows = (role: string | null) => (role ? rateRows.filter((r) => r.firmRoleId === role) : []);
  const team = new Map(teamRows.map((t) => [`${t.projectId}|${t.membershipId}`, t]));
  const onTeam = (m: string, projectId?: string | null) => (projectId ? team.get(`${projectId}|${m}`) : undefined);

  return {
    rateOf(membershipId, firmRoleId, workDate, projectId) {
      const t = onTeam(membershipId, projectId);
      return resolveRate(
        {
          personRates: rateRows.filter((r) => r.membershipId === membershipId),
          roleRates: roleRows(firmRoleId),
          pay: payOf(membershipId),
          weeklyHours: weekly.get(membershipId) ?? 0,
          projectRoleRates: t?.firmRoleId ? roleRows(t.firmRoleId) : null,
          projectBillOverrideCents: t?.override ?? null,
        },
        workDate,
      );
    },
    roleOf(membershipId, firmRoleId, projectId) {
      return onTeam(membershipId, projectId)?.firmRoleId ?? firmRoleId;
    },
  };
}
