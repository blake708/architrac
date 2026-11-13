import { notFound } from "next/navigation";
import { ApprovalsViewSwitch } from "@/components/time/approval-bits";
import { ApprovalsQueueView } from "@/components/time/approvals-queue";
import { TimeHeader } from "@/components/time/time-header";
import { ToastProvider } from "@/components/ui/toast";
import { withFirm } from "@/db/tenant";
import { requireSession } from "@/lib/auth/session";
import { timeActorFrom } from "@/server/time/actor";
import { approvalAccess } from "@/server/time/approval";
import { loadQueue } from "@/server/time/approval-read";
import { loadApprovalsShell } from "@/server/time/approvals-page";

// Time → Approvals → "Waiting on me" (timesheet-approval spec, Layout 1–3).
// Only for people who review timesheets; everyone else gets 404.
export default async function ApprovalsPage() {
  const ctx = timeActorFrom(await requireSession());
  const data = await withFirm(ctx.firmId, async (db) => {
    const access = await approvalAccess(db, ctx);
    if (!access.canOpen) return null;
    return { shell: await loadApprovalsShell(db, ctx, access), queue: await loadQueue(db, ctx, access) };
  });
  if (!data) notFound();
  const { shell, queue } = data;
  const weekHref = `/app/time/approvals/week/${shell.notSubmitted.weekStart}`;
  return (
    <ToastProvider>
      <main>
        <TimeHeader
          view={shell.view}
          tab="approvals"
          historyCount={shell.historyCount}
          approvalsCount={queue.count}
          notSubmitted={shell.notSubmitted}
        />
        <div className="flex flex-col gap-4 px-4 pt-7 pb-8 md:px-page-x">
          <ApprovalsViewSwitch view="queue" waiting={queue.count} weekHref={weekHref} />
          <ApprovalsQueueView queue={queue} weekHref={weekHref} />
        </div>
      </main>
    </ToastProvider>
  );
}
