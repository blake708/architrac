import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { invoices } from "@/db/schema";
import { withFirm } from "@/db/tenant";
import { requireSession } from "@/lib/auth/session";
import { projectAccess } from "@/server/invoices/draft";
import { renderInvoicePdf } from "@/server/invoices/pdf";
import { loadPdfData } from "@/server/invoices/pdf-data";
import { actorFrom } from "@/server/settings/common";

// Preview PDF (invoicing spec, Actions): built on the fly from the draft as
// it stands, with a diagonal DRAFT mark. Never saved.

export async function GET(_req: Request, { params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  const session = await requireSession();
  const actor = { ...actorFrom(session), timezone: session.firm.timezone };
  if (!actor.member.active || !/^[0-9a-f-]{36}$/i.test(invoiceId)) return new NextResponse("Not found", { status: 404 });
  const data = await withFirm(session.firm.id, async (db) => {
    const [inv] = await db.select().from(invoices).where(and(eq(invoices.id, invoiceId), isNull(invoices.archivedAt)));
    if (!inv || (inv.status !== "draft" && inv.status !== "in_review")) return "missing" as const;
    const access = await projectAccess(db, actor, inv.projectId);
    if (!access || (!access.canDraft && !access.canReview)) return "forbidden" as const;
    return loadPdfData(db, inv, "DRAFT");
  });
  if (data === "forbidden") return new NextResponse("You don't have access to this.", { status: 403 });
  if (data === "missing") return new NextResponse("Only a draft can be previewed.", { status: 404 });
  const pdf = await renderInvoicePdf(data);
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Invoice-draft-${data.project.number}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
