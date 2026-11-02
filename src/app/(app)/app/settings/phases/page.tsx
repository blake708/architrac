import { PhasesFormView } from "@/components/settings/phases-form";
import { AccessDenied } from "@/components/shell/access-denied";
import { withFirm } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";
import { firmDisplayName } from "@/lib/settings/firm-profile";
import { loadPhases } from "@/server/settings/phases";

// Settings → Phases & fees (settings-rates-phases spec, section A).
export default async function SettingsPhasesPage() {
  const { firm, membership } = await requireSession();
  if (!can(membership, "settings.edit")) {
    return <AccessDenied firmName={firmDisplayName(firm)} />;
  }
  const form = await withFirm(firm.id, loadPhases);
  return <PhasesFormView initial={form} />;
}
