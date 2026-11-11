import { BillingForm } from "@/components/settings/billing-form";
import { AccessDenied } from "@/components/shell/access-denied";
import { withFirm } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";
import { todayIn } from "@/lib/format";
import { firmDisplayName } from "@/lib/settings/firm-profile";
import { loadBillingSettings, loadProjectNumbers, loadSampleProjectNumber } from "@/server/settings/billing";

// Settings → Billing & invoices: invoice and project number formats
// (decisions #5, #28), payment terms, remittance text.
export default async function SettingsBillingPage() {
  const { firm, membership } = await requireSession();
  if (!can(membership, "settings.edit")) {
    return <AccessDenied firmName={firmDisplayName(firm)} />;
  }
  const [settings, projectNumbers, sample] = await withFirm(
    firm.id,
    async (db) => [await loadBillingSettings(db), await loadProjectNumbers(db), await loadSampleProjectNumber(db)] as const,
  );
  return (
    <BillingForm
      initial={settings}
      year={Number(todayIn(firm.timezone).slice(0, 4))}
      projectNumbers={projectNumbers}
      sampleProjectNumber={sample}
    />
  );
}
