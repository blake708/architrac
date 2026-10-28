"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/field";
import { MoreIcon } from "@/components/ui/icons";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { type AppRole, ROLE_LABELS } from "@/lib/auth/permissions";
import { ROLE_HELP } from "@/lib/auth/user-management";
import {
  changeRole,
  deactivateMember,
  inviteUser,
  resendInvite,
  revokeInvite,
} from "@/server/settings/actions";
import type { InviteField } from "@/server/settings/people";
import type { MemberView, PersonView } from "@/server/settings/people-view";

type InviteValues = { email: string; appRole: AppRole; title: string };

const STATUS: Record<PersonView["status"], { label: string; tone: BadgeTone }> =
  {
    active: { label: "Active", tone: "green" },
    invited: { label: "Invited", tone: "orange" },
    expired: { label: "Expired", tone: "neutral" },
    off: { label: "Off", tone: "neutral" },
  };

/** Settings → Users & access (settings-firm spec, Layout §5). */
export function UsersSection({
  people,
  inviteRoles,
  firmName,
}: {
  people: PersonView[];
  /** Roles I may invite as (owners: all four; admins: not Owner). */
  inviteRoles: AppRole[];
  firmName: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, startTransition] = useTransition();
  const [invite, setInvite] = useState<InviteValues>({
    email: "",
    appRole: inviteRoles.includes("staff") ? "staff" : inviteRoles[0],
    title: "",
  });
  const [inviteErrors, setInviteErrors] = useState<
    Partial<Record<InviteField, string>>
  >({});
  const [sending, startSending] = useTransition();
  const [confirmOff, setConfirmOff] = useState<MemberView | null>(null);
  const emailInput = () => document.getElementById("invite-email");

  /** Run a row action, then show its message and reload the list. */
  function run(
    action: () => Promise<{ ok: boolean; error?: string }>,
    success: string,
  ) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) toast(success);
      else toast(result.error ?? "Something went wrong.", "error");
      router.refresh();
    });
  }

  function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    startSending(async () => {
      const result = await inviteUser(invite);
      if (!result.ok) {
        setInviteErrors(result.fieldErrors ?? {});
        if (result.fieldErrors?.email) emailInput()?.focus();
        if (result.error) toast(result.error, "error");
        return;
      }
      setInviteErrors({});
      setInvite((v) => ({ ...v, email: "", title: "" }));
      toast(`Invite sent to ${result.data.email}`);
      router.refresh();
    });
  }

  /** Reactivate: fill the invite form with their email, role and title. */
  function reactivate(p: MemberView) {
    setInvite({
      email: p.email,
      appRole: inviteRoles.includes(p.appRole) ? p.appRole : invite.appRole,
      title: p.title ?? "",
    });
    setInviteErrors({});
    emailInput()?.focus();
    emailInput()?.scrollIntoView({ block: "center" });
  }

  return (
    <>
      <section
        aria-labelledby="invite-heading"
        className="rounded-sm border border-line bg-surface px-6 py-5"
      >
        <h2 id="invite-heading" className="cap m-0 text-sm font-semibold">
          Invite people
        </h2>
        <form
          onSubmit={sendInvite}
          noValidate
          className="mt-3 flex flex-wrap items-start gap-3"
        >
          <Input
            id="invite-email"
            label="Email"
            type="email"
            autoComplete="off"
            wrapperClassName="flex-[1_1_260px]"
            value={invite.email}
            error={inviteErrors.email}
            onChange={(e) => setInvite({ ...invite, email: e.target.value })}
          />
          <Select
            label="Role"
            wrapperClassName="w-[200px]"
            value={invite.appRole}
            error={inviteErrors.appRole}
            onChange={(e) =>
              setInvite({ ...invite, appRole: e.target.value as AppRole })
            }
          >
            {inviteRoles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
          <Input
            label="Title"
            placeholder="e.g. Project Architect"
            wrapperClassName="w-[200px]"
            value={invite.title}
            error={inviteErrors.title}
            onChange={(e) => setInvite({ ...invite, title: e.target.value })}
          />
          <Button
            type="submit"
            variant="primary"
            disabled={sending}
            className="mt-[22px] font-semibold"
          >
            {sending ? "Sending…" : "Send invite"}
          </Button>
        </form>
        <p
          className="m-0 mt-2 text-[12.5px] text-muted"
          data-testid="role-help"
        >
          {ROLE_HELP[invite.appRole]}
        </p>
      </section>

      <section
        aria-label="People"
        className="relative overflow-x-auto rounded-sm border border-line bg-surface"
      >
        <Table className="min-w-[760px]" wrapperClassName="overflow-visible">
          <TableHead>
            <TableRow>
              <TableHeader>Person</TableHeader>
              <TableHeader>Title</TableHeader>
              <TableHeader>Role</TableHeader>
              <TableHeader>Status</TableHeader>
              <TableHeader className="text-right">
                <span className="sr-only">Actions</span>
              </TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {people.map((p) => (
              <TableRow key={`${p.kind}-${p.id}`} data-testid="person-row">
                <TableCell>
                  {p.kind === "member" ? (
                    <span className="flex items-center gap-2.5">
                      <Avatar
                        name={p.name}
                        initials={p.initials}
                        src={p.avatarUrl}
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className="font-medium">
                          {p.name}
                          {p.isMe && (
                            <span className="ml-1.5 text-muted">(you)</span>
                          )}
                        </span>
                        <span className="text-xs text-muted">{p.email}</span>
                      </span>
                    </span>
                  ) : (
                    <span className="flex flex-col pl-[42px]">
                      <span className="font-medium">{p.email}</span>
                      <span className="text-xs text-muted">
                        Invited {p.invitedOn}
                      </span>
                    </span>
                  )}
                </TableCell>
                <TableCell>{p.title ?? ""}</TableCell>
                <TableCell>
                  {p.kind === "member" && p.roleOptions ? (
                    <Select
                      aria-label={`Role for ${p.name}`}
                      wrapperClassName="w-[180px]"
                      value={p.appRole}
                      disabled={busy}
                      onChange={(e) => {
                        const role = e.target.value as AppRole;
                        run(() => changeRole(p.id, role), "Role updated");
                      }}
                    >
                      {/* Keep their current role listed even if I can't give it. */}
                      {(p.roleOptions.includes(p.appRole)
                        ? p.roleOptions
                        : [p.appRole, ...p.roleOptions]
                      ).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    p.roleLabel
                  )}
                </TableCell>
                <TableCell>
                  <Badge
                    tone={STATUS[p.status].tone}
                    className="h-[22px] text-[10.5px] tracking-[.07em]"
                  >
                    {STATUS[p.status].label}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {p.actions.length > 0 && (
                    <Menu>
                      <MenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={`Actions for ${p.kind === "member" ? p.name : p.email}`}
                          disabled={busy}
                          className="inline-flex size-8 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent text-ink-3 hover:bg-line-soft focus-visible:outline-2 focus-visible:outline-blue"
                        >
                          <MoreIcon className="size-4" />
                        </button>
                      </MenuTrigger>
                      <MenuContent>
                        {p.kind === "member" &&
                          p.actions.includes("deactivate") && (
                            <MenuItem danger onSelect={() => setConfirmOff(p)}>
                              Deactivate
                            </MenuItem>
                          )}
                        {p.kind === "member" &&
                          p.actions.includes("reactivate") && (
                            <MenuItem onSelect={() => reactivate(p)}>
                              Reactivate
                            </MenuItem>
                          )}
                        {p.kind === "invitation" && (
                          <>
                            <MenuItem
                              onSelect={() =>
                                run(
                                  () => resendInvite(p.id),
                                  `Invite sent to ${p.email}`,
                                )
                              }
                            >
                              Resend
                            </MenuItem>
                            <MenuItem
                              danger
                              onSelect={() =>
                                run(
                                  () => revokeInvite(p.id),
                                  `Invite to ${p.email} revoked`,
                                )
                              }
                            >
                              Revoke
                            </MenuItem>
                          </>
                        )}
                      </MenuContent>
                    </Menu>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <Dialog
        open={confirmOff !== null}
        onOpenChange={(open) => !open && setConfirmOff(null)}
      >
        {confirmOff && (
          <DialogContent
            title="Turn off access"
            description={`Turn off access for ${confirmOff.name}? They won't be able to sign in to ${firmName}. Their time and history stay.`}
            footer={
              <>
                <DialogClose asChild>
                  <Button>Cancel</Button>
                </DialogClose>
                <Button
                  variant="danger"
                  onClick={() => {
                    const p = confirmOff;
                    setConfirmOff(null);
                    run(
                      () => deactivateMember(p.id),
                      `${p.name} can no longer sign in`,
                    );
                  }}
                >
                  Turn off access
                </Button>
              </>
            }
          />
        )}
      </Dialog>
    </>
  );
}
