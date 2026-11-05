// Words and labels on the timesheet page (timesheet spec, Layout and States).
// Pure, so the page and the tests agree.

import type { TimesheetStatus } from "@/lib/calc/timesheet";
import { addDays } from "@/lib/calc/timesheet";

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const fmt = (opts: Intl.DateTimeFormatOptions, d: Date, timeZone = "UTC") =>
  new Intl.DateTimeFormat("en-US", { ...opts, timeZone }).format(d);

/** "Week of Oct 12 – Oct 18, 2026 · Due Mon Oct 19, 9:00 AM" (shown in caps by CSS). */
export function weekMetaLine(weekStart: string, dueLabel: string): string {
  const end = addDays(weekStart, 6);
  const sameYear = weekStart.slice(0, 4) === end.slice(0, 4);
  const from = fmt(sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" }, utc(weekStart));
  const to = fmt({ month: "short", day: "numeric", year: "numeric" }, utc(end));
  return `Week of ${from} – ${to} · Due ${dueLabel}`;
}

/** "Oct 12 – 18" style range for History rows: "Oct 12 – Oct 18, 2026". */
export function weekRange(weekStart: string): string {
  const end = addDays(weekStart, 6);
  return `${fmt({ month: "short", day: "numeric" }, utc(weekStart))} – ${fmt({ month: "short", day: "numeric", year: "numeric" }, utc(end))}`;
}

/** Day column header: { dow: "Mon", date: "Oct 12" }. */
export function dayHeader(isoDate: string) {
  return { dow: fmt({ weekday: "short" }, utc(isoDate)), date: fmt({ month: "short", day: "numeric" }, utc(isoDate)) };
}

/** "Oct 19, 8:12 AM" in the firm's time zone. */
export function whenLabel(iso: string, timeZone: string): string {
  return fmt({ month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }, new Date(iso), timeZone);
}

/** "Oct 19" in the firm's time zone. */
export function dayLabel(iso: string, timeZone: string): string {
  return fmt({ month: "short", day: "numeric" }, new Date(iso), timeZone);
}

export type StatusLook = "hollow" | "half" | "filled" | "diamond";
export type StatusView = {
  label: string;
  tone: "neutral" | "blue" | "green" | "orange";
  look: StatusLook;
  note: string;
};

type StatusFacts = {
  status: TimesheetStatus | null;
  dueLabel: string;
  timezone: string;
  submittedAt: string | null;
  reviewer: string | null;
  leaderApprovedAt: string | null;
  leaderApprovedBy: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
};

/** The status badge and note (States → Status states; decision #3 b). */
export function statusView(f: StatusFacts): StatusView {
  const submitted = f.submittedAt ? whenLabel(f.submittedAt, f.timezone) : "";
  switch (f.status) {
    case "submitted": {
      const who = f.reviewer ?? "your team leader";
      const until = f.reviewer ? `${f.reviewer} acts` : "they act";
      return {
        label: "With team leader",
        tone: "blue",
        look: "half",
        note: `Submitted ${submitted} to ${who} for review, then a principal approves. You can recall it until ${until}.`,
      };
    }
    case "leader_approved":
      if (!f.leaderApprovedAt)
        return {
          label: "With principal",
          tone: "blue",
          look: "half",
          note: `Submitted ${submitted} to a principal for approval. You can recall it until they act.`,
        };
      return {
        label: "With principal",
        tone: "blue",
        look: "half",
        note: `${f.leaderApprovedBy ?? "Your team leader"} reviewed it ${dayLabel(f.leaderApprovedAt, f.timezone)}. Waiting on a principal.`,
      };
    case "approved":
      return {
        label: "Approved",
        tone: "green",
        look: "filled",
        note: `Approved ${f.approvedAt ? dayLabel(f.approvedAt, f.timezone) : ""}${f.approvedBy ? ` by ${f.approvedBy}` : ""}. Locked.`,
      };
    case "rejected":
      return { label: "Returned", tone: "orange", look: "diamond", note: "Returned. Fix and resubmit." };
    default:
      return {
        label: "Draft",
        tone: "neutral",
        look: "hollow",
        note: `Not submitted yet. Due ${f.dueLabel.replace(", ", " at ")}.`,
      };
  }
}

/** The rejection banner: `Returned by JR on Oct 20: "…"`. */
export function returnedLine(by: string | null, at: string | null, note: string | null, timeZone: string): string {
  const who = by ? ` by ${by}` : "";
  const when = at ? ` on ${dayLabel(at, timeZone)}` : "";
  return `Returned${who}${when}${note ? `: "${note}"` : "."}`;
}
