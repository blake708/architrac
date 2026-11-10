import { notFound } from "next/navigation";
import { ApprovalsQueueView } from "@/components/time/approvals-queue";
import { TimeHeader } from "@/components/time/time-header";
import { ToastProvider } from "@/components/ui/toast";
import { withFirm } from "@/db/tenant";
import { requireSession } from "@/lib/auth/session";
import { weekStartOf } from "@/lib/calc/timesheet";
import { todayIn } from "@/lib/format";
import { timeActorFrom } from "@/server/time/actor";
import { approvalAccess } from "@/server/time/approval";
import { loadQueue } from "@/server/time/approval-read";
import { loadHistory, loadWeek } from "@/server/time/week";

// Time → Approvals → "Waiting on me" (timesheet-approval spec, Layout 2–3).
// Only for people who review timesheets; everyone else gets 404.
export default async function ApprovalsPage() {
  const session = await requireSession();
  const ctx = timeActorFrom(session);
  const current = weekStartOf(todayIn(ctx.timezone), ctx.weekStartsOn);
  const data = await withFirm(ctx.firmId, async (db) => {
    const access = await approvalAccess(db, ctx);
    if (!access.canOpen) return null;
    return {
      view: await loadWeek(db, ctx, current),
      history: await loadHistory(db, ctx, new Date(), 0),
      queue: await loadQueue(db, ctx, access),
    };
  });
  if (!data) notFound();
  return (
    <ToastProvider>
      <main>
        <TimeHeader view={data.view} tab="approvals" historyCount={data.history.total} approvalsCount={data.queue.count} />
        <div className="flex flex-col gap-4 px-4 pt-5 pb-8 md:px-page-x">
          <ApprovalsQueueView queue={data.queue} />
        </div>
      </main>
    </ToastProvider>
  );
}
