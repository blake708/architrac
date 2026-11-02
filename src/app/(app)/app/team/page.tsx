import { TeamPage, type TeamParams } from "@/components/team/team-page";
import { ToastProvider } from "@/components/ui/toast";
import { withFirm } from "@/db/tenant";
import { requireSession } from "@/lib/auth/session";
import { todayIn } from "@/lib/format";
import { loadTeam } from "@/server/team/view";

// Team (team spec): everyone can look people up; owners and admins manage.
// Rates and other people's utilization are left out on the server for
// people who may not see them (rule 12).
export default async function TeamRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { firm, settings, membership } = await requireSession();
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");

  const viewer = {
    membershipId: membership.id,
    appRole: membership.appRole,
    active: membership.active,
  };
  const inactive = one("inactive") === "1";
  const view = await withFirm(firm.id, (db) =>
    loadTeam(db, viewer, {
      today: todayIn(firm.timezone),
      weekStartsOn: settings.weekStartsOn,
      showInactive: inactive && viewer.appRole !== "staff" && viewer.appRole !== "project_manager",
    }),
  );

  const initial: TeamParams = {
    tab: one("tab") === "teams" ? "teams" : "people",
    team: one("team") || "all",
    q: one("q"),
    person: one("person") || null,
    inactive,
  };
  return (
    <ToastProvider>
      <TeamPage view={view} viewer={viewer} initial={initial} />
    </ToastProvider>
  );
}
