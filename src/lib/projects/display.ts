import type { ProjectStatus } from "@/lib/calc/projects";
import type { ProjectRow } from "@/server/projects/view";

// Projects list filters (projects-list spec, Actions). Kept pure so the
// rules are unit tested.

export type StatusTab = ProjectStatus | "all";
export type SortKey = "number" | "fee";

export type ListParams = {
  status: Exclude<StatusTab, "pursuit">;
  q: string;
  type: string;
  pm: string;
  sort: SortKey;
};

const byNumberDesc = (a: ProjectRow, b: ProjectRow) =>
  b.number.localeCompare(a.number, "en", { numeric: true });

export function filterProjects(rows: readonly ProjectRow[], p: ListParams): ProjectRow[] {
  const q = p.q.trim().toLowerCase().slice(0, 100);
  const out = rows.filter(
    (r) =>
      (p.status === "all" || r.status === p.status) &&
      (!p.type || r.projectType === p.type) &&
      (!p.pm || r.pm?.membershipId === p.pm) &&
      (!q ||
        r.number.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.clientName.toLowerCase().includes(q)),
  );
  // Rows without visible money sort as $0 under "Largest fee".
  return p.sort === "fee"
    ? out.sort((a, b) => (b.money?.feeCents ?? 0) - (a.money?.feeCents ?? 0) || byNumberDesc(a, b))
    : out.sort(byNumberDesc);
}

/** Read the list's URL parameters, falling back to the defaults. */
export function parseListParams(
  sp: Record<string, string | string[] | undefined>,
  canSortByFee: boolean,
): ListParams {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const status = one("status");
  return {
    status: (["active", "on_hold", "closed", "all"] as const).find((s) => s === status) ?? "active",
    q: one("q").slice(0, 100),
    type: one("type"),
    pm: one("pm"),
    sort: canSortByFee && one("sort") === "fee" ? "fee" : "number",
  };
}

/** The params as a query string, leaving out defaults. */
export function listQuery(p: ListParams): string {
  const sp = new URLSearchParams();
  if (p.status !== "active") sp.set("status", p.status);
  if (p.q.trim()) sp.set("q", p.q.trim());
  if (p.type) sp.set("type", p.type);
  if (p.pm) sp.set("pm", p.pm);
  if (p.sort !== "number") sp.set("sort", p.sort);
  return sp.toString();
}
