import { TimeListsFormView } from "@/components/settings/time-lists-form";
import { AccessDenied } from "@/components/shell/access-denied";
import { withFirm } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";
import { weekStartOf } from "@/lib/calc/timesheet";
import { todayIn } from "@/lib/format";
import { firmDisplayName } from "@/lib/settings/firm-profile";
import { loadTimeLists } from "@/server/settings/time-lists";
import { loadReviewRoute } from "@/server/settings/review-route";
import { loadTimesheetRules } from "@/server/settings/timesheet-rules";

// Settings → Time & approvals: the "Timesheets" card (due day and time,
// notes on billable time), "Approval route" (decision #23) and "Timesheet
// phases & activities".
export default async function SettingsTimePage() {
  const { firm, settings, membership } = await requireSession();
  if (!can(membership, "settings.edit")) {
    return <AccessDenied firmName={firmDisplayName(firm)} />;
  }
  const [form, rules, route] = await withFirm(
    firm.id,
    async (db) => [await loadTimeLists(db), await loadTimesheetRules(db), await loadReviewRoute(db)] as const,
  );
  return (
    <TimeListsFormView
      initial={form}
      rules={{
        initial: rules,
        weekStartsOn: settings.weekStartsOn,
        exampleWeek: weekStartOf(todayIn(firm.timezone), settings.weekStartsOn),
      }}
      route={route}
    />
  );
}
