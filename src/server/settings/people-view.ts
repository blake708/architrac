import { type AppRole, ROLE_LABELS } from "@/lib/auth/permissions";
import {
  type Actor,
  assignableRoles,
  canManageRole,
  memberChangeBlocked,
} from "@/lib/auth/user-management";
import { formatMonthDay } from "@/lib/format";
import type { InvitationRow, MemberRow } from "./people";

// What each row of the Users & access table shows and offers, worked out on
// the server from business rule 7 (the server actions check again).

export type MemberAction = "deactivate" | "reactivate";
export type InvitationAction = "resend" | "revoke";

export type MemberView = {
  kind: "member";
  id: string;
  name: string;
  email: string;
  initials: string;
  avatarUrl: string | null;
  title: string | null;
  appRole: AppRole;
  roleLabel: string;
  status: "active" | "off";
  isMe: boolean;
  /** Roles for the select, or null to show the role as plain text. */
  roleOptions: AppRole[] | null;
  actions: MemberAction[];
};

export type InvitationView = {
  kind: "invitation";
  id: string;
  email: string;
  title: string | null;
  appRole: AppRole;
  roleLabel: string;
  status: "invited" | "expired";
  /** "Oct 20" */
  invitedOn: string;
  actions: InvitationAction[];
};

export type PersonView = MemberView | InvitationView;

export function buildPeopleView(
  me: Actor,
  members: MemberRow[],
  invitations: InvitationRow[],
  timeZone: string,
): PersonView[] {
  const memberViews: MemberView[] = members.map((m) => {
    const blocked = memberChangeBlocked(me, {
      membershipId: m.membershipId,
      appRole: m.appRole,
    });
    const actions: MemberAction[] = [];
    if (m.active && !blocked) actions.push("deactivate");
    if (!m.active && canManageRole(me, m.appRole)) actions.push("reactivate");
    return {
      kind: "member",
      id: m.membershipId,
      name: `${m.firstName} ${m.lastName}`.trim() || m.email,
      email: m.email,
      initials: m.initials,
      avatarUrl: m.avatarUrl,
      title: m.title,
      appRole: m.appRole,
      roleLabel: ROLE_LABELS[m.appRole],
      status: m.active ? "active" : "off",
      isMe: m.membershipId === me.membershipId,
      roleOptions: blocked ? null : assignableRoles(me),
      actions,
    };
  });

  const inviteViews: InvitationView[] = invitations.map((i) => ({
    kind: "invitation",
    id: i.invitationId,
    email: i.email,
    title: i.title,
    appRole: i.appRole,
    roleLabel: ROLE_LABELS[i.appRole],
    status: i.status === "pending" ? "invited" : "expired",
    invitedOn: formatMonthDay(i.invitedAt, timeZone),
    actions: canManageRole(me, i.appRole) ? ["resend", "revoke"] : [],
  }));

  return [...memberViews, ...inviteViews];
}
