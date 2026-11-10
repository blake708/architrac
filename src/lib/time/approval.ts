// Approvals: messages and checks shared by the dialogs and the server
// (timesheet-approval spec, Actions and rules 3–5).

import { STEP_LABELS, type ReviewStepKind, SKIP_LABELS, type SkipReason } from "@/lib/calc/review-route";
import { addDays } from "@/lib/calc/timesheet";

export const RETURN_NOTE_MAX = 1000;

export const APPROVAL_MESSAGES = {
  notFound: "That timesheet wasn't found.",
  notWaiting: "This timesheet is no longer waiting for you.",
  notInReview: "This timesheet isn't in review, so it can't be returned.",
  notApproved: "Only approved timesheets can be reopened.",
  noteTooLong: `Notes can be up to ${RETURN_NOTE_MAX} characters.`,
  noteRequired: (initials: string) => `Add a note so ${initials} knows what to change.`,
  saveFailed: "Couldn't save. Try again.",
  allClean: "All clean timesheets approved",
} as const;

/** Return / Reopen note: required, 1–1000 characters after trimming. */
export function returnNoteProblem(note: string, initials: string): string | null {
  const t = note.trim();
  if (!t) return APPROVAL_MESSAGES.noteRequired(initials);
  if (t.length > RETURN_NOTE_MAX) return APPROVAL_MESSAGES.noteTooLong;
  return null;
}

/** Optional note on "Approve for …": at most 1000 characters. */
export function onBehalfNoteProblem(note: string | undefined): string | null {
  return note && note.trim().length > RETURN_NOTE_MAX ? APPROVAL_MESSAGES.noteTooLong : null;
}

/** "No rate for KL on Oct 14. Add one …" → "KL has no rate on Oct 14"; anything else → "KL: <error>". */
export function shortFailure(initials: string, error: string): string {
  const m = /^No rate for (\S+) on (.+?)\. Add one/.exec(error);
  return m ? `${m[1]} has no rate on ${m[2]}` : `${initials}: ${error.replace(/\.$/, "")}`;
}

/** Bulk approve toast: "Approved 4." or "Approved 2. 1 not approved: KL has no rate on Oct 14." */
export function bulkMessage(approved: number, failures: readonly { initials: string; error: string }[]): string {
  const head = `Approved ${approved}.`;
  if (!failures.length) return head;
  return `${head} ${failures.length} not approved: ${failures.map((f) => shortFailure(f.initials, f.error)).join("; ")}.`;
}

/** "Approve 4 with no flags", or the done label when there are none. */
export function approveCleanLabel(count: number): string {
  return count ? `Approve ${count} with no flags` : APPROVAL_MESSAGES.allClean;
}

// ---------- Labels ----------


const fmt = (opts: Intl.DateTimeFormatOptions, d: Date, timeZone = "UTC") =>
  new Intl.DateTimeFormat("en-US", { ...opts, timeZone }).format(d);
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** Week card header: "Week of Oct 12 – 18", or "Week of Oct 26 – Nov 1" across months. */
export function shortWeekRange(weekStart: string): string {
  const end = addDays(weekStart, 6);
  const from = fmt({ month: "short", day: "numeric" }, utc(weekStart));
  const to = fmt(weekStart.slice(5, 7) === end.slice(5, 7) ? { day: "numeric" } : { month: "short", day: "numeric" }, utc(end));
  return `Week of ${from} – ${to}`;
}

/** "Mon Oct 19, 8:12 AM" in the firm's time zone. */
export function dayTimeLabel(iso: string | Date, timeZone: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const parts = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).formatToParts(d);
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return `${p("weekday")} ${p("month")} ${p("day")}, ${p("hour")}:${p("minute")} ${p("dayPeriod")}`;
}

export type ChipRow = {
  stepNo: number;
  kind: ReviewStepKind;
  status: "waiting" | "approved" | "skipped";
  skipReason: string | null;
  /** Initials of the approver (null on an unclaimed any_principal row). */
  approver: string | null;
  /** Initials of who clicked approve. */
  actedBy: string | null;
  actedAt: Date | string | null;
  onBehalf: boolean;
};

export type ReviewChip = { label: string; tone: "green" | "blue" | "neutral" | "skipped" };

/**
 * The detail page's review strip (Layout 5): one chip per row, the step's
 * kind on its first chip. Approved green with ✓ and date, the current step
 * blue, later steps neutral, skipped grey with the reason.
 */
export function reviewChips(rows: readonly ChipRow[], timeZone: string): ReviewChip[] {
  const waitingSteps = rows.filter((r) => r.status === "waiting").map((r) => r.stepNo);
  const current = waitingSteps.length ? Math.min(...waitingSteps) : null;
  const seen = new Set<number>();
  return rows.map((r) => {
    const first = !seen.has(r.stepNo);
    seen.add(r.stepNo);
    const kind = STEP_LABELS[r.kind] === STEP_LABELS.person ? null : STEP_LABELS[r.kind];
    const prefix = (who: string | null) => [first ? kind : null, who].filter(Boolean).join(" · ");
    if (r.status === "skipped") {
      const reason = SKIP_LABELS[r.skipReason as SkipReason] ?? "skipped";
      return { label: `${first ? (kind ?? "Named person") : ""}${first ? " · " : ""}skipped, ${reason}`, tone: "skipped" };
    }
    if (r.status === "approved") {
      const on = r.actedAt ? ` ${fmt({ month: "short", day: "numeric" }, new Date(r.actedAt), timeZone)}` : "";
      const who = r.approver ?? r.actedBy;
      const by = r.onBehalf ? ` by ${r.actedBy} for ${r.approver ?? "a principal"}` : "";
      return { label: `${prefix(r.onBehalf ? r.approver : who)} ✓${by}${on}`, tone: "green" };
    }
    return { label: prefix(r.approver) || STEP_LABELS[r.kind], tone: r.stepNo === current ? "blue" : "neutral" };
  });
}

export type HistoryEntry = {
  action: string;
  changes: Record<string, unknown> | null;
  actor: string | null;
  at: Date;
};

/** One line of the detail page's History, or null for entries it doesn't show. */
export function historyLine(e: HistoryEntry, timeZone: string): string | null {
  const when = fmt({ month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }, e.at, timeZone);
  const c = e.changes ?? {};
  const note = typeof c.note === "string" && c.note ? `: "${c.note}"` : "";
  const who = e.actor ?? "Someone";
  if (e.action === "approved") {
    const step = typeof c.step_no === "number" ? ` (step ${c.step_no})` : "";
    const forWhom = Array.isArray(c.on_behalf_of) ? ` for ${(c.on_behalf_of as string[]).join(", ")}` : "";
    return `${who} approved${forWhom}${step}${note} ${when}`;
  }
  if (e.action === "reopened") return `Reopened by ${who}${note} ${when}`;
  if (e.action !== "status_changed") return null;
  const after = (c.status as { after?: string } | undefined)?.after;
  if (after === "submitted") return `Submitted ${when}`;
  if (after === "draft") return `Recalled ${when}`;
  if (after === "rejected") return `Returned by ${who}${note} ${when}`;
  if (after === "approved") return c.auto ? `Approved on submit ${when}` : `Approved ${when}`;
  return null;
}
