import { TimeListsFormView } from "@/components/settings/time-lists-form";
import { AccessDenied } from "@/components/shell/access-denied";
import { withFirm } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";
import { firmDisplayName } from "@/lib/settings/firm-profile";
import { loadTimeLists } from "@/server/settings/time-lists";

// Settings → Time & approvals. Release 1.1 has only the "Timesheet phases &
// activities" card; the timesheet rules and approval route cards come with
// their own spec.
export default async function SettingsTimePage() {
  const { firm, membership } = await requireSession();
  if (!can(membership, "settings.edit")) {
    return <AccessDenied firmName={firmDisplayName(firm)} />;
  }
  const form = await withFirm(firm.id, loadTimeLists);
  return <TimeListsFormView initial={form} />;
}
