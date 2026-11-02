"use client";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { MoreIcon } from "@/components/ui/icons";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { avatarColor, formatWeekHours, fullName } from "@/lib/team/display";
import type { PersonRow, TeamCard } from "@/server/team/view";

/**
 * Teams tab (team spec, Layout §5). Decision #3 is the two-step route, so the
 * banner says the team leader reviews first.
 */
export function TeamsTab({
  teams,
  people,
  canManage,
  onMove,
  onEdit,
  onArchive,
  onNew,
}: {
  teams: TeamCard[];
  people: PersonRow[];
  canManage: boolean;
  onMove: (person: PersonRow, teamId: string | null) => void;
  onEdit: (team: TeamCard) => void;
  onArchive: (team: TeamCard) => void;
  onNew: () => void;
}) {
  const byId = new Map(people.map((p) => [p.id, p]));
  return (
    <div className="flex flex-col gap-4">
      <div
        role="note"
        className="rounded-sm bg-blue-tint px-4 py-3 text-sm text-blue-strong"
      >
        Each person&apos;s timesheet goes to their team leader first, then to a
        principal. Moving someone to another team changes who reviews their
        time from the next timesheet on.
      </div>
      {teams.length === 0 ? (
        <div className="rounded-sm border border-line bg-surface px-5 py-8 text-center">
          <p className="m-0 text-sm text-muted">
            No teams yet. Teams decide who reviews timesheets.
          </p>
          {canManage && (
            <Button variant="primary" className="mt-3" onClick={onNew}>
              New team
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] gap-4">
          {teams.map((t) => {
            const leader = t.leaderMembershipId ? byId.get(t.leaderMembershipId) : undefined;
            const members = t.members.map((id) => byId.get(id)!).filter(Boolean);
            return (
              <section
                key={t.id}
                aria-label={t.name}
                data-testid="team-card"
                className="flex flex-col rounded-sm border border-line bg-surface"
              >
                <header className="flex items-center gap-2 border-b border-line-soft px-5 pt-4 pb-3">
                  <h2 className="m-0 min-w-0 flex-1 truncate text-sm font-semibold">{t.name}</h2>
                  <span className="text-[12.5px] text-muted" data-testid="team-count">
                    {members.length} {members.length === 1 ? "person" : "people"}
                  </span>
                  {canManage && (
                    <Menu>
                      <MenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={`Actions for ${t.name}`}
                          className="inline-flex size-8 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent text-muted hover:bg-line-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-blue"
                        >
                          <MoreIcon className="size-4" />
                        </button>
                      </MenuTrigger>
                      <MenuContent>
                        <MenuItem onSelect={() => onEdit(t)}>Edit team</MenuItem>
                        <MenuItem danger onSelect={() => onArchive(t)}>
                          Archive team
                        </MenuItem>
                      </MenuContent>
                    </Menu>
                  )}
                </header>
                <div className="flex items-center gap-3 px-5 py-3">
                  {leader ? (
                    <>
                      <Avatar name={fullName(leader)} initials={leader.initials} src={leader.avatarUrl} color={avatarColor(leader.initials)} />
                      <div className="min-w-0">
                        <div className="cap text-2xs font-semibold text-ink-3">Team leader</div>
                        <div className="text-sm font-medium">{fullName(leader)}</div>
                      </div>
                    </>
                  ) : (
                    <span className="text-sm text-orange-strong">No leader set</span>
                  )}
                  <span className="num ml-auto text-xs text-muted">
                    {formatWeekHours(t.capacityHours)} / week capacity
                  </span>
                </div>
                <ul className="m-0 flex list-none flex-col border-t border-line-soft p-0">
                  {members.map((p) => (
                    <li key={p.id} className="flex items-center gap-2.5 border-b border-line-soft px-5 py-2 last:border-b-0">
                      <Avatar name={fullName(p)} initials={p.initials} src={p.avatarUrl} size="sm" color={avatarColor(p.initials)} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">{fullName(p)}</div>
                        <div className="truncate text-xs text-muted">
                          {p.title ?? ""}
                          {p.leadsTeam ? " · leader" : ""}
                        </div>
                      </div>
                      {canManage && !p.leadsTeam ? (
                        <select
                          aria-label={`Team for ${fullName(p)}`}
                          value={p.teamId ?? ""}
                          onChange={(e) => onMove(p, e.target.value || null)}
                          className="h-7 max-w-[150px] cursor-pointer rounded-sm border border-line-input bg-surface px-1.5 text-xs"
                        >
                          {teams.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                            </option>
                          ))}
                          <option value="">No team</option>
                        </select>
                      ) : (
                        <span className="text-xs text-muted">{t.name}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
