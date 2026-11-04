"use client";

import Link from "next/link";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/cn";
import { fmtHours, remainingText } from "@/lib/calc/project-detail";
import { billedPct } from "@/lib/calc/projects";
import { moneyText } from "@/lib/calc/snapshot";
import type { PhaseRow } from "@/server/projects/page";
import { HoursCell, LegendFooter, PhaseNameCell, Stacked, num, td, th } from "./phase-table-bits";

/**
 * Hours vs budget (project-detail spec, Overview; rules 2–4): what a PM sees
 * on their own projects, styled like the Project snapshot (Blake, 2026-11-04).
 * Fee and billed only; never cost, profit or overhead.
 */
export function HoursTable({ projectId, phases }: { projectId: string; phases: PhaseRow[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const rows = phases.filter((p) => p.money);
  const used = rows.reduce((n, p) => n + p.money!.usedHours, 0);
  const budget = rows.reduce((n, p) => n + p.money!.budgetHours, 0);
  const fee = rows.reduce((n, p) => n + p.money!.feeCents, 0);
  const billed = rows.reduce((n, p) => n + p.money!.billedCents, 0);
  const total = remainingText(budget, used);
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <section aria-labelledby="hours-title" className="overflow-x-auto rounded-sm border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 px-[18px] pt-4 pb-3">
        <h2 id="hours-title" className="m-0 text-sm font-semibold">
          Hours vs budget
        </h2>
        <span className="text-[12.5px] text-muted">Hours and billing by phase · click a phase to see who worked on it</span>
        <Link href={`/app/projects/${projectId}/phases`} className="ml-auto text-sm font-medium underline underline-offset-2">
          Phases &amp; fees
        </Link>
      </div>
      <table className="w-full min-w-[880px] border-collapse text-sm">
        <thead>
          <tr>
            <th scope="col" className={th}>Phase</th>
            <th scope="col" className={cn(th, "w-[230px]")}>Hours · used / budget</th>
            <th scope="col" className={cn(th, "text-right")}>Fee</th>
            <th scope="col" className={cn(th, "text-right")}>Billed</th>
            <th scope="col" className={cn(th, "text-right")}>Remaining</th>
            <th scope="col" className={cn(th, "text-right")}>% complete</th>
          </tr>
        </thead>
        {rows.map((p) => {
          const m = p.money!;
          const left = remainingText(m.budgetHours, m.usedHours);
          const isOpen = open.has(p.id);
          const pct = billedPct(m.billedCents, m.feeCents);
          return (
            <tbody key={p.id} data-phase={p.code}>
              <tr onClick={() => toggle(p.id)} className={cn("cursor-pointer", isOpen ? "bg-surface-2" : "bg-surface")}>
                <th scope="row" className={cn(td, "text-left font-medium normal-case")}>
                  <PhaseNameCell name={p.name} status={p.status} open={isOpen} />
                </th>
                <td className={td}>
                  <HoursCell name={p.name} used={m.usedHours} budget={m.budgetHours} hourly={m.feeType === "hourly"} />
                </td>
                <td className={cn(td, num)}>{moneyText(m.feeCents)}</td>
                <td className={cn(td, num)}>
                  <Stacked value={moneyText(m.billedCents)} note={pct === null ? "—" : `${pct}% of fee`} />
                </td>
                <td className={cn(td, num, m.feeType !== "hourly" && left.over && "text-red")}>
                  {m.feeType === "hourly" ? <span className="cap text-2xs font-medium text-muted">Hourly</span> : left.text}
                </td>
                <td className={cn(td, num)}>{m.feeType === "fixed" ? `${m.percentCompleteBp / 100}%` : "—"}</td>
              </tr>
              {isOpen && (
                <tr>
                  <td colSpan={6} className="border-b border-line-soft bg-surface-2 pt-0 pr-[18px] pb-3.5 pl-10">
                    {m.byPerson.length === 0 ? (
                      <p className="m-0 mt-2.5 text-[12.5px] text-ink-3">No time logged yet</p>
                    ) : (
                      <table className="mt-2.5 w-full max-w-[480px] border-collapse text-sm" aria-label={`Who worked on ${p.name}`}>
                        <thead>
                          <tr className="cap text-left text-2xs text-muted">
                            <th scope="col" className="py-1.5 pr-2 font-medium">Person</th>
                            <th scope="col" className="py-1.5 pl-2 text-right font-medium">Hours</th>
                          </tr>
                        </thead>
                        <tbody>
                          {m.byPerson.map((x) => (
                            <tr key={x.membershipId}>
                              <td className="border-t border-line py-1.5 pr-2">
                                <span className="inline-flex items-center gap-2">
                                  <Avatar name={x.name} initials={x.initials} size="sm" />
                                  {x.title ?? x.name}
                                </span>
                              </td>
                              <td className={cn("border-t border-line py-1.5 pl-2", num)}>{fmtHours(x.hours)} h</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          );
        })}
        <tbody>
          <tr className="bg-surface-2 font-semibold" data-testid="hours-total">
            <th scope="row" className="px-[18px] py-3 text-left">Total</th>
            <td className="num px-2.5 py-3 text-[12.5px]">
              {fmtHours(used)} / {fmtHours(budget)} h
            </td>
            <td className={cn("px-2.5 py-3", num)}>{moneyText(fee)}</td>
            <td className={cn("px-2.5 py-3", num)}>{moneyText(billed)}</td>
            <td className={cn("px-2.5 py-3", num, total.over && "text-red")}>{total.text}</td>
            <td className="py-3 pr-[18px]" />
          </tr>
        </tbody>
      </table>
      <LegendFooter />
    </section>
  );
}
