"use client";

import Link from "next/link";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import { fmtHours } from "@/lib/calc/project-detail";
import { billedPct } from "@/lib/calc/projects";
import { moneyText, overheadPct, snapshotFooter } from "@/lib/calc/snapshot";
import type { ProjectSnapshot as Snapshot } from "@/server/projects/snapshot";
import { HoursCell, LegendFooter, PhaseNameCell, Stacked, num, td, th } from "./phase-table-bits";

// Project snapshot (release-2/project-snapshot.md; built in 1.5 C). Owner and
// admin only; the server never sends this data to anyone else. Both variants
// arrive together, so the overhead switch doesn't fetch anything.

export function ProjectSnapshot({ projectId, data, overheadOn }: { projectId: string; data: Snapshot; overheadOn: boolean }) {
  const [on, setOn] = useState(overheadOn);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const v = on ? data.on : data.off;
  const costHead = on ? "Cost + overhead" : "Labor cost";

  const flip = (next: boolean) => {
    setOn(next);
    // Remember it in the address (no reload, no scroll); the firm default is unchanged.
    const q = new URLSearchParams(window.location.search);
    q.set("overhead", next ? "on" : "off");
    window.history.replaceState(null, "", `?${q}`);
  };
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <section id="snapshot" aria-labelledby="snap-title" className="overflow-x-auto rounded-sm border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 px-[18px] pt-4 pb-3">
        <h2 id="snap-title" className="m-0 text-sm font-semibold">
          Project snapshot
        </h2>
        <span className="text-[12.5px] text-muted">Hours, billing and profit by phase · click a phase to see who worked on it</span>
        <span className="ml-auto inline-flex items-center gap-2.5">
          <Switch checked={on} onCheckedChange={flip} aria-label="Include overhead" />
          <span className="flex flex-col leading-tight">
            <span className="text-sm font-semibold">Include overhead</span>
            <span className="text-[11.5px] text-muted">
              {overheadPct(data.overheadBp)} of labor ·{" "}
              <Link href="/app/settings/rates" className="text-muted underline">
                Settings
              </Link>
            </span>
          </span>
        </span>
        <span aria-hidden="true" className="mx-1 h-7 w-px bg-line" />
        <Link href={`/app/projects/${projectId}/phases`} className="text-sm font-medium underline underline-offset-2">
          Phases &amp; fees
        </Link>
      </div>

      {data.phases.length === 0 ? (
        <p className="m-0 border-t border-line-soft px-[18px] py-6 text-sm text-muted">
          No phases yet.{" "}
          <Link href={`/app/projects/${projectId}/phases`} className="text-blue underline">
            Add them on Phases &amp; fees
          </Link>
          .
        </p>
      ) : (
        <table className="w-full min-w-[1040px] border-collapse text-sm">
          <thead>
            <tr>
              <th scope="col" className={th}>Phase</th>
              <th scope="col" className={cn(th, "w-[230px]")}>Hours · used / budget</th>
              <th scope="col" className={cn(th, "text-right")}>Fee</th>
              <th scope="col" className={cn(th, "text-right")}>Billed</th>
              <th scope="col" className={cn(th, "text-right")} data-testid="cost-head">{costHead}</th>
              <th scope="col" className={cn(th, "text-right")}>Profit to date</th>
              <th scope="col" className={cn(th, "text-right")}>Projected profit</th>
            </tr>
          </thead>
          {data.phases.map((p, i) => {
            const r = v.phases[i];
            const isOpen = open.has(p.id);
            const pct = billedPct(p.billedCents, p.feeCents);
            return (
              <tbody key={p.id} data-phase={p.code}>
                <tr onClick={() => toggle(p.id)} className={cn("cursor-pointer", isOpen ? "bg-surface-2" : "bg-surface")}>
                  <th scope="row" className={cn(td, "text-left font-medium normal-case")}>
                    <PhaseNameCell name={p.name} status={p.status} open={isOpen} />
                  </th>
                  <td className={td}>
                    <HoursCell name={p.name} used={r.usedHours} budget={p.budgetHours} hourly={p.feeType === "hourly"} />
                  </td>
                  <td className={cn(td, num)}>{moneyText(p.feeCents)}</td>
                  <td className={cn(td, num)}>
                    <Stacked value={moneyText(p.billedCents)} note={pct === null ? "—" : `${pct}% of fee`} />
                  </td>
                  <td className={cn(td, num)}>
                    {r.costCents === 0 && r.missingRateHours === 0 ? "—" : `${moneyText(r.costCents)}${r.missingRateHours > 0 ? "*" : ""}`}
                  </td>
                  <td className={cn(td, num)}>
                    <Stacked
                      value={r.profitCents === null ? "—" : moneyText(r.profitCents)}
                      note={r.profitNote}
                      className={cn("font-semibold", r.profitCents !== null && r.profitCents < 0 && "text-red")}
                    />
                  </td>
                  <td className={cn(td, num)}>
                    <Stacked
                      value={r.projectedCents === null ? "—" : moneyText(r.projectedCents)}
                      note={r.projectedNote}
                      className={cn("font-semibold", r.projectedCents !== null && r.projectedCents < 0 && "text-red")}
                    />
                  </td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={7} className="border-b border-line-soft bg-surface-2 pt-0 pr-[18px] pb-3.5 pl-10">
                      {r.people.length > 0 && (
                        <table className="mt-2.5 w-full max-w-[640px] border-collapse text-sm" aria-label={`Who worked on ${p.name}`}>
                          <thead>
                            <tr className="cap text-left text-2xs text-muted">
                              <th scope="col" className="py-1.5 pr-2 font-medium">Person</th>
                              <th scope="col" className="px-2 py-1.5 text-right font-medium">Hours</th>
                              <th scope="col" className="px-2 py-1.5 text-right font-medium">Cost rate</th>
                              <th scope="col" className="py-1.5 pl-2 text-right font-medium">{costHead}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.people.map((w) => {
                              const who = data.people[w.membershipId];
                              return (
                                <tr key={w.membershipId}>
                                  <td className="border-t border-line py-1.5 pr-2">
                                    <span className="inline-flex items-center gap-2">
                                      <Avatar name={who?.name ?? "Former team member"} initials={who?.initials ?? "?"} size="sm" />
                                      {who?.title ?? who?.name ?? "Former team member"}
                                    </span>
                                  </td>
                                  <td className={cn("border-t border-line px-2 py-1.5", num)}>{fmtHours(w.hours)} h</td>
                                  <td className={cn("border-t border-line px-2 py-1.5", num)}>{w.rateText}</td>
                                  <td className={cn("border-t border-line py-1.5 pl-2", num)}>{moneyText(w.costCents)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                      <p className="m-0 mt-2.5 text-[12.5px] text-ink-3">{r.detailNote}</p>
                    </td>
                  </tr>
                )}
              </tbody>
            );
          })}
          <tbody>
            <tr className="bg-surface-2 font-semibold" data-testid="snapshot-total">
              <th scope="row" className="px-[18px] py-3 text-left">Total</th>
              <td className="num px-2.5 py-3 text-[12.5px]">
                {fmtHours(v.total.usedHours)} / {fmtHours(v.total.budgetHours)} h
              </td>
              <td className={cn("px-2.5 py-3", num)}>{moneyText(v.total.feeCents)}</td>
              <td className={cn("px-2.5 py-3", num)}>{moneyText(v.total.billedCents)}</td>
              <td className={cn("px-2.5 py-3", num)}>{moneyText(v.total.costCents)}</td>
              <td className={cn("px-2.5 py-3", num, v.total.profitCents < 0 && "text-red")}>{moneyText(v.total.profitCents)}</td>
              <td className={cn("py-3 pr-[18px] pl-2.5", num)}>
                <Stacked value={moneyText(v.total.projectedCents)} note={v.total.projectedNote} />
              </td>
            </tr>
          </tbody>
        </table>
      )}

      <LegendFooter>
        {snapshotFooter(data.overheadBp, on)}
        {v.total.usedHours === 0 && " No time logged yet."}
      </LegendFooter>
      {v.missingRateHours > 0 && (
        <p className="m-0 px-[18px] pb-3.5 text-xs text-orange-strong">
          {fmtHours(v.missingRateHours)} h have no cost rate. Set rates in Settings → Roles &amp; rates.
        </p>
      )}
    </section>
  );
}
