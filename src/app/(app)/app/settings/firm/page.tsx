import { AccessDenied } from "@/components/shell/access-denied";
import { ComingSoon } from "@/components/shell/coming-soon";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";

// Settings → Firm profile. Built in milestone 0.6 (settings-firm spec).
export default async function SettingsFirmPage() {
  const { firm, membership } = await requireSession();
  if (!can(membership, "settings.view")) {
    return <AccessDenied firmName={firm.name} />;
  }
  return <ComingSoon title="Firm profile" milestone="0.6" />;
}
