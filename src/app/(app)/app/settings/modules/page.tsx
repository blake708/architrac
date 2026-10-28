import { ModulesForm } from "@/components/settings/modules-form";
import { AccessDenied } from "@/components/shell/access-denied";
import { withFirm } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";
import { firmDisplayName } from "@/lib/settings/firm-profile";
import { countSeats } from "@/server/settings/people";

// Settings → Modules & plan (settings-firm spec, Layout §4).
export default async function SettingsModulesPage() {
  const { firm, settings, membership } = await requireSession();
  if (!can(membership, "modules.manage")) {
    return <AccessDenied firmName={firmDisplayName(firm)} />;
  }
  const seats = await withFirm(firm.id, (db) => countSeats(db, firm.id));
  return <ModulesForm initial={settings.modulesEnabled} seats={seats} />;
}
