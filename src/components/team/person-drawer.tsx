"use client";

import { useTransition } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DrawerContent } from "@/components/ui/dialog";
import { Select } from "@/components/ui/field";
import { type AppRole, ROLE_LABELS } from "@/lib/auth/permissions";
import {
  type Actor,
  assignableRoles,
  memberChangeBlocked,
} from "@/lib/auth/user-management";
import { formatMoney } from "@/lib/format";
import { EMPLOYMENT_LABELS } from "@/lib/team/profile";
import { avatarColor, fullName, formatWeekHours } from "@/lib/team/display";
import {
  changeRole,
  resendInvite,
  revokeInvite,
} from "@/server/settings/actions";
import type { PersonRow } from "@/server/team/view";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-3 border-b border-line-soft py-2.5 text-sm last:border-b-0">
      <dt className="cap text-2xs font-medium text-muted">{label}</dt>
      <dd className="m-0 min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** The person panel (team spec, Layout §6). */
export function PersonDrawer({
  person,
  viewer,
  onClose,
  onEdit,
  onChanged,
  onError,
}: {
  person: PersonRow | null;
  viewer: Actor;
  onClose: () => void;
  onEdit: (p: PersonRow) => void;
  /** After a change: show a message and reload the data. */
  onChanged: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  if (!person) return null;
  const p = person;
  const canManage = assignableRoles(viewer).length > 0;
  const blocked =
    p.kind === "member"
      ? memberChangeBlocked(viewer, { membershipId: p.id, appRole: p.appRole })
      : "invited";
  const roleOptions = blocked ? [] : assignableRoles(viewer);
  const teamLine = p.teamName
    ? p.leadsTeam
      ? `${p.teamName} · team leader`
      : p.leaderInitials
        ? `${p.teamName} · reports to ${p.leaderInitials}`
        : p.teamName
    : "No team";

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) onError(result.error ?? "Couldn't save. Try again.");
      else onChanged(ok);
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DrawerContent
        title={fullName(p)}
        description={p.title ?? undefined}
        className="max-w-[420px]!"
        footer={
          canManage ? (
            p.kind === "member" ? (
              <Button variant="primary" onClick={() => onEdit(p)}>
                Edit profile
              </Button>
            ) : (
              <>
                <Button
                  variant="danger"
                  disabled={pending}
                  onClick={() => run(() => revokeInvite(p.id), `Invite to ${p.email} revoked`)}
                >
                  Revoke invite
                </Button>
                <Button
                  disabled={pending}
                  onClick={() => run(() => resendInvite(p.id), `Invite sent again to ${p.email}`)}
                >
                  Resend invite
                </Button>
              </>
            )
          ) : undefined
        }
      >
        <div className="mb-4 flex items-center gap-3">
          <Avatar
            name={fullName(p)}
            initials={p.initials}
            src={p.avatarUrl}
            size="xl"
            color={avatarColor(p.initials)}
          />
          <div className="min-w-0 text-sm text-ink-3">{teamLine}</div>
        </div>
        <dl className="m-0">
          <Row label="Email">
            <a href={`mailto:${p.email}`} className="text-blue underline">
              {p.email}
            </a>
          </Row>
          <Row label="Phone">{p.phone ?? "—"}</Row>
          <Row label={p.rate !== undefined ? "Role · rates" : "Role"}>
            {p.roleName ?? <span className="text-orange-strong">No role</span>}
            {p.rate && (
              <span className="num text-[12.5px] text-ink-3">
                {" "}· {formatMoney(p.rate.billCents)} bill / {formatMoney(p.rate.costCents)} cost
              </span>
            )}
          </Row>
          <Row label="Weekly hours">
            {formatWeekHours(p.weeklyHours)}
            {p.targetBp !== null && ` · utilization target ${p.targetBp / 100}%`}
          </Row>
          <Row label="Employment">{EMPLOYMENT_LABELS[p.employmentType]}</Row>
          <Row label="License">{p.licenseNote ?? "—"}</Row>
          <Row label="With firm since">{p.startDate ? p.startDate.slice(0, 4) : "—"}</Row>
        </dl>

        <h3 className="cap mt-6 mb-2 text-xs font-semibold">Access</h3>
        {p.kind === "invited" ? (
          <p className="m-0 text-sm">
            Invited as {ROLE_LABELS[p.appRole]}. Not signed in yet.
          </p>
        ) : roleOptions.length > 0 ? (
          <Select
            label="Access level"
            value={p.appRole}
            disabled={pending}
            onChange={(e) =>
              run(
                () => changeRole(p.id, e.target.value as AppRole),
                `${fullName(p)} is now ${ROLE_LABELS[e.target.value as AppRole]}`,
              )
            }
          >
            {/* Keep their current role listed even if I can't give it. */}
            {(roleOptions.includes(p.appRole) ? roleOptions : [p.appRole, ...roleOptions]).map(
              (r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ),
            )}
          </Select>
        ) : (
          <p className="m-0 text-sm">{ROLE_LABELS[p.appRole]}</p>
        )}
        <ul className="m-0 mt-3 flex list-none flex-col gap-1 p-0 text-sm text-ink-3">
          {p.leadsTeam && <li>Team leader · {p.teamName}</li>}
          {p.isPrincipal && <li>Principal · final timesheet approval</li>}
        </ul>
      </DrawerContent>
    </Dialog>
  );
}
