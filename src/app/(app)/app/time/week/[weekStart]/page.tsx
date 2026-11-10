import { notFound, redirect } from "next/navigation";
import { TimesheetPage } from "@/components/time/timesheet-page";
import { ToastProvider } from "@/components/ui/toast";
import { withFirm } from "@/db/tenant";
import { requireSession } from "@/lib/auth/session";
import { isIsoDate, weekStartOf } from "@/lib/calc/timesheet";
import { timeActorFrom } from "@/server/time/actor";
import { approvalsTabCount } from "@/server/time/approval-read";
import { loadHistory, loadWeek } from "@/server/time/week";

// My timesheet for one week (timesheet spec). A date that isn't a week-start
// day goes to the week containing it. Only ever the signed-in person's own.
export default async function TimeWeekPage({ params }: { params: Promise<{ weekStart: string }> }) {
  const { weekStart } = await params;
  if (!isIsoDate(weekStart)) notFound();
  const session = await requireSession();
  const start = weekStartOf(weekStart, session.settings.weekStartsOn);
  if (start !== weekStart) redirect(`/app/time/week/${start}`);
  const ctx = timeActorFrom(session);
  const { view, history, approvals } = await withFirm(ctx.firmId, async (db) => ({
    view: await loadWeek(db, ctx, weekStart),
    history: await loadHistory(db, ctx, new Date(), 0),
    approvals: await approvalsTabCount(db, ctx),
  }));
  return (
    <ToastProvider>
      <TimesheetPage key={weekStart} initial={view} historyCount={history.total} approvalsCount={approvals} />
    </ToastProvider>
  );
}
