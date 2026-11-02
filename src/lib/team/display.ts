import { formatMoney } from "@/lib/format";
import type { PersonRow } from "@/server/team/view";

// Team page display rules (team spec, business rules 6–8 and Actions:
// Search, Team filter). Pure, so the page and tests share them.

const SHADES = ["#141414", "#2A2A2A", "#3A3A3A", "#4D4D4D", "#5C5C5C", "#666666"];

/** Rule 8: a grey shade picked from the initials. */
export function avatarColor(initials: string): string {
  const a = initials.charCodeAt(0) || 0;
  const b = initials.charCodeAt(1) || 0;
  return SHADES[(a + b) % SHADES.length];
}

export const fullName = (p: Pick<PersonRow, "firstName" | "lastName">) =>
  `${p.firstName} ${p.lastName}`.trim();

/** "none" = people with no team. */
export type TeamFilter = "all" | "none" | string;

/** Search name, title and role name (case-insensitive), then the team filter. */
export function filterPeople(
  people: readonly PersonRow[],
  q: string,
  team: TeamFilter,
): PersonRow[] {
  const needle = q.trim().toLowerCase();
  return people.filter((p) => {
    if (team === "none" && p.teamId !== null) return false;
    if (team !== "all" && team !== "none" && p.teamId !== team) return false;
    if (!needle) return true;
    return [fullName(p), p.title ?? "", p.roleName ?? "", p.email]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
}

/** Rule 7: "Leads this team", "Leader · KL" or "No leader set". */
export function teamSubLine(p: PersonRow): string | null {
  if (!p.teamId) return null;
  if (p.leadsTeam) return "Leads this team";
  return p.leaderInitials ? `Leader · ${p.leaderInitials}` : "No leader set";
}

/** The rate line under the role (owner/admin only). */
export function rateLine(p: PersonRow): { text: string; warn: boolean } | null {
  if (p.rate === undefined) return null;
  if (p.rate === null) return { text: "No rate set", warn: true };
  if (p.rate.billCents === 0) return { text: "Not billable", warn: false };
  return { text: `${formatMoney(p.rate.billCents)} / h`, warn: false };
}

/** "40 h", "37.5 h". */
export function formatWeekHours(h: number): string {
  return `${Number.isInteger(h) ? h : h.toFixed(2).replace(/0$/, "")} h`;
}
