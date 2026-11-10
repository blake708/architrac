import type { TenantDb } from "@/db/tenant";
import { weekStartOf } from "@/lib/calc/timesheet";
import { todayIn } from "@/lib/format";
import { weekSpan } from "@/lib/time/notices";
import type { ApprovalAccess, ApprovalActor } from "./approval";
import { queueCount } from "./approval-read";
import { loadHistory, loadWeek } from "./week";
import { notSubmittedKpi } from "./week-overview";

/** What the top of both Approvals views needs: my week (KPIs), tab counts, "Not submitted". */
export async function loadApprovalsShell(db: TenantDb, actor: ApprovalActor, access: ApprovalAccess, now: Date = new Date()) {
  const current = weekStartOf(todayIn(actor.timezone, now), actor.weekStartsOn);
  const kpi = await notSubmittedKpi(db, actor, access, now);
  return {
    view: await loadWeek(db, actor, current, now),
    historyCount: (await loadHistory(db, actor, now, 0)).total,
    waiting: await queueCount(db, actor, access),
    notSubmitted: { count: kpi.count, weekLabel: `Week of ${weekSpan(kpi.weekStart)}`, weekStart: kpi.weekStart },
  };
}
