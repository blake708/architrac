"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { CloseIcon } from "@/components/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/components/ui/toast";
import {
  DAYS_IN_WEEK,
  HOURS_INPUT_ERROR,
  MAX_DAY_HOURS,
  NOTE_MAX,
  billableNote,
  cleanNote,
  dayLimitMessage,
  needsNote,
  parseHoursInput,
  rowTotal,
  shortDays,
  submitProblems,
  weekTotals,
} from "@/lib/calc/timesheet";
import { cn } from "@/lib/cn";
import { formatHours } from "@/lib/format";
import { dayHeader, returnedLine, statusView, weekTitle } from "@/lib/time/display";
import {
  addRow,
  copyLastWeek,
  recallTimesheet,
  removeRow,
  setHours,
  setNote,
  submitTimesheet,
  updateRow,
} from "@/server/time/actions";
import type { TimeResult } from "@/server/time/write";
import type { TimesheetView, ViewRow } from "@/server/time/week";
import { TimeHeader, WeekNav } from "./time-header";

// My timesheet (timesheet spec, Layout 4–7 and rule 17). The page keeps the
// week in state and changes it at once; every write goes through one queue,
// in order, and the server's answer replaces the state once the queue is empty.

type Op = {
  run: () => Promise<TimeResult>;
  /** After the server answers (ok or refused). */
  then?: (r: TimeResult) => void;
};
type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: Date } | { kind: "retrying" } | { kind: "failed" };

const RETRY_DELAYS = [1000, 3000, 9000];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The write queue: one at a time, retries on network failure (rule 17). */
function useWriteQueue(onResult: (r: TimeResult, last: boolean) => void) {
  const queue = useRef<Op[]>([]);
  const busy = useRef(false);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [pending, setPending] = useState(0);
  const resultRef = useRef(onResult);
  useEffect(() => {
    resultRef.current = onResult;
  }, [onResult]);

  const pump = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    while (queue.current.length) {
      const op = queue.current[0];
      setSave({ kind: "saving" });
      let result: TimeResult | null = null;
      for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
        try {
          result = await op.run();
          break;
        } catch {
          if (attempt === RETRY_DELAYS.length) break;
          setSave({ kind: "retrying" });
          await wait(RETRY_DELAYS[attempt]);
        }
      }
      if (!result) {
        // Stop here; Retry starts again from this write.
        setSave({ kind: "failed" });
        busy.current = false;
        return;
      }
      queue.current.shift();
      setPending(queue.current.length);
      resultRef.current(result, queue.current.length === 0);
      op.then?.(result);
    }
    setSave({ kind: "saved", at: new Date() });
    busy.current = false;
  }, []);

  const push = useCallback(
    (op: Op) => {
      queue.current.push(op);
      setPending(queue.current.length);
      void pump();
    },
    [pump],
  );

  // Leaving with unsaved writes asks first.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (queue.current.length) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  return { push, retry: pump, save, pending };
}

function SaveIndicator({ save, onRetry }: { save: SaveState; onRetry: () => void }) {
  const text =
    save.kind === "saving"
      ? "Saving…"
      : save.kind === "saved"
        ? `Saved ${save.at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
        : save.kind === "retrying"
          ? "Couldn't save. Retrying…"
          : save.kind === "failed"
            ? "Couldn't save. Check your connection."
            : "";
  const bad = save.kind === "retrying" || save.kind === "failed";
  return (
    <span role="status" className={cn("text-[12.5px]", bad ? "font-medium text-orange-strong" : "text-muted")}>
      {text}
      {save.kind === "failed" && (
        <button type="button" onClick={onRetry} className="ml-2 cursor-pointer border-0 bg-transparent p-0 text-[12.5px] font-semibold text-ink underline">
          Retry
        </button>
      )}
    </span>
  );
}

function StatusBadge({ look, tone, children }: { look: string; tone: string; children: string }) {
  const color = { neutral: "bg-line-soft text-ink-2", blue: "bg-blue-tint text-blue-strong", green: "bg-green-tint text-green", orange: "bg-orange-tint text-orange-strong" }[tone];
  const dot = {
    hollow: "rounded-full ring-[1.5px] ring-ink-3 ring-inset",
    half: "rounded-full bg-[linear-gradient(90deg,var(--color-blue)_50%,transparent_50%)] ring-[1.5px] ring-blue ring-inset",
    filled: "rounded-full bg-green",
    diamond: "rotate-45 bg-orange",
  }[look];
  return (
    <span className={cn("cap inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-2xs font-semibold", color)}>
      <span aria-hidden="true" className={cn("size-[7px] shrink-0", dot)} />
      {children}
    </span>
  );
}

/** Shared select look; height and text size are added per use (cn doesn't merge). */
const selectFrame =
  "w-full cursor-pointer rounded-sm border bg-surface px-1.5 focus-visible:outline-2 focus-visible:outline-blue disabled:cursor-not-allowed disabled:bg-surface-2";
const selectBase = `${selectFrame} h-[30px] text-[12.5px]`;
const selectTone = (empty: boolean) => (empty ? "border-orange text-orange-strong" : "border-line-input text-ink");

/** First line of a set row: number + name. */
function rowTitle(r: ViewRow) {
  if (r.rowType === "project") return { code: r.projectNumber ?? "", name: r.projectName ?? "Project" };
  if (r.rowType === "overhead") return { code: "OH", name: "Overhead" };
  return { code: "LEAVE", name: r.categoryName ?? "Leave" };
}

export function TimesheetPage({
  initial,
  historyCount,
  approvalsCount = null,
}: {
  initial: TimesheetView;
  historyCount: number;
  approvalsCount?: number | null;
}) {
  const toast = useToast();
  const [view, setView] = useState(initial);
  const [confirmRemove, setConfirmRemove] = useState<ViewRow | null>(null);
  const focusNewRow = useRef(false);
  const tableRef = useRef<HTMLTableElement>(null);

  const onResult = useCallback(
    (r: TimeResult, last: boolean) => {
      if (!r.ok) toast(r.error, "error");
      // A refusal returns the week as it is, so the page puts back what it showed.
      if (r.data && (last || !r.ok)) setView(r.data);
    },
    [toast],
  );
  const { push, retry, save, pending } = useWriteQueue(onResult);

  // Focus the new row's project picker after Add row.
  useEffect(() => {
    if (!focusNewRow.current) return;
    focusNewRow.current = false;
    const selects = tableRef.current?.querySelectorAll<HTMLSelectElement>("select[data-new-row]");
    selects?.[selects.length - 1]?.focus();
  }, [view.rows.length]);

  const patchRow = (id: string, patch: Partial<ViewRow>) =>
    setView((v) => ({ ...v, rows: v.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));

  const editable = view.editable;
  const totals = weekTotals(view.rows, view.targetHours);
  const short = shortDays(view.dates, totals.dayTotals, view.targetHours);
  const problems = submitProblems(view.rows, {
    dates: view.dates,
    today: view.today,
    notesRule: view.notesRule,
  });
  const status = statusView(view);
  const blocked = problems.length > 0 || pending > 0;

  // ---------- Actions ----------

  const onAddRow = () => {
    focusNewRow.current = true;
    push({ run: () => addRow({ weekStart: view.weekStart }) });
  };

  const onPick = (row: ViewRow, value: string) => {
    if (!value) return;
    const pick =
      value === "overhead"
        ? { kind: "overhead" as const }
        : value.startsWith("leave:")
          ? { kind: "leave" as const, categoryId: value.slice(6) }
          : { kind: "project" as const, projectId: value.slice(8) };
    push({ run: () => updateRow({ rowId: row.id, change: { type: "pick", pick } }) });
  };

  const onPhase = (row: ViewRow, id: string) => {
    const value = id || null;
    if (row.rowType === "project") patchRow(row.id, { projectPhaseId: value });
    else patchRow(row.id, { overheadCategoryId: value, activityId: null });
    push({ run: () => updateRow({ rowId: row.id, change: { type: "phase", id: value } }) });
  };

  const onActivity = (row: ViewRow, id: string) => {
    patchRow(row.id, { activityId: id || null });
    push({ run: () => updateRow({ rowId: row.id, change: { type: "activity", id: id || null } }) });
  };

  const onBillable = (row: ViewRow) => {
    patchRow(row.id, { billable: !row.billable });
    push({ run: () => updateRow({ rowId: row.id, change: { type: "billable", value: !row.billable } }) });
  };

  /** Save a day's hours (rules 6–8). Returns false when refused here. */
  const commitHours = (row: ViewRow, day: number, hours: number) => {
    if (row.hours[day] === hours) return true;
    const others = view.rows.reduce((a, r) => a + (r.id === row.id ? 0 : r.hours[day]), 0);
    if (others + hours > MAX_DAY_HOURS) {
      toast(dayLimitMessage(view.dates[day], others + hours), "error");
      return false;
    }
    patchRow(row.id, {
      hours: row.hours.map((h, i) => (i === day ? hours : h)),
      // Clearing a day clears its note with it.
      ...(hours ? {} : { notes: row.notes.map((n, i) => (i === day ? null : n)) }),
    });
    const workDate = view.dates[day];
    push({ run: () => setHours({ rowId: row.id, workDate, hours: hours || null }) });
    return true;
  };

  const commitNote = (row: ViewRow, day: number, text: string) => {
    const note = cleanNote(text);
    if ((row.notes[day] ?? null) === note) return;
    patchRow(row.id, { notes: row.notes.map((n, i) => (i === day ? note : n)) });
    const workDate = view.dates[day];
    push({ run: () => setNote({ rowId: row.id, workDate, note }) });
  };

  const onCopy = () =>
    push({
      run: () => copyLastWeek({ weekStart: view.weekStart }),
      then: (r) => {
        if (r.ok && r.message) toast(r.message);
      },
    });

  const doRemove = (row: ViewRow) => {
    setView((v) => ({ ...v, rows: v.rows.filter((r) => r.id !== row.id) }));
    push({ run: () => removeRow({ rowId: row.id }) });
  };

  const onSubmit = () => {
    if (blocked) return;
    push({
      run: () => submitTimesheet({ weekStart: view.weekStart }),
      then: (r) => r.ok && toast("Timesheet submitted."),
    });
  };
  const onRecall = () => push({ run: () => recallTimesheet({ weekStart: view.weekStart }) });

  // ---------- Options ----------

  const o = view.options;
  const projectOptions = (
    <>
      <option value="">Choose a project…</option>
      {o.myProjects.length > 0 && (
        <optgroup label="My projects">
          {o.myProjects.map((p) => (
            <option key={p.id} value={`project:${p.id}`}>
              {p.label}
            </option>
          ))}
        </optgroup>
      )}
      {o.otherProjects.length > 0 && (
        <optgroup label="Other active projects">
          {o.otherProjects.map((p) => (
            <option key={p.id} value={`project:${p.id}`}>
              {p.label}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label="Overhead">
        <option value="overhead">OH · Overhead</option>
      </optgroup>
      {o.leave.length > 0 && (
        <optgroup label="Leave">
          {o.leave.map((c) => (
            <option key={c.id} value={`leave:${c.id}`}>
              {c.name}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );

  function phaseSelect(row: ViewRow, title: string) {
    if (row.rowType === "leave")
      return (
        <select aria-label={`Phase for ${title}`} disabled className={cn(selectBase, selectTone(false))}>
          <option>Leave</option>
        </select>
      );
    const value = (row.rowType === "project" ? row.projectPhaseId : row.overheadCategoryId) ?? "";
    const options =
      row.rowType === "project"
        ? (o.phases[row.projectId ?? ""] ?? []).map((p) => ({ id: p.id, label: p.label, disabled: p.closed && p.id !== value }))
        : o.overhead.map((c) => ({ id: c.id, label: c.name, disabled: false }));
    if (row.rowType === "overhead" && value && !options.some((x) => x.id === value))
      options.push({ id: value, label: `${row.categoryName} · inactive`, disabled: true });
    return (
      <select
        aria-label={`Phase for ${title}`}
        value={value}
        onChange={(e) => onPhase(row, e.target.value)}
        className={cn(selectBase, selectTone(!value))}
      >
        <option value="">Phase…</option>
        {options.map((x) => (
          <option key={x.id} value={x.id} disabled={x.disabled}>
            {x.label}
          </option>
        ))}
      </select>
    );
  }

  function activitySelect(row: ViewRow, title: string) {
    const list =
      row.rowType === "project"
        ? o.projectActivities
        : [...o.overhead, ...o.leave].find((c) => c.id === row.overheadCategoryId)?.activities ?? [];
    const noCategory = row.rowType !== "project" && !row.overheadCategoryId;
    const value = row.activityId ?? "";
    const options = [...list];
    if (value && !options.some((a) => a.id === value)) options.push({ id: value, name: `${row.activityName} · inactive` });
    return (
      <select
        aria-label={`Activity for ${title}`}
        value={value}
        disabled={noCategory}
        onChange={(e) => onActivity(row, e.target.value)}
        className={cn(selectBase, selectTone(!value))}
      >
        <option value="">{noCategory ? "Pick a phase first" : "Activity…"}</option>
        {options.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    );
  }

  const days = view.dates.map((d) => ({ iso: d, ...dayHeader(d), weekend: [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()) }));
  // Padding and alignment are set per cell (cn joins classes, it doesn't merge them).
  const th = "border-b border-line py-2.5 text-2xs font-medium text-muted";
  const td = "border-b border-line-soft py-2.5 align-top";
  const hasRows = view.rows.length > 0;

  return (
    <main>
      <TimeHeader view={view} tab="mine" historyCount={historyCount} approvalsCount={approvalsCount} />
      <div className="flex flex-col gap-4 px-4 pt-7 pb-8 md:px-page-x">
        {/* Week heading */}
        <h2 className="m-0 text-xl leading-tight font-semibold">{weekTitle(view.weekStart)}</h2>

        {/* Status bar */}
        <div className="flex flex-wrap items-center gap-2.5">
          <StatusBadge look={status.look} tone={status.tone}>
            {status.label}
          </StatusBadge>
          {view.late && (
            <span className="cap text-2xs font-semibold text-orange-strong">Late</span>
          )}
          <span className="text-[12.5px] text-muted">{status.note}</span>
          <SaveIndicator save={save} onRetry={() => void retry()} />
          <div className="ml-auto">
            <WeekNav view={view} />
          </div>
        </div>

        {view.status === "rejected" && (
          <div className="rounded-sm border border-orange bg-orange-tint px-4 py-3 text-sm text-orange-strong">
            <p className="m-0 font-semibold">{returnedLine(view.rejectedBy, view.rejectedAt, view.rejectionNote, view.timezone)}</p>
            <p className="m-0 mt-1">Fix the rows below and resubmit.</p>
          </div>
        )}

        {view.invoiced.length > 0 && (
          <p className="m-0 flex items-center gap-2 text-[12.5px] text-muted" data-testid="invoiced">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            Locked: {view.invoiced.join(" · ")}. Billed time can&apos;t change.
          </p>
        )}

        {/* Weekly grid */}
        <section aria-label="Weekly timesheet" className="overflow-x-auto rounded-sm border border-line bg-surface">
          <table ref={tableRef} className="w-full min-w-[960px] table-fixed border-collapse">
            <thead>
              <tr className="bg-surface-2">
                <th scope="col" className={cn(th, "pr-2 pl-5 text-left")}>Project · phase · activity</th>
                <th scope="col" className={cn(th, "w-[104px] px-2 text-left")}>Billing</th>
                {days.map((d) => (
                  <th key={d.iso} scope="col" className={cn(th, "w-[58px] px-0 text-center")}>
                    <span className="block">{d.dow}</span>
                    <span className="num block text-2xs font-normal tracking-normal normal-case">{d.date}</span>
                  </th>
                ))}
                <th scope="col" className={cn(th, "w-[76px] pr-3 pl-2 text-right")}>Total</th>
                <th scope="col" className={cn(th, "w-[44px] px-2")}>
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {!hasRows && (
                <tr>
                  <td colSpan={DAYS_IN_WEEK + 4} className="px-5 py-10 text-center">
                    <p className="m-0 font-semibold">No time this week yet</p>
                    <p className="m-0 mt-1 text-sm text-muted">
                      {editable ? "Add a row, or copy last week's rows." : "Nothing was logged this week."}
                    </p>
                    {editable && (
                      <div className="mt-3 flex justify-center gap-2">
                        <Button variant="primary" onClick={onAddRow}>
                          Add row
                        </Button>
                        <Button onClick={onCopy}>Copy last week</Button>
                      </div>
                    )}
                  </td>
                </tr>
              )}
              {view.rows.map((row) => {
                const t = rowTitle(row);
                const title = row.rowType === "project" ? `${t.code} ${t.name}` : t.name;
                const total = rowTotal(row);
                return (
                  <tr key={row.id}>
                    <td className={cn(td, "pr-2 pl-5")}>
                      {!row.rowType ? (
                        editable ? (
                          <label className="flex flex-col">
                            <span className="sr-only">Project for new row</span>
                            <select
                              data-new-row
                              value=""
                              onChange={(e) => onPick(row, e.target.value)}
                              className={cn(selectFrame, "h-[34px] border-line-input text-sm")}
                            >
                              {projectOptions}
                            </select>
                          </label>
                        ) : (
                          <span className="text-muted">Not chosen</span>
                        )
                      ) : (
                        <span className="flex flex-col gap-1.5">
                          <span className="truncate font-semibold">
                            <span className="num mr-1.5 text-xs font-medium text-ink-3">{t.code}</span>
                            {t.name}
                          </span>
                          {editable ? (
                            <span className="flex flex-nowrap gap-1.5">
                              <span className="flex min-w-[150px] max-w-[450px] flex-[1_1_450px]">{phaseSelect(row, title)}</span>
                              <span className="flex min-w-[120px] max-w-[300px] flex-[1_1_300px]">{activitySelect(row, title)}</span>
                            </span>
                          ) : (
                            <span className="text-[12.5px] text-muted">
                              {[row.rowType === "project" ? row.phaseName : row.rowType === "overhead" ? row.categoryName : "Leave", row.activityName]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className={cn(td, "px-2")}>
                      {row.rowType && (
                        <button
                          type="button"
                          onClick={() => onBillable(row)}
                          disabled={!editable || row.rowType !== "project"}
                          aria-label={`${row.billable ? "Billable" : "Non-billable"}, select to change`}
                          className={cn(
                            "cap inline-flex cursor-pointer items-center gap-1.5 rounded-sm border-0 px-2 py-1 text-2xs font-semibold whitespace-nowrap disabled:cursor-default",
                            row.billable ? "bg-blue-tint text-blue-strong" : "bg-line-soft text-ink-3",
                          )}
                        >
                          <span aria-hidden="true" className={cn("size-[7px] rounded-full", row.billable ? "bg-blue" : "ring-[1.5px] ring-ink-3 ring-inset")} />
                          {row.billable ? "Billable" : "Non-bill."}
                        </button>
                      )}
                    </td>
                    {days.map((d, i) => (
                      <td key={d.iso} className={cn(td, "px-0 text-center", d.weekend && "bg-surface-2")}>
                        <HoursCell
                          value={row.hours[i]}
                          label={`${title}, ${d.dow} ${d.date}`}
                          disabled={!row.rowType}
                          readOnly={!editable}
                          onCommit={(h) => commitHours(row, i, h)}
                          onInvalid={() => toast(HOURS_INPUT_ERROR, "error")}
                        />
                        <NoteButton
                          note={row.notes[i]}
                          show={row.hours[i] > 0 && (editable || !!row.notes[i])}
                          day={`${d.dow} ${d.date}`}
                          title={title}
                          readOnly={!editable}
                          missing={needsNote(row, i, view.notesRule)}
                          onSave={(text) => commitNote(row, i, text)}
                        />
                      </td>
                    ))}
                    <td className={cn(td, "num pr-3 pl-2 text-right text-[13px] font-semibold")}>{formatHours(total)}</td>
                    <td className={cn(td, "pr-4 pl-2 text-right")}>
                      {editable && (
                        <button
                          type="button"
                          aria-label={`Remove row ${row.rowType ? title : "(not chosen)"}`}
                          onClick={() => (total > 0 ? setConfirmRemove(row) : doRemove(row))}
                          className="inline-flex size-[30px] cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent text-faint hover:bg-line-soft hover:text-ink"
                        >
                          <CloseIcon className="size-[15px]" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr className="bg-surface-2">
                <td colSpan={2} className="px-5 py-3 font-semibold">
                  Day total
                </td>
                {totals.dayTotals.map((v, i) => (
                  <td
                    key={view.dates[i]}
                    className={cn("num py-3 text-center text-[13px]", short[i] ? "font-semibold text-orange-strong shadow-[inset_0_-3px_0_var(--color-orange)]" : "text-ink")}
                    data-short={short[i] ? "true" : undefined}
                  >
                    {formatHours(v)}
                  </td>
                ))}
                <td className="num py-3 pr-3 text-right text-sm font-bold">{formatHours(totals.weekTotal)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </section>

        {/* Row actions (left) and submit (right) */}
        {(editable || view.canRecall) && (
          <div className="flex flex-wrap items-center gap-2">
            {/* An empty week already shows these inside the grid. */}
            {editable && hasRows && (
              <>
                <Button onClick={onCopy}>Copy last week</Button>
                <Button onClick={onAddRow}>Add row</Button>
              </>
            )}
            <div className="ml-auto flex flex-wrap gap-2">
              {view.canRecall && (
                <Button onClick={onRecall} disabled={pending > 0}>
                  Recall timesheet
                </Button>
              )}
              {editable && (
                <button
                  type="button"
                  onClick={onSubmit}
                  aria-disabled={blocked ? "true" : undefined}
                  className={cn(
                    "inline-flex h-[var(--height-control)] items-center rounded-sm border px-3.5 text-base font-medium whitespace-nowrap",
                    blocked ? "cursor-not-allowed border-line-strong bg-line-strong text-white" : "cursor-pointer border-ink bg-ink text-white hover:bg-ink-2",
                  )}
                >
                  {view.isPrincipal ? (view.status === "rejected" ? "Resubmit and approve" : "Submit and approve") : view.status === "rejected" ? "Resubmit" : "Submit for approval"}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex flex-wrap items-center gap-4 rounded-sm border border-line bg-surface px-5 py-4">
          <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-2">
            <div className="flex flex-wrap items-baseline gap-2.5">
              <span className="cap text-xs font-semibold">Week total</span>
              <span className="num text-sm font-semibold">
                {formatHours(totals.weekTotal)} / {formatHours(view.targetHours)} h
              </span>
              <span className="text-[12.5px] text-muted">{billableNote(totals)}</span>
            </div>
            <span
              role="img"
              aria-label={`${formatHours(totals.weekTotal)} of ${formatHours(view.targetHours)} hours, ${formatHours(totals.billable)} billable`}
              className="relative block h-2.5 overflow-hidden rounded-[1px] bg-line-soft"
            >
              <span className="absolute inset-y-0 left-0 bg-blue" style={{ width: `${totals.billableWidth}%` }} />
              <span className="absolute inset-y-0 bg-[#A9BDE3]" style={{ left: `${totals.billableWidth}%`, width: `${totals.nonBillableWidth}%` }} />
            </span>
            <div className="flex flex-wrap gap-4 text-xs text-ink-3">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="h-2 w-3 bg-blue" />
                Billable
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="h-2 w-3 bg-[#A9BDE3]" />
                Non-billable
              </span>
            </div>
            {editable && problems.length > 0 && (
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-orange-strong" data-testid="submit-blocker">
                <span aria-hidden="true" className="size-2 rotate-45 bg-orange" />
                {problems[0]}
              </span>
            )}
          </div>
        </div>
      </div>

      <Dialog open={confirmRemove !== null} onOpenChange={(open) => !open && setConfirmRemove(null)}>
        {confirmRemove && (
          <DialogContent
            title="Remove this row?"
            description={`Its ${formatHours(rowTotal(confirmRemove))} h will be deleted.`}
            footer={
              <>
                <DialogClose asChild>
                  <Button variant="ghost">Cancel</Button>
                </DialogClose>
                <Button
                  variant="danger"
                  onClick={() => {
                    doRemove(confirmRemove);
                    setConfirmRemove(null);
                  }}
                >
                  Remove row
                </Button>
              </>
            }
          />
        )}
      </Dialog>
    </main>
  );
}

/**
 * One day cell (rule 6). Saves 800 ms after the last keystroke and at once
 * on blur; rounding to the quarter hour happens on blur.
 */
function HoursCell({
  value,
  label,
  disabled,
  readOnly,
  onCommit,
  onInvalid,
}: {
  value: number;
  label: string;
  disabled: boolean;
  readOnly: boolean;
  onCommit: (hours: number) => boolean;
  onInvalid: () => void;
}) {
  const shown = value ? formatHours(value) : "";
  const [text, setText] = useState(shown);
  const [hint, setHint] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focused = useRef(false);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  // Show the saved value (or a refusal putting it back) unless they're typing here.
  useEffect(() => {
    if (!focused.current) setText(shown);
  }, [shown]);

  const commit = useMemo(
    () =>
      (raw: string, final: boolean) => {
        const parsed = parseHoursInput(raw);
        if (parsed.kind === "invalid") {
          if (final) {
            setInvalid(true);
            onInvalid();
          }
          return;
        }
        // While typing, only save values that need no rounding.
        if (!final && parsed.kind === "hours" && parsed.rounded) return;
        setInvalid(false);
        const hours = parsed.kind === "hours" ? parsed.hours : 0;
        if (!onCommit(hours)) {
          setText(shown);
          return;
        }
        if (final) {
          setText(hours ? formatHours(hours) : "");
          if (parsed.kind === "hours" && parsed.rounded) {
            setHint(`Rounded to ${formatHours(hours)}`);
            setTimeout(() => setHint(null), 3000);
          }
        }
      },
    [onCommit, onInvalid, shown],
  );

  if (readOnly)
    return (
      <span className="num inline-flex h-[34px] w-[52px] items-center justify-center text-[13px]" aria-label={label}>
        {shown || "—"}
      </span>
    );

  return (
    <span className="relative inline-flex flex-col items-center">
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        placeholder="—"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setInvalid(false);
          if (timer.current) clearTimeout(timer.current);
          const v = e.target.value;
          timer.current = setTimeout(() => commit(v, false), 800);
        }}
        onFocus={() => (focused.current = true)}
        onBlur={(e) => {
          focused.current = false;
          if (timer.current) clearTimeout(timer.current);
          commit(e.target.value, true);
        }}
        className={cn(
          "num h-[34px] w-[52px] rounded-sm border bg-surface text-center text-[13px] placeholder:text-faint focus-visible:outline-2 focus-visible:outline-blue disabled:cursor-not-allowed disabled:bg-surface-2",
          invalid ? "border-red text-red" : "border-line-input",
        )}
      />
      {hint && (
        <span role="status" className="absolute top-full z-10 mt-0.5 rounded-sm bg-surface px-1 text-[11px] whitespace-nowrap text-muted">
          {hint}
        </span>
      )}
    </span>
  );
}

function NoteIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-[13px]">
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z" />
    </svg>
  );
}

/**
 * The note for one day (rule 10h): a small icon under the hours that opens a
 * box to write it. Only on days with hours; at most 500 characters. Faint =
 * no note, blue = has a note, orange = the firm requires one and it's missing.
 */
function NoteButton({
  note,
  show,
  day,
  title,
  readOnly,
  missing,
  onSave,
}: {
  note: string | null;
  show: boolean;
  /** "Mon Oct 12" */
  day: string;
  title: string;
  readOnly: boolean;
  missing: boolean;
  onSave: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(note ?? "");

  // Keep the slot so rows line up whether or not a day has hours.
  if (!show) return <span aria-hidden="true" className="block h-5" />;

  const save = () => {
    onSave(text);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setText(note ?? "");
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${note || readOnly ? "Note" : "Add note"}, ${day}, ${title}`}
          title={note ?? (missing ? "A note is required" : "Add a note")}
          className={cn(
            "mx-auto mt-1 flex h-4 w-6 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent hover:bg-line-soft",
            missing ? "text-orange-strong" : note ? "text-blue" : "text-faint hover:text-ink-3",
          )}
        >
          <NoteIcon filled={!!note} />
        </button>
      </PopoverTrigger>
      <PopoverContent label={`Note, ${day}, ${title}`} align="center" className="w-[300px]">
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="cap text-2xs font-semibold text-ink">Note · {day}</span>
            <span className="truncate text-[11.5px] text-muted">{title}</span>
          </div>
          {readOnly ? (
            <p className="m-0 text-sm whitespace-pre-wrap text-ink-2">{note}</p>
          ) : (
            <>
              <textarea
                aria-label="Note"
                autoFocus
                rows={3}
                maxLength={NOTE_MAX}
                value={text}
                placeholder={missing ? "Required for billable time" : "What was this time for?"}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    save();
                  }
                }}
                className="w-full resize-none rounded-sm border border-line-input bg-surface px-2.5 py-2 text-sm text-ink placeholder:text-faint focus:outline-2 focus:-outline-offset-1 focus:outline-blue"
              />
              <div className="flex items-center justify-between gap-2">
                <span className="num text-[11.5px] text-muted">
                  {text.length}/{NOTE_MAX}
                </span>
                <span className="flex gap-1.5">
                  <Button variant="ghost" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button variant="primary" onClick={save}>
                    Save
                  </Button>
                </span>
              </div>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
