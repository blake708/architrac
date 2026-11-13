"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PlusIcon, SearchIcon } from "@/components/ui/icons";
import { HeaderKpis, KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader } from "@/components/ui/page-header";
import { headerTabBarClasses, tabClasses, tabCountClasses, tabRowClasses } from "@/components/ui/tab-styles";
import { cn } from "@/lib/cn";
import { formatMoney, formatMoneyShort, formatMoneySigned } from "@/lib/format";
import { type ListParams, type StatusTab, filterProjects, listQuery } from "@/lib/projects/display";
import { SCOPE_LABELS } from "@/lib/projects/form";
import type { ProjectsView } from "@/server/projects/view";
import { HealthBadge, PhaseSteps } from "./project-bits";

const th =
  "border-b border-line px-2.5 py-2.5 text-2xs font-medium whitespace-nowrap text-muted first:pl-[18px] last:pr-[18px] text-left";
const td = "px-2.5 py-2 first:pl-[18px] last:pr-[18px]";

const TABS: { key: Exclude<StatusTab, "pursuit">; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "on_hold", label: "On hold" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
];

const dash = <span className="text-muted">—</span>;

/** The Projects list (projects-list spec). */
export function ProjectsPage({ view, initial }: { view: ProjectsView; initial: ListParams }) {
  const [params, setParams] = useState(initial);
  const [q, setQ] = useState(initial.q);
  const set = (p: Partial<ListParams>) => setParams((x) => ({ ...x, ...p }));

  // Search waits 250 ms after typing (spec, Search).
  useEffect(() => {
    const t = setTimeout(() => setParams((x) => ({ ...x, q })), 250);
    return () => clearTimeout(t);
  }, [q]);

  // Filters live in the address so a filtered list can be bookmarked.
  useEffect(() => {
    const qs = listQuery(params);
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [params]);

  const rows = useMemo(() => filterProjects(view.rows, params), [view.rows, params]);
  const counts = {
    active: view.counts.active,
    on_hold: view.counts.on_hold,
    closed: view.counts.closed,
    all: view.rows.length,
  };
  const k = view.kpis;
  const filtered = params.q.trim() !== "" || params.type !== "" || params.pm !== "";

  const newButton = view.canCreate && (
    <Link href="/app/projects/new" className={buttonClasses("primary")}>
      <PlusIcon className="size-4" />
      New project
    </Link>
  );

  return (
    <main>
      <PageHeader
        eyebrow={`${counts.active} ACTIVE · ${counts.closed} CLOSED · LEADS AND PROPOSALS LIVE IN MARKETING`}
        title="Projects"
        actions={newButton}
      >
        {k && (
          <HeaderKpis label="Project totals">
            <KpiTile
              variant="header"
              label="Active fees"
              value={formatMoney(k.activeFeesCents)}
              note={`${k.activeCount} active ${k.activeCount === 1 ? "project" : "projects"}`}
            />
            <KpiTile
              variant="header"
              label="Billed to date"
              value={formatMoney(k.billedCents)}
              note={
                k.activeFeesCents > 0
                  ? `${Math.round((k.billedCents * 100) / k.activeFeesCents)}% of active fees`
                  : "No active fees"
              }
            />
            <KpiTile
              variant="header"
              label="Left to bill"
              value={formatMoneySigned(k.activeFeesCents - k.billedCents)}
              note="On active projects"
            />
            <KpiTile
              variant="header"
              label="Flagged"
              value={k.flagged}
              tone={k.flagged > 0 ? "orange" : "default"}
              note="Active projects at risk or over budget"
            />
          </HeaderKpis>
        )}

        <div className={headerTabBarClasses}>
          <div role="tablist" aria-label="Project status" className={tabRowClasses}>
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={params.status === t.key}
                onClick={() => set({ status: t.key })}
                className={tabClasses(params.status === t.key)}
              >
                {t.label}
                <span className={tabCountClasses}>{counts[t.key]}</span>
              </button>
            ))}
          </div>
        </div>
      </PageHeader>
      <div className="flex flex-col gap-5 px-4 pt-7 pb-8 md:px-page-x">
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative flex-[0_1_340px]">
            <span className="sr-only">Search projects</span>
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={q}
              maxLength={100}
              placeholder="Search by name, number or client"
              onChange={(e) => setQ(e.target.value)}
              className="h-[var(--height-control)] w-full rounded-sm border border-line-input bg-surface pr-2.5 pl-8 text-base focus:outline-2 focus:-outline-offset-1 focus:outline-blue"
            />
          </label>
          <div className="ml-auto flex flex-wrap gap-2">
            <FilterSelect
              label="Type"
              value={params.type}
              onChange={(type) => set({ type })}
              options={[["", "All"], ...view.types.map((t) => [t, t] as [string, string])]}
            />
            <FilterSelect
              label="PM"
              value={params.pm}
              onChange={(pm) => set({ pm })}
              options={[["", "Anyone"], ...view.pms.map((p) => [p.membershipId, p.name] as [string, string])]}
            />
            {view.showMoneyColumns && (
              <button
                type="button"
                onClick={() => set({ sort: params.sort === "fee" ? "number" : "fee" })}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-sm border border-line-input bg-surface px-2.5 text-sm hover:bg-surface-2"
              >
                <span className="text-muted">Sort:</span>
                {params.sort === "fee" ? "Largest fee" : "Project number"}
              </button>
            )}
          </div>
        </div>

        <section aria-label="Project list" className="overflow-x-auto rounded-sm border border-line bg-surface">
          {view.rows.length === 0 ? (
            view.canCreate ? (
              <EmptyState
                title="No projects yet"
                help="Create your first project to start tracking time and fees."
                action={newButton}
              />
            ) : (
              <EmptyState title="You're not on any projects yet" help="Ask your project manager to add you." />
            )
          ) : (
            <table className="w-full min-w-[1180px] border-collapse text-sm">
              <thead className="bg-surface-2">
                <tr>
                  <th scope="col" className={th}>No.</th>
                  <th scope="col" className={th}>Project / client</th>
                  <th scope="col" className={th}>Type</th>
                  <th scope="col" className={th}>Phase</th>
                  <th scope="col" className={th}>PM</th>
                  {view.showMoneyColumns && <th scope="col" className={cn(th, "text-right")}>Fee</th>}
                  {view.showMoneyColumns && <th scope="col" className={th}>Billed</th>}
                  <th scope="col" className={cn(th, "text-right")}>Constr. est.</th>
                  {view.showMoneyColumns && <th scope="col" className={th}>Health</th>}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-[18px] py-7 text-muted">
                      {params.q.trim() ? (
                        `No projects match "${params.q.trim()}".`
                      ) : (
                        <>
                          No projects match these filters.{" "}
                          {filtered && (
                            <button
                              type="button"
                              onClick={() => {
                                setQ("");
                                set({ q: "", type: "", pm: "" });
                              }}
                              className="cursor-pointer border-0 bg-transparent p-0 text-blue underline"
                            >
                              Clear filters
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} data-project={r.number} className="h-[58px] border-b border-line-soft last:border-b-0">
                      <td className={cn(td, "num text-xs text-ink-3")}>{r.number}</td>
                      <td className={cn(td, "max-w-[340px]")}>
                        <Link href={`/app/projects/${r.id}`} className="block truncate font-semibold text-ink no-underline hover:underline">
                          {r.name}
                        </Link>
                        <span className="block truncate text-[12.5px] text-muted">{r.clientName}</span>
                      </td>
                      <td className={td}>
                        {r.projectType}
                        {r.scopeKind && <span className="block text-[12.5px] text-muted">{SCOPE_LABELS[r.scopeKind]}</span>}
                      </td>
                      <td className={td}>
                        <PhaseSteps steps={r.steps} />
                        <span className="mt-1.5 block text-[12.5px] text-ink-2">{r.phaseText}</span>
                      </td>
                      <td className={td}>{r.pm ? <Avatar name={r.pm.name} initials={r.pm.initials} size="sm" /> : dash}</td>
                      {view.showMoneyColumns && (
                        <td className={cn(td, "num text-right text-[12.5px]")}>{r.money ? formatMoney(r.money.feeCents) : dash}</td>
                      )}
                      {view.showMoneyColumns && (
                        <td className={td}>
                          {r.money && r.money.billedPct !== null ? (
                            <span className="flex items-center gap-2">
                              <span aria-hidden="true" className="block h-1.5 w-[72px] overflow-hidden rounded-[1px] bg-[#E3E3E3]">
                                <span className="block h-full bg-blue" style={{ width: `${Math.min(r.money.billedPct, 100)}%` }} />
                              </span>
                              <span className="num text-xs text-ink-2">{r.money.billedPct}%</span>
                            </span>
                          ) : (
                            dash
                          )}
                        </td>
                      )}
                      <td className={cn(td, "num text-right text-[12.5px]")}>{formatMoneyShort(r.constructionCostCents)}</td>
                      {view.showMoneyColumns && <td className={td}>{r.money ? <HealthBadge health={r.money.health} /> : dash}</td>}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </main>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-line-input bg-surface pl-2.5 text-sm">
      <span className="text-muted">{label}:</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-full cursor-pointer border-0 bg-transparent pr-2 text-sm text-ink focus:outline-2 focus:outline-blue"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
