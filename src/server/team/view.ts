import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import {
  firmRoles,
  invitations,
  membershipPay,
  memberships,
  rates,
  teams,
  users,
} from "@/db/schema";
import type { TenantDb } from "@/db/tenant";
import { type AppRole, can } from "@/lib/auth/permissions";
import { hourlyCostCents, resolveRate } from "@/lib/calc/pay";
import { avgMultiplierHundredths, lookupRate } from "@/lib/calc/rates";
import {
  type UtilizationView,
  utilizationView,
  utilizationWindow,
} from "@/lib/calc/utilization";
import type { PayHistoryRow } from "@/lib/team/pay";
import type { EmploymentType } from "@/lib/team/profile";

// Team page data (team spec, Data shown and business rules 1–12).
// Rates, cost and multiplier are only included for owners/admins (rule 12):
// for everyone else those fields are left out here, on the server.

export type AccessPill =
  | "Invited"
  | "Owner"
  | "Admin"
  | "Team leader"
  | "Project manager"
  | "Member";

export type PersonRow = {
  /** membership id, or invitation id for someone invited. */
  id: string;
  kind: "member" | "invited";
  firstName: string;
  lastName: string;
  initials: string;
  avatarUrl: string | null;
  email: string;
  title: string | null;
  appRole: AppRole;
  firmRoleId: string | null;
  roleName: string | null;
  /**
   * Owner/admin only. Null = no rate set. Cost comes from their pay when
   * it's entered, else their role's cost rate (ADR 0008).
   */
  rate?: { billCents: number; costCents: number } | null;
  /** Owner/admin only: pay history, newest first. */
  pay?: PayHistoryRow[];
  teamId: string | null;
  teamName: string | null;
  leadsTeam: boolean;
  /** Leader of their team, for "Leader · KL". */
  leaderInitials: string | null;
  weeklyHours: number;
  targetBp: number | null;
  employmentType: EmploymentType;
  /** Missing when this viewer may not see it (staff see only their own). */
  utilization?: UtilizationView;
  access: AccessPill;
  active: boolean;
  phone: string | null;
  licenseNote: string | null;
  startDate: string | null;
  isPrincipal: boolean;
};

export type TeamCard = {
  id: string;
  name: string;
  leaderMembershipId: string | null;
  members: string[];
  capacityHours: number;
};

export type TeamView = {
  people: PersonRow[];
  teams: TeamCard[];
  kpis: {
    people: number;
    invited: number;
    teams: number;
    /** Owner/admin only. */
    billableStaff?: number;
    billableCapacityHours?: number;
    avgMultiplierHundredths?: number | null;
  };
  /** The viewer's own membership id. */
  viewerId: string;
  canManage: boolean;
  /** Billing roles for the dialogs (owner/admin only). */
  roles: { id: string; name: string }[];
  /** Today in the firm's time zone, "YYYY-MM-DD". */
  today: string;
};

/**
 * Billable hours per membership in the utilization window. Time entries
 * arrive in milestone 1.6; until then everyone has 0 (spec: show "0%").
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- reads time_entries from 1.6
export async function billableHoursByMembership(db: TenantDb, window: { from: string; to: string }): Promise<Map<string, number>> {
  return new Map();
}

function accessPill(appRole: AppRole, leadsTeam: boolean): AccessPill {
  if (appRole === "owner") return "Owner";
  if (appRole === "admin") return "Admin";
  if (leadsTeam) return "Team leader";
  if (appRole === "project_manager") return "Project manager";
  return "Member";
}

const initialsOf = (first: string, last: string, fallback: string) =>
  ((first[0] ?? "") + (last[0] ?? "")).toUpperCase() ||
  fallback.slice(0, 2).toUpperCase();

export async function loadTeam(
  db: TenantDb,
  viewer: { membershipId: string; appRole: AppRole; active: boolean },
  opts: { today: string; weekStartsOn: number; showInactive?: boolean },
): Promise<TeamView> {
  const seesRates = can(viewer, "rates.view");
  const canManage = can(viewer, "users.manage");

  const teamRows = await db
    .select()
    .from(teams)
    .where(isNull(teams.archivedAt))
    .orderBy(asc(teams.sortOrder), asc(teams.name));
  const roleRows = await db
    .select({ id: firmRoles.id, name: firmRoles.name })
    .from(firmRoles)
    .where(isNull(firmRoles.archivedAt))
    .orderBy(asc(firmRoles.sortOrder));
  const memberRows = await db
    .select({
      m: memberships,
      firstName: users.firstName,
      lastName: users.lastName,
      initials: users.initials,
      avatarUrl: users.avatarUrl,
      email: users.email,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        isNull(memberships.archivedAt),
        opts.showInactive ? undefined : eq(memberships.active, true),
      ),
    );
  const inviteRows = await db
    .select()
    .from(invitations)
    .where(eq(invitations.status, "pending"));
  // All role names (archived too), so a person on an archived role still shows it.
  const allRoleNames = new Map(
    (await db.select({ id: firmRoles.id, name: firmRoles.name }).from(firmRoles)).map(
      (r) => [r.id, r.name],
    ),
  );
  // Rates are only read for owners/admins (rule 12).
  const rateRows = seesRates
    ? await db.select().from(rates).where(isNotNull(rates.firmRoleId))
    : [];
  const personRateRows = seesRates
    ? await db.select().from(rates).where(isNotNull(rates.membershipId))
    : [];
  const payRows = seesRates
    ? await db.select().from(membershipPay).orderBy(desc(membershipPay.effectiveFrom))
    : [];

  const window = utilizationWindow(opts.today, opts.weekStartsOn);
  const hours = await billableHoursByMembership(db, window);

  const teamById = new Map(teamRows.map((t) => [t.id, t]));
  const memberById = new Map(memberRows.map((r) => [r.m.id, r]));
  const leaderInitials = (teamId: string | null) => {
    const leaderId = teamId ? teamById.get(teamId)?.leaderMembershipId : null;
    const leader = leaderId ? memberById.get(leaderId) : undefined;
    return leader
      ? initialsOf(leader.firstName, leader.lastName, leader.email)
      : null;
  };
  const leaders = new Set(
    teamRows.map((t) => t.leaderMembershipId).filter((x): x is string => !!x),
  );

  const people: PersonRow[] = memberRows.map((r) => {
    const m = r.m;
    const team = m.teamId ? teamById.get(m.teamId) : undefined;
    const leadsTeam = leaders.has(m.id);
    const weeklyHours = Number(m.weeklyCapacityHours);
    const row: PersonRow = {
      id: m.id,
      kind: "member",
      firstName: r.firstName,
      lastName: r.lastName,
      initials: r.initials || initialsOf(r.firstName, r.lastName, r.email),
      avatarUrl: r.avatarUrl,
      email: r.email,
      title: m.title,
      appRole: m.appRole,
      firmRoleId: m.firmRoleId,
      roleName: m.firmRoleId ? (allRoleNames.get(m.firmRoleId) ?? null) : null,
      teamId: team ? m.teamId : null,
      teamName: team?.name ?? null,
      leadsTeam,
      leaderInitials: leaderInitials(team ? m.teamId : null),
      weeklyHours,
      targetBp: m.targetUtilizationBp,
      employmentType: m.employmentType,
      access: accessPill(m.appRole, leadsTeam),
      active: m.active,
      phone: m.phone,
      licenseNote: m.licenseNote,
      startDate: m.startDate,
      isPrincipal: m.isPrincipal,
    };
    // Staff see only their own utilization (rule 12).
    if (viewer.appRole !== "staff" || m.id === viewer.membershipId) {
      row.utilization = utilizationView(
        hours.get(m.id) ?? 0,
        weeklyHours,
        m.targetUtilizationBp,
      );
    }
    if (seesRates) {
      const pay = payRows.filter((x) => x.membershipId === m.id);
      const rate = resolveRate(
        {
          personRates: personRateRows.filter((x) => x.membershipId === m.id),
          roleRates: rateRows.filter((x) => x.firmRoleId === m.firmRoleId),
          pay,
          weeklyHours,
        },
        opts.today,
      );
      row.rate = rate
        ? { billCents: rate.billRateCents, costCents: rate.costRateCents }
        : null;
      row.pay = pay.map((x) => ({
        payType: x.payType,
        amountCents: x.amountCents,
        burdenBp: x.burdenBp,
        effectiveFrom: x.effectiveFrom,
        effectiveTo: x.effectiveTo,
        hourlyCostCents: hourlyCostCents(x, weeklyHours),
      }));
    }
    return row;
  });

  for (const inv of inviteRows) {
    const team = inv.teamId ? teamById.get(inv.teamId) : undefined;
    const first = inv.firstName ?? "";
    const last = inv.lastName ?? "";
    const weeklyHours = Number(inv.weeklyCapacityHours ?? 40);
    const row: PersonRow = {
      id: inv.id,
      kind: "invited",
      firstName: first || inv.email,
      lastName: last,
      initials: initialsOf(first, last, inv.email),
      avatarUrl: null,
      email: inv.email,
      title: inv.title,
      appRole: inv.appRole,
      firmRoleId: inv.firmRoleId,
      roleName: inv.firmRoleId ? (allRoleNames.get(inv.firmRoleId) ?? null) : null,
      teamId: team ? inv.teamId : null,
      teamName: team?.name ?? null,
      leadsTeam: false,
      leaderInitials: leaderInitials(team ? inv.teamId : null),
      weeklyHours,
      targetBp: inv.targetUtilizationBp,
      employmentType: inv.employmentType ?? "full_time",
      access: "Invited",
      active: true,
      phone: null,
      licenseNote: null,
      startDate: null,
      isPrincipal: false,
    };
    if (viewer.appRole !== "staff") row.utilization = { kind: "none" };
    if (seesRates) {
      const rate = lookupRate(
        [],
        rateRows.filter((x) => x.firmRoleId === inv.firmRoleId),
        opts.today,
      );
      row.rate = rate
        ? { billCents: rate.billRateCents, costCents: rate.costRateCents }
        : null;
    }
    people.push(row);
  }

  // Rule 1: team order, leader first, then last name; no team last.
  const teamOrder = new Map(teamRows.map((t, i) => [t.id, i]));
  people.sort((a, b) => {
    const ta = a.teamId ? (teamOrder.get(a.teamId) ?? 999) : 1000;
    const tb = b.teamId ? (teamOrder.get(b.teamId) ?? 999) : 1000;
    if (ta !== tb) return ta - tb;
    if (a.leadsTeam !== b.leadsTeam) return a.leadsTeam ? -1 : 1;
    return (
      a.lastName.localeCompare(b.lastName) ||
      a.firstName.localeCompare(b.firstName)
    );
  });

  const activeMembers = people.filter((p) => p.kind === "member" && p.active);
  const cards: TeamCard[] = teamRows.map((t) => {
    const members = activeMembers.filter((p) => p.teamId === t.id);
    return {
      id: t.id,
      name: t.name,
      leaderMembershipId: t.leaderMembershipId,
      members: members.map((p) => p.id),
      capacityHours: members.reduce((n, p) => n + p.weeklyHours, 0),
    };
  });

  const invited = people.filter((p) => p.kind === "invited").length;
  const kpis: TeamView["kpis"] = {
    people: activeMembers.length + invited,
    invited,
    teams: teamRows.length,
  };
  if (seesRates) {
    const billable = activeMembers.filter((p) => (p.rate?.billCents ?? 0) > 0);
    kpis.billableStaff = billable.length;
    kpis.billableCapacityHours = billable.reduce((n, p) => n + p.weeklyHours, 0);
    kpis.avgMultiplierHundredths = avgMultiplierHundredths(
      billable.map((p) => ({
        billCents: p.rate!.billCents,
        costCents: p.rate!.costCents,
        people: 1,
      })),
    );
  }

  return {
    people,
    teams: cards,
    kpis,
    viewerId: viewer.membershipId,
    canManage,
    roles: canManage ? roleRows : [],
    today: opts.today,
  };
}
