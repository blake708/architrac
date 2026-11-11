import { and, eq, isNull, sum } from "drizzle-orm";
import { memberships, timeEntries, timesheets, users } from "@/db/schema";
import type { TenantDb } from "@/db/tenant";
import { currentRows } from "@/lib/calc/review-route";
import { NOTICES } from "@/lib/time/notices";
import { notify } from "@/server/notifications/notify";
import { loadReview } from "./review";

// Approval notifications (timesheet-approval spec rules 3e, 3f, 4, 5, 13).
// Called inside the action's transaction, after its writes.

type Sheet = typeof timesheets.$inferSelect;

const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`.trim();

export async function personName(db: TenantDb, membershipId: string): Promise<string> {
  const [p] = await db
    .select({ firstName: users.firstName, lastName: users.lastName })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.id, membershipId));
  return p ? fullName(p) : "Someone";
}

export async function userName(db: TenantDb, userId: string): Promise<string> {
  const [u] = await db.select({ firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, userId));
  return u ? fullName(u) : "Someone";
}

export async function sheetHours(db: TenantDb, timesheetId: string): Promise<number> {
  const [r] = await db
    .select({ h: sum(timeEntries.hours) })
    .from(timeEntries)
    .where(and(eq(timeEntries.timesheetId, timesheetId), isNull(timeEntries.archivedAt)));
  return Number(r?.h ?? 0);
}

/** Who the sheet's current step waits on; an any_principal row means every active principal but the submitter. */
export async function currentApprovers(db: TenantDb, timesheetId: string, submitterId: string): Promise<string[]> {
  const rows = currentRows(await loadReview(db, timesheetId));
  const named = rows.flatMap((r) => (r.approverMembershipId ? [r.approverMembershipId] : []));
  if (!rows.some((r) => r.approverMembershipId === null)) return named;
  const principals = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.isPrincipal, true), eq(memberships.active, true), isNull(memberships.archivedAt)));
  return [...named, ...principals.map((p) => p.id).filter((id) => id !== submitterId)];
}

/** A step became current: tell whoever it waits on. */
export async function noticeReviewWaiting(db: TenantDb, sheet: Pick<Sheet, "id" | "firmId" | "membershipId" | "weekStart">) {
  const to = await currentApprovers(db, sheet.id, sheet.membershipId);
  const n = NOTICES.reviewWaiting(await personName(db, sheet.membershipId), sheet.weekStart, await sheetHours(db, sheet.id));
  return notify(db, {
    firmId: sheet.firmId,
    recipients: to,
    kind: "review_waiting",
    ...n,
    link: `/app/time/approvals/${sheet.id}`,
    entity: { type: "timesheet", id: sheet.id },
  });
}

/** The last step approved: tell the person. */
export function noticeApproved(db: TenantDb, sheet: Pick<Sheet, "id" | "firmId" | "membershipId" | "weekStart">) {
  return notify(db, {
    firmId: sheet.firmId,
    recipients: [sheet.membershipId],
    kind: "timesheet_approved",
    ...NOTICES.approved(sheet.weekStart),
    link: `/app/time/week/${sheet.weekStart}`,
    entity: { type: "timesheet", id: sheet.id },
  });
}

/** An owner/admin approved for these people (rule 3f): tell each of them. */
export async function noticeStoodIn(
  db: TenantDb,
  sheet: Pick<Sheet, "id" | "firmId" | "membershipId" | "weekStart">,
  byUserId: string,
  forMembershipIds: readonly string[],
) {
  if (!forMembershipIds.length) return 0;
  const n = NOTICES.approvedForYou(await userName(db, byUserId), await personName(db, sheet.membershipId), sheet.weekStart);
  return notify(db, {
    firmId: sheet.firmId,
    recipients: forMembershipIds,
    kind: "timesheet_approved",
    ...n,
    link: `/app/time/approvals/${sheet.id}`,
    entity: { type: "timesheet", id: sheet.id },
  });
}

/** Return / Reopen: tell the person, with the note. */
export function noticeReturned(
  db: TenantDb,
  sheet: Pick<Sheet, "id" | "firmId" | "membershipId" | "weekStart">,
  note: string,
  reopened: boolean,
) {
  return notify(db, {
    firmId: sheet.firmId,
    recipients: [sheet.membershipId],
    kind: "timesheet_returned",
    ...NOTICES.returned(sheet.weekStart, note, reopened),
    link: `/app/time/week/${sheet.weekStart}`,
    entity: { type: "timesheet", id: sheet.id },
  });
}
