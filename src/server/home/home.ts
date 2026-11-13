import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import { companies, invoices, memberships, phaseTemplates, projectPhases, projects, timeEntries, users } from "@/db/schema";
import type { TenantDb } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import {
  type BoardTemplate,
  type HoursBar,
  type Outstanding,
  chartDays,
  currentPhase,
  hoursBar,
  lastWeekBanner,
  outstanding,
  timeStatusLine,
  weekBillablePct,
} from "@/lib/calc/home";
import { OPEN_STATUSES } from "@/lib/calc/invoice";
import { type FeeType, billedPct, projectBilled, projectFee } from "@/lib/calc/projects";
import { dueAt } from "@/lib/calc/reminders";
import { type TimesheetStatus, addDays, dueDate, weekDates, weekStartOf } from "@/lib/calc/timesheet";
import { todayIn } from "@/lib/format";
import { initials } from "@/lib/initials";
import { SCOPE_LABELS, type ScopeKind } from "@/lib/projects/form";
import { linesByProject } from "@/server/invoices/facts";
import { assignedProjectIds } from "@/server/projects/view";
import type { TimeActor } from "@/server/time/write";
import { approvalAccess } from "@/server/time/approval";
import { type QueueItem, loadQueue } from "@/server/time/approval-read";
import { findTimesheet } from "@/server/time/week";
import { hoursByPhase } from "@/server/time/used";

// Home (home spec). One loader per widget, so each can fail on its own
// (rule 10). Who sees what is decided here, on the server (rule 11):
// - billed % only where the viewer may see the project's fee;
// - invoices only for owner/admin, and not even queried for anyone else;
// - the approval queue only for people who can open the Approvals tab.

/** Active projects in the whole firm (date line). */
export async function loadActiveCount(db: TenantDb): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(projects)
    .where(and(eq(projects.status, "active"), isNull(projects.archivedAt)));
  return r?.n ?? 0;
}

// ---------- My projects (rules 1, 6–8) ----------

export type HomeCard = {
  id: string;
  number: string;
  name: string;
  /** "Tenant upfit · Medical office", or the project type alone. */
  kindLine: string;
  onHold: boolean;
  /** Current phase; null when the project has no phases. */
  phaseCode: string | null;
  phaseName: string | null;
  pm: { name: string; initials: string } | null;
  hours: HoursBar;
  /** Left out unless the viewer may see this project's fee. */
  billedPct?: number | null;
  /** The viewer is on it (principal, PM or team). */
  mine: boolean;
};

export type BoardView = {
  templates: BoardTemplate[];
  /** Mine only, unless the viewer can switch to All firm. */
  cards: HomeCard[];
  /** Owner/admin get the Mine / All firm toggle. */
  canToggle: boolean;
};

export async function loadBoard(db: TenantDb, viewer: TimeActor): Promise<BoardView> {
  const allFirm = can(viewer.member, "home.all_projects");
  const team = await assignedProjectIds(db, viewer.membershipId);

  const templates = await db
    .select({ code: phaseTemplates.code, name: phaseTemplates.name, isOptional: phaseTemplates.isOptional, sortOrder: phaseTemplates.sortOrder })
    .from(phaseTemplates)
    .where(isNull(phaseTemplates.archivedAt));

  const rows = await db
    .select({
      id: projects.id,
      number: projects.number,
      name: projects.name,
      projectType: projects.projectType,
      scopeKind: projects.scopeKind,
      status: projects.status,
      pmMembershipId: projects.pmMembershipId,
      principalMembershipId: projects.principalMembershipId,
    })
    .from(projects)
    .where(and(inArray(projects.status, ["active", "on_hold"]), isNull(projects.archivedAt)));
  const isMine = (p: (typeof rows)[number]) =>
    p.pmMembershipId === viewer.membershipId || p.principalMembershipId === viewer.membershipId || team.has(p.id);
  const visible = allFirm ? rows : rows.filter(isMine);
  const ids = visible.map((p) => p.id);
  if (!ids.length) return { templates, cards: [], canToggle: allFirm };

  const phases = await db
    .select({
      id: projectPhases.id,
      projectId: projectPhases.projectId,
      code: projectPhases.code,
      name: projectPhases.name,
      status: projectPhases.status,
      sortOrder: projectPhases.sortOrder,
      feeType: projectPhases.feeType,
      feeCents: projectPhases.feeCents,
      budgetHours: projectPhases.budgetHours,
    })
    .from(projectPhases)
    .where(and(inArray(projectPhases.projectId, ids), isNull(projectPhases.archivedAt)))
    .orderBy(asc(projectPhases.sortOrder));
  const phasesBy = new Map<string, (typeof phases)[number][]>();
  for (const ph of phases) phasesBy.set(ph.projectId, [...(phasesBy.get(ph.projectId) ?? []), ph]);

  // Billed % only where the viewer may see the fee (the Projects list's rule).
  const own = (p: (typeof rows)[number]) =>
    p.pmMembershipId === viewer.membershipId || p.principalMembershipId === viewer.membershipId;
  const feeIds = visible.filter((p) => can(viewer.member, "projects.view_fees", { isProjectManager: own(p) })).map((p) => p.id);
  const feeVisible = new Set(feeIds);

  const pmIds = [...new Set(visible.map((p) => p.pmMembershipId))];
  const [used, lines, pmRows] = await Promise.all([
    hoursByPhase(db, ids),
    linesByProject(db, feeIds),
    db
      .select({ membershipId: memberships.id, firstName: users.firstName, lastName: users.lastName, email: users.email, initials: users.initials })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(inArray(memberships.id, pmIds)),
  ]);
  const pmBy = new Map(
    pmRows.map((u) => {
      const name = `${u.firstName} ${u.lastName}`.trim() || u.email;
      return [u.membershipId, { name, initials: u.initials || initials(name) }];
    }),
  );

  const cards = visible.map((p): HomeCard => {
    const ph = (phasesBy.get(p.id) ?? []).map((x) => ({ ...x, feeType: x.feeType as FeeType, budgetHours: Number(x.budgetHours) }));
    const cur = currentPhase(ph);
    const usedHours = ph.reduce((n, x) => n + (used.get(x.id) ?? 0), 0);
    const budget = ph.reduce((n, x) => n + x.budgetHours, 0);
    const card: HomeCard = {
      id: p.id,
      number: p.number,
      name: p.name,
      kindLine: p.scopeKind ? `${SCOPE_LABELS[p.scopeKind as ScopeKind]} · ${p.projectType}` : p.projectType,
      onHold: p.status === "on_hold",
      phaseCode: cur?.code ?? null,
      phaseName: cur?.name ?? null,
      pm: pmBy.get(p.pmMembershipId) ?? null,
      hours: hoursBar(usedHours, budget),
      mine: isMine(p),
    };
    if (feeVisible.has(p.id)) card.billedPct = billedPct(projectBilled(ph, lines.get(p.id) ?? []), projectFee(ph));
    return card;
  });
  return { templates, cards, canToggle: allFirm };
}

// ---------- Your time (rules 2–4) ----------

export type YourTime = {
  weekStart: string;
  status: TimesheetStatus | null;
  total: number;
  capacity: number;
  billablePct: number | null;
  /** Only the days that get a bar. */
  bars: { date: string; hours: number }[];
  statusLine: { text: string; returned: boolean };
  /** Last week's banner, or null. */
  banner: { text: string; weekStart: string } | null;
};

export async function loadYourTime(db: TenantDb, actor: TimeActor, now: Date = new Date()): Promise<YourTime> {
  const weekStart = weekStartOf(todayIn(actor.timezone, now), actor.weekStartsOn);
  const lastWeek = addDays(weekStart, -7);
  const [sheet, prev, member] = await Promise.all([
    findTimesheet(db, actor.membershipId, weekStart),
    findTimesheet(db, actor.membershipId, lastWeek),
    db.select({ capacity: memberships.weeklyCapacityHours }).from(memberships).where(eq(memberships.id, actor.membershipId)),
  ]);
  const entries = sheet
    ? await db
        .select({ workDate: timeEntries.workDate, hours: timeEntries.hours, billable: timeEntries.billable, projectId: timeEntries.projectId })
        .from(timeEntries)
        .where(and(eq(timeEntries.timesheetId, sheet.id), isNull(timeEntries.archivedAt)))
    : [];

  const dates = weekDates(weekStart);
  const dayTotals = dates.map((d) => entries.filter((e) => e.workDate === d).reduce((n, e) => n + Number(e.hours), 0));
  const total = dayTotals.reduce((a, b) => a + b, 0);
  const billable = entries.filter((e) => e.billable && e.projectId).reduce((n, e) => n + Number(e.hours), 0);
  const bannerText = lastWeekBanner(prev?.status ?? null, lastWeek, dueAt(lastWeek, actor), now);

  return {
    weekStart,
    status: sheet?.status ?? null,
    total,
    capacity: Number(member[0]?.capacity ?? 40),
    billablePct: weekBillablePct(billable, total),
    bars: chartDays(dates, dayTotals).map((i) => ({ date: dates[i], hours: dayTotals[i] })),
    statusLine: timeStatusLine(sheet?.status ?? null, dueDate(weekStart, actor.lockDay), sheet?.rejectionNote ?? null),
    banner: bannerText ? { text: bannerText, weekStart: lastWeek } : null,
  };
}

// ---------- Waiting on you (rule 5) ----------

export const WAITING_MAX = 8;

export type Waiting = { count: number; items: QueueItem[] };

/** Whether the viewer gets the card: the same check as the Approvals tab. */
export async function canSeeWaiting(db: TenantDb, actor: TimeActor): Promise<boolean> {
  return (await approvalAccess(db, actor)).canOpen;
}

/** The Approvals tab's queue, or null when the viewer can't open that tab. */
export async function loadWaiting(db: TenantDb, actor: TimeActor): Promise<Waiting | null> {
  const access = await approvalAccess(db, actor);
  if (!access.canOpen) return null;
  const queue = await loadQueue(db, actor, access);
  return { count: queue.count, items: queue.weeks.flatMap((w) => w.items).slice(0, WAITING_MAX) };
}

// ---------- Invoices outstanding (rule 9) ----------

/** Owner/admin only; null for anyone else, with no invoice query run. */
export async function loadOutstanding(db: TenantDb, actor: TimeActor, now: Date = new Date()): Promise<Outstanding | null> {
  if (!can(actor.member, "financials.view")) return null;
  const rows = await db
    .select({
      id: invoices.id,
      number: invoices.number,
      projectName: projects.name,
      clientName: companies.name,
      status: invoices.status,
      dueDate: invoices.dueDate,
      totalCents: invoices.totalCents,
      amountPaidCents: invoices.amountPaidCents,
    })
    .from(invoices)
    .innerJoin(projects, eq(projects.id, invoices.projectId))
    .innerJoin(companies, eq(companies.id, invoices.clientCompanyId))
    .where(and(inArray(invoices.status, [...OPEN_STATUSES]), isNull(invoices.archivedAt)));
  return outstanding(
    rows.flatMap((r) => (r.dueDate ? [{ ...r, dueDate: r.dueDate }] : [])),
    todayIn(actor.timezone, now),
  );
}
