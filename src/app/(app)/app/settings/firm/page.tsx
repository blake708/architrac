import { FirmProfileFormSection } from "@/components/settings/firm-profile-form";
import { AccessDenied } from "@/components/shell/access-denied";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";
import {
  DEFAULT_STATE,
  firmDisplayName,
  firmProfileForm,
} from "@/lib/settings/firm-profile";

// Settings → Firm profile (settings-firm spec, Layout §3).
export default async function SettingsFirmPage() {
  const { firm, membership } = await requireSession();
  if (!can(membership, "settings.view")) {
    return <AccessDenied firmName={firmDisplayName(firm)} />;
  }
  return (
    <FirmProfileFormSection
      // State defaults to SC until the firm picks one (spec field 6).
      initial={{ ...firmProfileForm(firm), state: firm.state ?? DEFAULT_STATE }}
      logoUrl={firm.logoUrl}
    />
  );
}
