import { RatesForm } from "@/components/settings/rates-form";
import { AccessDenied } from "@/components/shell/access-denied";
import { withFirm } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";
import { todayIn } from "@/lib/format";
import { firmDisplayName } from "@/lib/settings/firm-profile";
import { loadRates } from "@/server/settings/rates";

// Settings → Roles & rates (settings-rates-phases spec, section B). Cost
// rates and overhead are only loaded after the rates.view check.
export default async function SettingsRatesPage() {
  const { firm, membership } = await requireSession();
  if (!can(membership, "rates.view")) {
    return <AccessDenied firmName={firmDisplayName(firm)} />;
  }
  const today = todayIn(firm.timezone);
  const view = await withFirm(firm.id, (db) => loadRates(db, firm.id, today));
  return <RatesForm initial={view} />;
}
