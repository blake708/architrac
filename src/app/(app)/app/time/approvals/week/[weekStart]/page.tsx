import { notFound, redirect } from "next/navigation";
import { ApprovalsViewSwitch } from "@/components/time/approval-bits";
import { TimeHeader } from "@/components/time/time-header";
import { WeekOverviewView } from "@/components/time/week-overview";
import { ToastProvider } from "@/components/ui/toast";
import { withFirm } from "@/db/tenant";
import { requireSession } from "@/lib/auth/session";
import { isIsoDate, weekStartOf } from "@/lib/calc/timesheet";
import { timeActorFrom } from "@/server/time/actor";
import { approvalAccess } from "@/server/time/approval";
import { loadApprovalsShell } from "@/server/time/approvals-page";
import { loadWeekOverview } from "@/server/time/week-overview";

// Time → Approvals → Week overview (timesheet-approval spec, Layout 4).
export default async function WeekOverviewPage({ params }: { params: Promise<{ weekStart: string }> }) {
  const { weekStart } = await params;
  if (!isIsoDate(weekStart)) notFound();
  const session = await requireSession();
  const start = weekStartOf(weekStart, session.settings.weekStartsOn);
  if (start !== weekStart) redirect(`/app/time/approvals/week/${start}`);
  const ctx = timeActorFrom(session);
  const data = await withFirm(ctx.firmId, async (db) => {
    const access = await approvalAccess(db, ctx);
    if (!access.canOpen) return null;
    return { shell: await loadApprovalsShell(db, ctx, access), overview: await loadWeekOverview(db, ctx, access, weekStart) };
  });
  if (!data) notFound();
  const { shell, overview } = data;
  // Weeks that haven't started have nothing to review.
  if (weekStart > shell.view.currentWeekStart) notFound();
  return (
    <ToastProvider>
      <main>
        <TimeHeader
          view={shell.view}
          tab="approvals"
          historyCount={shell.historyCount}
          approvalsCount={shell.waiting}
          notSubmitted={shell.notSubmitted}
        />
        <div className="flex flex-col gap-4 px-4 pt-5 pb-8 md:px-page-x">
          <ApprovalsViewSwitch view="week" waiting={shell.waiting} weekHref={`/app/time/approvals/week/${overview.defaultWeek}`} />
          <WeekOverviewView overview={overview} timezone={ctx.timezone} />
        </div>
      </main>
    </ToastProvider>
  );
}
