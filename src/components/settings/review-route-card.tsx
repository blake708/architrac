"use client";

import { Fragment, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { ChevronDownIcon, ChevronUpIcon, CloseIcon, PlusIcon } from "@/components/ui/icons";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { REVIEW_STEP_KINDS, ROUTE_MESSAGES, type ReviewStepKind, STEP_LABELS } from "@/lib/calc/review-route";
import { type ReviewRouteView, type RouteStepInput, STEP_NOTES, routeProblem } from "@/lib/settings/review-route";
import { saveReviewRoute } from "@/server/settings/actions";
import { ErrorBanner } from "./error-banner";

/**
 * Settings → Time & approvals → "Approval route" (timesheet-approval spec,
 * decision #23). The firm's review steps, in order. Every change saves the
 * whole route straight away, through the section's save queue.
 */
export function ReviewRouteCard({
  initial,
  save,
}: {
  initial: ReviewRouteView;
  save: (fn: () => Promise<boolean>) => Promise<void>;
}) {
  // A named-person step added from the menu waits here until someone is picked.
  const [steps, setStepsState] = useState<RouteStepInput[]>(initial.steps);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(initial.steps);
  const people = initial.people;
  const nameOf = (id: string | null) => people.find((p) => p.membershipId === id)?.name ?? "Pick a person";

  function setSteps(next: RouteStepInput[]) {
    latest.current = next;
    setStepsState(next);
  }

  function change(next: RouteStepInput[]) {
    setSteps(next);
    setError(null);
    // An unpicked person step isn't saved until a person is chosen.
    if (next.some((s) => s.kind === "person" && !s.membershipId)) return;
    const problem = routeProblem(next);
    if (problem) {
      setError(problem);
      return;
    }
    void save(async () => {
      const result = await saveReviewRoute({ steps: latest.current });
      if (!result.ok) {
        setError(result.error ?? "Couldn't save. Try again.");
        return false;
      }
      return true;
    });
  }

  const move = (i: number, by: -1 | 1) => {
    const next = [...steps];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    change(next);
  };
  const remove = (i: number) => change(steps.filter((_, j) => j !== i));
  const add = (kind: ReviewStepKind) => change([...steps, { kind, membershipId: null }]);
  const onRoute = new Set(steps.filter((s) => s.kind !== "person").map((s) => s.kind));
  const label = (s: RouteStepInput) => (s.kind === "person" ? nameOf(s.membershipId) : STEP_LABELS[s.kind]);

  const iconBtn =
    "inline-flex size-8 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent text-muted hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-2 focus-visible:outline-blue [&>svg]:size-4";

  return (
    <section aria-labelledby="route-title" className="rounded-sm border border-line bg-surface px-6 pt-5 pb-6">
      <h2 id="route-title" className="m-0 mb-1.5 text-sm font-semibold">
        Approval route
      </h2>
      <p className="m-0 mb-4 max-w-[720px] text-[12.5px] leading-normal text-muted">
        Who checks each timesheet, in order. Steps with nobody to fill them are skipped. Principals&apos; own timesheets
        are approved when they submit.
      </p>
      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      {/* Route strip, as in the mockup. */}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm" aria-label="Route" role="group">
        <span className="rounded-sm bg-line-soft px-3 py-1.5">Submitted</span>
        {steps.map((s, i) => (
          <Fragment key={i}>
            <Arrow />
            <span className="rounded-sm bg-blue-tint px-3 py-1.5 text-blue-strong">{label(s)}</span>
          </Fragment>
        ))}
        <Arrow />
        <span className="rounded-sm bg-green-tint px-3 py-1.5 text-green">Approved</span>
      </div>

      <ol className="m-0 flex list-none flex-col p-0" data-testid="route-steps">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-3 border-t border-line-soft py-3 first:border-t-0">
            <span className="mt-1 w-5 shrink-0 font-mono text-sm text-muted">{i + 1}</span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {s.kind === "person" ? (
                <Select
                  aria-label={`Step ${i + 1} person`}
                  wrapperClassName="max-w-[320px]"
                  value={s.membershipId ?? ""}
                  onChange={(e) =>
                    change(steps.map((x, j) => (j === i ? { ...x, membershipId: e.target.value || null } : x)))
                  }
                >
                  <option value="">Pick a person…</option>
                  {people.map((p) => (
                    <option
                      key={p.membershipId}
                      value={p.membershipId}
                      disabled={p.membershipId !== s.membershipId && steps.some((x) => x.membershipId === p.membershipId)}
                    >
                      {p.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <span className="text-sm font-medium">{STEP_LABELS[s.kind]}</span>
              )}
              <span className="text-[12.5px] text-muted">{STEP_NOTES[s.kind]}</span>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <button type="button" className={iconBtn} aria-label={`Move ${label(s)} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                <ChevronUpIcon />
              </button>
              <button
                type="button"
                className={iconBtn}
                aria-label={`Move ${label(s)} down`}
                disabled={i === steps.length - 1}
                onClick={() => move(i, 1)}
              >
                <ChevronDownIcon />
              </button>
              <button
                type="button"
                className={iconBtn}
                aria-label={`Remove ${label(s)}`}
                title={steps.length === 1 ? ROUTE_MESSAGES.needsStep : undefined}
                disabled={steps.length === 1}
                onClick={() => remove(i)}
              >
                <CloseIcon />
              </button>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-3">
        <Menu>
          <MenuTrigger asChild>
            <Button icon={<PlusIcon />}>Add step</Button>
          </MenuTrigger>
          <MenuContent align="start">
            {REVIEW_STEP_KINDS.map((k) => (
              <MenuItem key={k} onSelect={() => add(k)} disabled={k !== "person" && onRoute.has(k)}>
                {STEP_LABELS[k]}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      </div>
      <p className="m-0 mt-4 text-[12.5px] text-muted">
        Changes apply to timesheets submitted from now on. Timesheets already in review keep their route.
      </p>
    </section>
  );
}

function Arrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-faint">
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}
