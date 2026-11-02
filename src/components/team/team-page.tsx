"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PlusIcon, SearchIcon } from "@/components/ui/icons";
import { KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { type Actor, assignableRoles } from "@/lib/auth/user-management";
import { cn } from "@/lib/cn";
import { formatMultiplier } from "@/lib/format";
import {
  type TeamFilter,
  avatarColor,
  filterPeople,
  formatWeekHours,
  fullName,
  rateLine,
  teamSubLine,
} from "@/lib/team/display";
import { deactivateMember } from "@/server/settings/actions";
import { archiveTeam, movePerson } from "@/server/team/actions";
import type { AccessPill, PersonRow, TeamCard, TeamView } from "@/server/team/view";
import { EditProfileDialog, InviteDialog } from "./person-dialogs";
import { PersonDrawer } from "./person-drawer";
import { TeamDialog } from "./team-dialog";
import { TeamsTab } from "./teams-tab";
import { UtilizationCell } from "./utilization-cell";

export type TeamParams = {
  tab: "people" | "teams";
  team: TeamFilter;
  q: string;
  person: string | null;
  inactive: boolean;
};

const PILL: Record<AccessPill, string> = {
  Invited: "bg-orange-tint text-orange-strong",
  Owner: "bg-ink text-white",
  Admin: "bg-ink text-white",
  "Team leader": "bg-blue-tint text-blue-strong",
  "Project manager": "bg-blue-tint text-blue-strong",
  Member: "bg-line-soft text-ink-3",
};

/** Keep tab, filter, search and open person in the address (no reload). */
function useUrlState(p: TeamParams) {
  useEffect(() => {
    const sp = new URLSearchParams();
    if (p.tab !== "people") sp.set("tab", p.tab);
    if (p.team !== "all") sp.set("team", p.team);
    if (p.q) sp.set("q", p.q);
    if (p.person) sp.set("person", p.person);
    if (p.inactive) sp.set("inactive", "1");
    const qs = sp.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [p.tab, p.team, p.q, p.person, p.inactive]);
}

/** The Team page (team spec). */
export function TeamPage({
  view,
  viewer,
  initial,
}: {
  view: TeamView;
  viewer: Actor;
  initial: TeamParams;
}) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState(initial.tab);
  const [team, setTeam] = useState<TeamFilter>(initial.team);
  const [q, setQ] = useState(initial.q);
  const [personId, setPersonId] = useState(initial.person);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<PersonRow | null>(null);
  const [teamDialog, setTeamDialog] = useState<{ open: boolean; team: TeamCard | null }>({
    open: false,
    team: null,
  });
  const [, startTransition] = useTransition();
  useUrlState({ tab, team, q, person: personId, inactive: initial.inactive });

  const visible = useMemo(() => filterPeople(view.people, q, team), [view.people, q, team]);
  const person = view.people.find((p) => p.id === personId) ?? null;
  const hasNoTeam = view.people.some((p) => p.teamId === null);
  const isOwnerAdmin = view.kpis.billableStaff !== undefined;

  function changed(message: string) {
    toast(message);
    router.refresh();
  }
  function failed(message: string) {
    toast(message, "error");
  }

  function move(p: PersonRow, teamId: string | null) {
    startTransition(async () => {
      const result = await movePerson({ membershipId: p.id, teamId });
      if (!result.ok) failed(result.error ?? "Couldn't move them.");
      else changed(result.data.message);
    });
  }
  function archive(t: TeamCard) {
    startTransition(async () => {
      const result = await archiveTeam(t.id);
      if (!result.ok) failed(result.error ?? "Couldn't archive the team.");
      else changed(`${t.name} archived`);
    });
  }

  const tabButton = (key: "people" | "teams", label: string, count: number) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === key}
      onClick={() => {
        setTab(key);
        setPersonId(null);
      }}
      className={cn(
        "-mb-px cursor-pointer border-0 border-b-2 bg-transparent px-1 pb-2.5 text-base",
        tab === key ? "border-ink font-semibold text-ink" : "border-transparent text-ink-3 hover:text-ink",
      )}
    >
      {label} <span className="num text-xs text-muted">{count}</span>
    </button>
  );

  return (
    <>
      <PageHeader
        eyebrow="PEOPLE · TEAMS"
        title="Team"
        actions={
          view.canManage && (
            <>
              <Button onClick={() => setTeamDialog({ open: true, team: null })}>New team</Button>
              <Button variant="primary" icon={<PlusIcon />} onClick={() => setInviteOpen(true)}>
                Invite person
              </Button>
            </>
          )
        }
      />
      <div className="flex flex-col gap-5 px-4 pt-6 pb-8 md:px-page-x">
        <section aria-label="Team summary" className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
          <KpiTile
            label="People"
            value={view.kpis.people}
            note={view.kpis.invited > 0 ? `${view.kpis.invited} invited, not yet signed in` : "Everyone has signed in"}
          />
          <KpiTile label="Teams" value={view.kpis.teams} note="Each with a leader who reviews time" />
          {isOwnerAdmin && (
            <>
              <KpiTile
                label="Billable staff"
                value={view.kpis.billableStaff}
                note={`${formatWeekHours(view.kpis.billableCapacityHours ?? 0)} / week capacity`}
              />
              <KpiTile
                label="Avg. multiplier"
                value={formatMultiplier(view.kpis.avgMultiplierHundredths ?? null)}
                note={
                  <>
                    Bill ÷ cost · rates are set in{" "}
                    <Link href="/app/settings/rates" className="text-blue underline">
                      Settings
                    </Link>
                  </>
                }
              />
            </>
          )}
        </section>

        <div role="tablist" aria-label="Team views" className="flex gap-6 border-b border-line">
          {tabButton("people", "People", view.people.length)}
          {tabButton("teams", "Teams", view.teams.length)}
        </div>

        {tab === "people" ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <label className="relative flex-[0_1_300px]">
                <span className="sr-only">Search by name or role</span>
                <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" />
                <input
                  type="search"
                  value={q}
                  placeholder="Search by name or role"
                  onChange={(e) => setQ(e.target.value)}
                  className="h-[var(--height-control)] w-full rounded-sm border border-line-input bg-surface pr-2.5 pl-8 text-base focus:outline-2 focus:-outline-offset-1 focus:outline-blue"
                />
              </label>
              <div role="group" aria-label="Filter by team" className="flex flex-wrap gap-1">
                {[
                  { id: "all", name: "All" },
                  ...view.teams.map((t) => ({ id: t.id, name: t.name })),
                  ...(hasNoTeam ? [{ id: "none", name: "No team" }] : []),
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={team === f.id}
                    onClick={() => setTeam(f.id)}
                    className={cn(
                      "h-8 cursor-pointer rounded-sm border px-3 text-sm",
                      team === f.id ? "border-ink bg-ink text-white" : "border-line-input bg-surface text-ink hover:bg-surface-2",
                    )}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
              {view.canManage && (
                <label className="ml-auto flex items-center gap-2 text-sm text-ink-3">
                  <input
                    type="checkbox"
                    checked={initial.inactive}
                    onChange={(e) => {
                      const sp = new URLSearchParams(window.location.search);
                      if (e.target.checked) sp.set("inactive", "1");
                      else sp.delete("inactive");
                      router.replace(`?${sp.toString()}`);
                    }}
                    className="size-4 accent-ink"
                  />
                  Show inactive
                </label>
              )}
            </div>

            {visible.length === 0 ? (
              <div className="rounded-sm border border-line bg-surface px-5 py-8 text-center">
                <p className="m-0 text-sm text-muted">No people match “{q}”</p>
                <Button
                  className="mt-3"
                  onClick={() => {
                    setQ("");
                    setTeam("all");
                  }}
                >
                  Clear search and filters
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-sm border border-line bg-surface">
                <table className="w-full min-w-[900px] border-collapse text-sm">
                  <thead className="bg-surface-2">
                    <tr>
                      {["Person", "Role · rate", "Team", "Week", "Utilization · 4 wks", "Access"].map((h, i) => (
                        <th
                          key={h}
                          scope="col"
                          className={cn(
                            "border-b border-line px-2.5 py-2.5 text-2xs font-medium whitespace-nowrap text-muted first:pl-[18px] last:pr-[18px]",
                            i === 3 ? "text-right" : "text-left",
                          )}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((p) => {
                      const rate = rateLine(p);
                      const sub = teamSubLine(p);
                      return (
                        <tr
                          key={p.id}
                          data-person={fullName(p)}
                          onClick={() => setPersonId(p.id)}
                          className={cn(
                            "cursor-pointer border-b border-line-soft last:border-b-0 hover:bg-surface-2",
                            personId === p.id && "bg-[#EAF0FB] hover:bg-[#EAF0FB]",
                            !p.active && "opacity-60",
                          )}
                        >
                          <td className="py-2.5 pr-2.5 pl-[18px]">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPersonId(p.id);
                              }}
                              className="flex cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left focus-visible:outline-2 focus-visible:outline-blue"
                            >
                              <Avatar name={fullName(p)} initials={p.initials} src={p.avatarUrl} size="lg" color={avatarColor(p.initials)} />
                              <span className="min-w-0">
                                <span className="block font-medium">{fullName(p)}</span>
                                <span className="block text-xs text-muted">{p.title ?? ""}</span>
                              </span>
                            </button>
                          </td>
                          <td className="px-2.5 py-2.5">
                            {p.roleName ?? <span className="text-orange-strong">No role</span>}
                            {rate && (
                              <span className={cn("num block text-xs", rate.warn ? "text-orange-strong" : "text-muted")}>
                                {rate.text}
                              </span>
                            )}
                          </td>
                          <td className="px-2.5 py-2.5">
                            {p.teamName ?? <span className="text-muted">No team</span>}
                            {sub && <span className="block text-xs text-muted">{sub}</span>}
                          </td>
                          <td className="num px-2.5 py-2.5 text-right text-[12.5px]">{formatWeekHours(p.weeklyHours)}</td>
                          <td className="px-2.5 py-2.5">
                            <UtilizationCell value={p.utilization} />
                          </td>
                          <td className="py-2.5 pr-[18px] pl-2.5">
                            <span
                              className={cn(
                                "inline-flex h-[22px] items-center rounded-sm px-2 text-[10.5px] font-medium tracking-[0.07em] whitespace-nowrap uppercase",
                                PILL[p.access],
                              )}
                            >
                              {p.active ? p.access : "Off"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {view.people.length === 1 && (
                  <div className="flex flex-wrap items-center gap-3 border-t border-line-soft px-5 py-4">
                    <span className="text-sm text-ink-3">Invite your team to start tracking time.</span>
                    {view.canManage && (
                      <Button variant="primary" onClick={() => setInviteOpen(true)}>
                        Invite person
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <TeamsTab
            teams={view.teams}
            people={view.people}
            canManage={view.canManage}
            onMove={move}
            onEdit={(t) => setTeamDialog({ open: true, team: t })}
            onArchive={archive}
            onNew={() => setTeamDialog({ open: true, team: null })}
          />
        )}
      </div>

      <PersonDrawer
        person={tab === "people" ? person : null}
        viewer={viewer}
        onClose={() => setPersonId(null)}
        onEdit={(p) => setEditing(p)}
        onChanged={changed}
        onError={failed}
      />
      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        roles={view.roles}
        teams={view.teams}
        assignable={assignableRoles(viewer)}
        onDone={(email) => {
          setInviteOpen(false);
          changed(`Invite sent to ${email}`);
        }}
      />
      <EditProfileDialog
        person={editing}
        onOpenChange={(o) => !o && setEditing(null)}
        roles={view.roles}
        teams={view.teams}
        onDone={(name) => {
          setEditing(null);
          changed(`${name} saved`);
        }}
        onDeactivate={
          editing && editing.id !== viewer.membershipId
            ? () => {
                const p = editing;
                startTransition(async () => {
                  const result = await deactivateMember(p.id);
                  if (!result.ok) {
                    failed(result.error ?? "Couldn't turn off access.");
                    return;
                  }
                  setEditing(null);
                  setPersonId(null);
                  changed(`${fullName(p)} can no longer sign in`);
                });
              }
            : null
        }
      />
      <TeamDialog
        open={teamDialog.open}
        team={teamDialog.team}
        people={view.people}
        onOpenChange={(o) => !o && setTeamDialog({ open: false, team: null })}
        onDone={(message) => {
          setTeamDialog({ open: false, team: null });
          changed(message);
        }}
      />
    </>
  );
}
