import { desc, eq, isNull } from "drizzle-orm";
import { activityLog, firmSettings, projects } from "@/db/schema";
import { type TenantDb, withFirm } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import { type BillingField, type BillingSettings, billingSchema } from "@/lib/settings/billing";
import { type ActionResult, SAVE_FAILED_MESSAGE, type SettingsActor, forbidden } from "./common";

// Settings → Billing & invoices (decisions #5, #28). Saves straight away
// (decision #18), owner/admin only, and logs what changed. Changing a
// number format only affects numbers made afterwards.
//
// Each save carries only the fields that changed, so editing the remittance
// text can't put back an old "next invoice number" while invoices are being
// sent.

export async function loadBillingSettings(db: TenantDb): Promise<BillingSettings> {
  const [s] = await db.select().from(firmSettings);
  return {
    invoiceNumberFormat: s.invoiceNumberFormat,
    nextInvoiceNumber: s.nextInvoiceNumber,
    projectNumberFormat: s.projectNumberFormat,
    paymentTermsDays: s.defaultPaymentTermsDays,
    remittanceText: s.invoiceRemittanceText ?? "",
  };
}

/** The firm's project numbers, newest first, for the live examples. */
export async function loadProjectNumbers(db: TenantDb): Promise<string[]> {
  // Archived projects count too, so a suggested number is never one already used.
  const rows = await db.select({ n: projects.number }).from(projects).orderBy(desc(projects.createdAt));
  return rows.map((r) => r.n);
}

/** The newest live project, to show a {PROJECT} invoice format with. */
export async function loadSampleProjectNumber(db: TenantDb): Promise<string | null> {
  const [row] = await db
    .select({ n: projects.number })
    .from(projects)
    .where(isNull(projects.archivedAt))
    .orderBy(desc(projects.createdAt))
    .limit(1);
  return row?.n ?? null;
}

const COLUMN: Record<BillingField, string> = {
  invoiceNumberFormat: "invoice_number_format",
  nextInvoiceNumber: "next_invoice_number",
  projectNumberFormat: "project_number_format",
  paymentTermsDays: "default_payment_terms_days",
  remittanceText: "invoice_remittance_text",
};

export async function saveBillingSettingsCore(
  actor: SettingsActor,
  raw: unknown,
): Promise<ActionResult<BillingField, { settings: BillingSettings }>> {
  if (!can(actor.member, "settings.edit")) return forbidden;
  const parsed = billingSchema.partial().safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<BillingField, string>> = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path[0] as BillingField] ??= issue.message;
    return { ok: false, error: "Check the highlighted fields.", fieldErrors };
  }
  const patch = parsed.data;
  if (Object.keys(patch).length === 0) return { ok: false, error: SAVE_FAILED_MESSAGE };
  try {
    const settings = await withFirm(actor.firmId, async (db) => {
      const before = await loadBillingSettings(db);
      await db
        .update(firmSettings)
        .set({
          invoiceNumberFormat: patch.invoiceNumberFormat,
          nextInvoiceNumber: patch.nextInvoiceNumber,
          projectNumberFormat: patch.projectNumberFormat,
          defaultPaymentTermsDays: patch.paymentTermsDays,
          invoiceRemittanceText: patch.remittanceText === undefined ? undefined : patch.remittanceText || null,
        })
        .where(eq(firmSettings.firmId, actor.firmId));
      const changes: Record<string, { before: unknown; after: unknown }> = {};
      for (const key of Object.keys(patch) as BillingField[])
        if (before[key] !== patch[key]) changes[COLUMN[key]] = { before: before[key], after: patch[key] };
      if (Object.keys(changes).length)
        await db.insert(activityLog).values({
          firmId: actor.firmId,
          actorUserId: actor.userId,
          entityType: "firm_settings",
          entityId: actor.firmId,
          action: "updated",
          changes,
        });
      return loadBillingSettings(db);
    });
    return { ok: true, data: { settings } };
  } catch (err) {
    console.error("saveBillingSettings failed", err);
    return { ok: false, error: SAVE_FAILED_MESSAGE };
  }
}
