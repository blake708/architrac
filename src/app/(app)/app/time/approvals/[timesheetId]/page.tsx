import { notFound } from "next/navigation";
import { z } from "zod";
import { ApprovalDetailView } from "@/components/time/approval-detail";
import { ToastProvider } from "@/components/ui/toast";
import { withFirm } from "@/db/tenant";
import { requireSession } from "@/lib/auth/session";
import { timeActorFrom } from "@/server/time/actor";
import { approvalAccess } from "@/server/time/approval";
import { loadApprovalDetail } from "@/server/time/approval-read";

// One timesheet for review (timesheet-approval spec, Layout 5). 404 unless
// this person can see it.
export default async function ApprovalDetailPage({ params }: { params: Promise<{ timesheetId: string }> }) {
  const { timesheetId } = await params;
  if (!z.uuid().safeParse(timesheetId).success) notFound();
  const ctx = timeActorFrom(await requireSession());
  const detail = await withFirm(ctx.firmId, async (db) => loadApprovalDetail(db, ctx, await approvalAccess(db, ctx), timesheetId));
  if (!detail) notFound();
  return (
    <ToastProvider>
      <ApprovalDetailView detail={detail} />
    </ToastProvider>
  );
}
