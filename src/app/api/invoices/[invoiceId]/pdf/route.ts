import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { invoices } from "@/db/schema";
import { withFirm } from "@/db/tenant";
import { requireSession } from "@/lib/auth/session";
import { StorageNotConfigured, storage } from "@/lib/integrations/storage";
import { projectAccess } from "@/server/invoices/draft";
import { pdfFileName } from "@/server/invoices/pdf";
import { actorFrom } from "@/server/settings/common";

// Download PDF (invoicing spec, Actions): check permission, then send the
// browser to a link that works for 5 minutes. The file stays private.

export async function GET(_req: Request, { params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  const session = await requireSession();
  const actor = { ...actorFrom(session), timezone: session.firm.timezone };
  if (!actor.member.active || !/^[0-9a-f-]{36}$/i.test(invoiceId)) return new NextResponse("Not found", { status: 404 });
  const found = await withFirm(session.firm.id, async (db) => {
    const [inv] = await db.select().from(invoices).where(and(eq(invoices.id, invoiceId), isNull(invoices.archivedAt)));
    if (!inv) return { status: 404 as const };
    const access = await projectAccess(db, actor, inv.projectId);
    if (!access || (!access.canDraft && !access.canReview)) return { status: 403 as const };
    if (!inv.pdfUrl || inv.status === "draft" || inv.status === "in_review") return { status: 404 as const };
    return { status: 200 as const, key: inv.pdfUrl, number: inv.number };
  });
  if (found.status === 403) return new NextResponse("You don't have access to this.", { status: 403 });
  if (found.status === 404) return new NextResponse("This invoice has no saved PDF.", { status: 404 });
  try {
    const url = await storage().signedUrl(found.key, 300, pdfFileName(found.number));
    return NextResponse.redirect(url, 302);
  } catch (err) {
    if (err instanceof StorageNotConfigured) return new NextResponse(err.message, { status: 503 });
    throw err;
  }
}
