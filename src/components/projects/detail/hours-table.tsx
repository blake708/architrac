"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ChevronDownIcon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/progress-bar";
import { cn } from "@/lib/cn";
import { progressStatus } from "@/lib/calc/progress";
import { fmtHours, remainingText } from "@/lib/calc/project-detail";
import type { PhaseRow } from "@/server/projects/page";
import { PHASE_STATUS } from "../project-bits";

const PCT_TONE = { normal: "text-ink-2", warning: "text-orange", over: "text-red" } as const;

const th = "cap border-b border-line px-2.5 py-2 text-left text-2xs font-medium text-muted first:pl-[18px] last:pr-[18px]";
const td = "border-b border-line-soft px-2.5 py-2.5 first:pl-[18px] last:pr-[18px]";

/** Hours vs budget (project-detail spec, Overview; rules 2–4). */
export function HoursTable({ projectId, phases }: { projectId: string; phases: PhaseRow[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const rows = phases.filter((p) => p.money);
  const used = rows.reduce((n, p) => n + p.money!.usedHours, 0);
  const budget = rows.reduce((n, p) => n + p.money!.budgetHours, 0);
  const total = remainingText(budget, used);
  return (
    <section aria-label="Hours vs budget" className="rounded-sm border border-line bg-surface">
      <header className="flex items-center px-[var(--spacing-card)] pt-4 pb-3">
        <h2 className="m-0 text-sm font-semibold">Hours vs budget</h2>
        <Link href={`/app/projects/${projectId}/phases`} className="ml-auto text-sm text-blue underline">
          Phases &amp; fees
        </Link>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead className="bg-surface-2">
            <tr>
              <th scope="col" className={th}>Phase</th>
              <th scope="col" className={th}>Hours used / budget</th>
              <th scope="col" className={cn(th, "text-right")}>Remaining</th>
              <th scope="col" className={cn(th, "text-right")}>% complete</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const m = p.money!;
              const left = remainingText(m.budgetHours, m.usedHours);
              const expanded = open.has(p.id);
              const over = Math.max(0, m.usedHours - m.budgetHours);
              return (
                <Fragment key={p.id}>
                  <tr data-phase={p.code}>
                    <td className={td}>
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-label={`${expanded ? "Hide" : "Show"} hours by person for ${p.name}`}
                        onClick={() =>
                          setOpen((s) => {
                            const n = new Set(s);
                            if (n.has(p.id)) n.delete(p.id);
                            else n.add(p.id);
                            return n;
                          })
                        }
                        className="mr-1.5 inline-flex size-5 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent align-middle hover:bg-surface-2"
                      >
                        <ChevronDownIcon className={cn("size-3.5 transition-transform", !expanded && "-rotate-90")} />
                      </button>
                      <span className="font-medium">{p.name}</span>{" "}
                      <Badge tone={PHASE_STATUS[p.status].tone}>{PHASE_STATUS[p.status].label}</Badge>
                    </td>
                    <td className={td}>
                      {m.feeType === "hourly" ? (
                        // Hourly phases are billed by the hour: no bar, just hours.
                        <span className="num text-xs text-ink-2">{fmtHours(m.usedHours)} h</span>
                      ) : (
                        // Fixed slots (bar · % · hours) so every row lines up.
                        <span className="grid grid-cols-[230px_40px_auto] items-center gap-3">
                          <ProgressBar
                            value={m.usedHours}
                            max={m.budgetHours}
                            label={`${p.name}: ${fmtHours(m.usedHours)} of ${fmtHours(m.budgetHours)} budgeted hours${over ? `, ${fmtHours(over)} over` : ""}`}
                          />
                          <span className={cn("num text-right text-xs", PCT_TONE[progressStatus(m.usedHours, m.budgetHours).tone])}>
                            {m.budgetHours > 0 ? `${progressStatus(m.usedHours, m.budgetHours).percent}%` : ""}
                          </span>
                          <span className="num text-xs whitespace-nowrap text-ink-2">
                            {fmtHours(m.usedHours)} / {fmtHours(m.budgetHours)} h
                          </span>
                        </span>
                      )}
                    </td>
                    <td className={cn(td, "num text-right", m.feeType !== "hourly" && left.over && "text-red")}>
                      {m.feeType === "hourly" ? <span className="cap text-2xs font-medium text-muted">Hourly</span> : left.text}
                    </td>
                    <td className={cn(td, "num text-right")}>{m.feeType === "fixed" ? `${m.percentCompleteBp / 100}%` : "—"}</td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td colSpan={4} className="border-b border-line-soft bg-surface-2 px-[18px] py-2">
                        {m.byPerson.length === 0 ? (
                          <p className="m-0 py-1 pl-7 text-sm text-muted">No time logged yet</p>
                        ) : (
                          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 pl-7 text-sm">
                            {m.byPerson.map((x) => (
                              <li key={x.membershipId} className="flex items-center gap-2">
                                <Avatar name={x.name} initials={x.initials} size="sm" />
                                <span>{x.title ?? x.name}</span>
                                <span className="num ml-auto">{fmtHours(x.hours)} h</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="px-2.5 py-2.5 pl-[18px]">Total</td>
              <td className="num px-2.5 py-2.5">
                {fmtHours(used)} / {fmtHours(budget)} h
              </td>
              <td className={cn("num px-2.5 py-2.5 text-right", total.over && "text-red")}>{total.text}</td>
              <td className="px-2.5 py-2.5 pr-[18px]" />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
