import { TimeListsFormView } from "@/components/settings/time-lists-form";
import { AccessDenied } from "@/components/shell/access-denied";
import { withFirm } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";
import { weekStartOf } from "@/lib/calc/timesheet";
import { todayIn } from "@/lib/format";
import { firmDisplayName } from "@/lib/settings/firm-profile";
import { loadTimeLists } from "@/server/settings/time-lists";
import { loadTimesheetRules } from "@/server/settings/timesheet-rules";

// Settings → Time & approvals: the "Timesheets" card (due day and time,
// notes on billable time) and "Timesheet phases & activities". The approval
// route card comes with custom review workflows (1.7, decision #23).
export default async function SettingsTimePage() {
  const { firm, settings, membership } = await requireSession();
  if (!can(membership, "settings.edit")) {
    return <AccessDenied firmName={firmDisplayName(firm)} />;
  }
  const [form, rules] = await withFirm(firm.id, async (db) => [await loadTimeLists(db), await loadTimesheetRules(db)] as const);
  return (
    <TimeListsFormView
      initial={form}
      rules={{
        initial: rules,
        weekStartsOn: settings.weekStartsOn,
        exampleWeek: weekStartOf(todayIn(firm.timezone), settings.weekStartsOn),
      }}
    />
  );
}
