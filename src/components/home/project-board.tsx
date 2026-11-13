"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PlusIcon } from "@/components/ui/icons";
import { segmentClasses, segmentGroupClasses } from "@/components/ui/segmented";
import { billedText, boardColumns } from "@/lib/calc/home";
import { cn } from "@/lib/cn";
import { type ProjectsScope, readScope, saveScope, serverScope, subscribeScope } from "@/lib/home/scope";
import type { BoardView, HomeCard } from "@/server/home/home";

// Home → My projects (home spec, Layout 2, rules 1 and 6–8). A read-only
// board: one column per phase, cards link to the project. Owner/admin can
// switch between their own projects and the whole firm.

const SCOPES: { key: ProjectsScope; label: string }[] = [
  { key: "mine", label: "Mine" },
  { key: "all", label: "All firm" },
];

export function ProjectBoard({ board, canCreate }: { board: BoardView; canCreate: boolean }) {
  const saved = useSyncExternalStore(subscribeScope, readScope, serverScope);
  const scope = board.canToggle ? saved : "mine";
  const cards = scope === "all" ? board.cards : board.cards.filter((c) => c.mine);
  const columns = boardColumns(board.templates, cards);

  return (
    <section aria-labelledby="board-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 id="board-title" className="m-0 text-sm font-semibold">
          My projects
        </h2>
        {board.canToggle && (
          <div role="group" aria-label="Projects to show" className={segmentGroupClasses}>
            {SCOPES.map((s) => (
              <button
                key={s.key}
                type="button"
                aria-pressed={scope === s.key}
                className={segmentClasses(scope === s.key)}
                onClick={() => saveScope(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
        <Link href="/app/projects" className="ml-auto font-medium">
          All projects
        </Link>
      </div>

      {cards.length === 0 ? (
        <div className="rounded-sm border border-line bg-surface">
          {scope === "all" ? (
            <EmptyState
              title="No active projects."
              help="Create a project to start."
              action={
                canCreate && (
                  <Link href="/app/projects/new" className={buttonClasses("primary")}>
                    <PlusIcon className="size-4" />
                    New project
                  </Link>
                )
              }
            />
          ) : (
            <EmptyState
              title="No active projects for you."
              action={
                board.canToggle && (
                  <button type="button" className={buttonClasses("secondary")} onClick={() => saveScope("all")}>
                    Show all firm projects
                  </button>
                )
              }
            />
          )}
        </div>
      ) : (
        <div className="overflow-x-auto pb-1">
          <div className="grid auto-cols-[minmax(176px,1fr)] grid-flow-col gap-2.5">
            {columns.map((col) => (
              <div
                key={col.key}
                data-testid={`column-${col.key}`}
                className="flex min-h-[150px] flex-col gap-2 rounded-sm bg-track p-2"
              >
                <div className="flex items-center gap-1.5 px-0.5 pt-0.5 pb-1">
                  <h3 className="cap m-0 text-2xs font-semibold text-ink-2">{col.name}</h3>
                  <span className="num text-xs text-muted">{col.cards.length}</span>
                </div>
                {col.cards.map((c) => (
                  <ProjectCard key={c.id} card={c} showPhase={col.other} />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function ProjectCard({ card, showPhase }: { card: HomeCard; showPhase: boolean }) {
  return (
    <Link
      href={`/app/projects/${card.id}`}
      className="flex flex-col gap-2 rounded-sm border border-line bg-surface px-3 pt-2.5 pb-3 text-ink no-underline shadow-[0_1px_2px_rgba(28,31,35,0.06)] hover:border-line-strong"
    >
      <div>
        <div className="leading-[1.3] font-semibold">{card.name}</div>
        <div className="mt-0.5 text-xs text-muted">{card.kindLine}</div>
        {(card.onHold || (showPhase && card.phaseName)) && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {card.onHold && <Badge>On hold</Badge>}
            {showPhase && card.phaseName && <Badge className="num normal-case">{card.phaseName}</Badge>}
          </div>
        )}
      </div>
      <div className="flex items-start gap-2">
        {card.pm && <Avatar name={card.pm.name} initials={card.pm.initials} size="xs" />}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <CardBar
            label="Hours used"
            value={card.hours.value}
            max={card.hours.max}
            over={card.hours.over}
            text={card.hours.text}
          />
          {card.billedPct !== undefined && (
            <CardBar label="Billed" value={card.billedPct} max={card.billedPct === null ? null : 100} over={false} text={billedText(card.billedPct)} />
          )}
        </div>
      </div>
    </Link>
  );
}

/** 5px bar plus mono text; no bar when there's nothing to measure against. */
function CardBar({ label, value, max, over, text }: { label: string; value: number | null; max: number | null; over: boolean; text: string }) {
  const width = value !== null && max ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      {value !== null && max !== null && (
        <span
          role="img"
          aria-label={`${label}: ${text}`}
          className="block h-[5px] flex-1 overflow-hidden rounded-[3px] bg-track"
        >
          <span className={cn("block h-full", over ? "bg-red" : "bg-blue")} style={{ width: `${width}%` }} />
        </span>
      )}
      <span className={cn("num text-2xs whitespace-nowrap", over ? "text-red" : "text-ink-2", value === null && "flex-1")}>{text}</span>
    </div>
  );
}
