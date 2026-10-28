import { UsersSection } from "@/components/settings/users-section";
import { AccessDenied } from "@/components/shell/access-denied";
import { withFirm } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";
import { assignableRoles } from "@/lib/auth/user-management";
import { firmDisplayName } from "@/lib/settings/firm-profile";
import { actorFrom } from "@/server/settings/common";
import { listPeople } from "@/server/settings/people";
import { buildPeopleView } from "@/server/settings/people-view";

// Settings → Users & access (settings-firm spec, Layout §5).
export default async function SettingsUsersPage() {
  const session = await requireSession();
  const { firm, membership } = session;
  if (!can(membership, "users.manage")) {
    return <AccessDenied firmName={firmDisplayName(firm)} />;
  }

  const me = actorFrom(session).member;
  const { members, invitations } = await withFirm(firm.id, (db) =>
    listPeople(db, firm.id),
  );
  return (
    <UsersSection
      people={buildPeopleView(me, members, invitations, firm.timezone)}
      inviteRoles={assignableRoles(me)}
      firmName={firmDisplayName(firm)}
    />
  );
}
