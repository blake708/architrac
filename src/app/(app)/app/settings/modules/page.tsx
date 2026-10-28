import { AccessDenied } from "@/components/shell/access-denied";
import { ComingSoon } from "@/components/shell/coming-soon";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";

// Settings → Modules & plan. Built in milestone 0.6 (settings-firm spec).
export default async function SettingsModulesPage() {
  const { firm, membership } = await requireSession();
  if (!can(membership, "modules.manage")) {
    return <AccessDenied firmName={firm.name} />;
  }
  return <ComingSoon title="Modules & plan" milestone="0.6" />;
}
