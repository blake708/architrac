"use client";

import { useRef, useState } from "react";
import { Select } from "@/components/ui/field";
import {
  DUE_TIMES,
  type TimesheetRules,
  dueDayOptions,
  dueExample,
} from "@/lib/settings/timesheet-rules";
import { saveTimesheetRules } from "@/server/settings/actions";
import { ErrorBanner } from "./error-banner";

/**
 * Settings → Time & approvals → "Timesheets" (decisions #17, #21). Each
 * change saves straight away, through the section's save queue.
 */
export function TimesheetRulesCard({
  initial,
  weekStartsOn,
  exampleWeek,
  save,
}: {
  initial: TimesheetRules;
  weekStartsOn: number;
  /** This week's start, for the example line. */
  exampleWeek: string;
  save: (fn: () => Promise<boolean>) => Promise<void>;
}) {
  const [rules, setRulesState] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(initial);

  function change(patch: Partial<TimesheetRules>) {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setRulesState(next);
    setError(null);
    void save(async () => {
      const result = await saveTimesheetRules(latest.current);
      if (!result.ok) {
        setError(result.error ?? "Couldn't save. Try again.");
        return false;
      }
      return true;
    });
  }

  return (
    <section aria-labelledby="ts-rules-title" className="rounded-sm border border-line bg-surface px-6 pt-5 pb-6">
      <h2 id="ts-rules-title" className="m-0 mb-4 text-sm font-semibold">
        Timesheets
      </h2>
      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-x-5 gap-y-4">
        <Select label="Due day" value={rules.lockDay} onChange={(e) => change({ lockDay: Number(e.target.value) })}>
          {dueDayOptions(weekStartsOn).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Select label="Due time" value={rules.dueTime} onChange={(e) => change({ dueTime: e.target.value })}>
          {DUE_TIMES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
        <Select
          label="Notes on billable time"
          value={rules.billableNotesRequired ? "required" : "optional"}
          onChange={(e) => change({ billableNotesRequired: e.target.value === "required" })}
          hint={
            rules.billableNotesRequired
              ? "Timesheets can't be submitted until every billable day with hours has a note."
              : "People can add a note to any day with hours."
          }
        >
          <option value="optional">Optional</option>
          <option value="required">Required</option>
        </Select>
      </div>
      <p className="m-0 mt-4 text-[12.5px] text-muted" data-testid="due-example">
        {dueExample(exampleWeek, rules)}
      </p>
    </section>
  );
}
