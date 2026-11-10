import { TimeHistory } from "@/components/time/time-history";
import { TimeHeader } from "@/components/time/time-header";
import { withFirm } from "@/db/tenant";
import { requireSession } from "@/lib/auth/session";
import { weekStartOf } from "@/lib/calc/timesheet";
import { todayIn } from "@/lib/format";
import { timeActorFrom } from "@/server/time/actor";
import { approvalsTabCount } from "@/server/time/approval-read";
import { loadHistory, loadWeek } from "@/server/time/week";

// Time → History (timesheet spec, Layout 8): past weeks, newest first,
// 26 at a time ("Load older" adds 26 more).
export default async function TimeHistoryPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const session = await requireSession();
  const ctx = timeActorFrom(session);
  const show = Math.min(520, Math.max(26, Number((await searchParams).show) || 26));
  const current = weekStartOf(todayIn(ctx.timezone), ctx.weekStartsOn);
  const { view, history, approvals } = await withFirm(ctx.firmId, async (db) => ({
    view: await loadWeek(db, ctx, current),
    history: await loadHistory(db, ctx, new Date(), show),
    approvals: await approvalsTabCount(db, ctx),
  }));
  return (
    <main>
      <TimeHeader view={view} tab="history" historyCount={history.total} approvalsCount={approvals} />
      <div className="flex flex-col gap-4 px-4 pt-5 pb-8 md:px-page-x">
        <TimeHistory weeks={history.weeks} hasMore={history.hasMore} nextShow={show + 26} />
      </div>
    </main>
  );
}
