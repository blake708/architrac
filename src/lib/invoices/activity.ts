import { money } from "@/lib/calc/invoice-plan";
import { monthDay } from "@/lib/calc/receivables";
import { type PaymentMethod, methodLabel } from "./payments";

// The invoice page's activity timeline (invoicing spec Layout D, rule 18):
// activity_log rows for one invoice, in plain words.

export type ActivityRow = {
  id: string;
  action: string;
  changes: Record<string, unknown> | null;
  who: string;
  at: Date;
};

export type ActivityItem = { id: string; who: string; text: string; at: Date; times: number };

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" ? v : 0);

/** One activity_log row → a sentence (without the person). */
export function activityText(action: string, changes: Record<string, unknown> | null): string {
  const c = changes ?? {};
  switch (action) {
    case "created":
      return "Started the draft";
    case "updated":
      return "Changed the draft";
    case "archived":
      return "Deleted the draft";
    case "numbered":
      return `Numbered it ${str(c.number)}`;
    case "resent": {
      const to = Array.isArray(c.to) ? c.to.join(", ") : str(c.to);
      return to ? `Emailed it again to ${to}` : "Emailed it again";
    }
    case "payment_recorded": {
      const how = methodLabel(str(c.method) as PaymentMethod);
      const ref = str(c.reference);
      return `Recorded a ${money(num(c.amountCents))} payment (${how}${ref ? ` ${ref}` : ""}) received ${monthDay(str(c.receivedOn))}`;
    }
    case "payment_deleted":
      return `Deleted the ${money(num(c.amountCents))} payment received ${monthDay(str(c.receivedOn))}`;
    case "status_changed": {
      const s = (c.status ?? {}) as { before?: string; after?: string };
      if (s.after === "in_review") return "Submitted it for review";
      if (s.after === "draft") return c.note ? `Returned it to draft: “${str(c.note)}”` : "Returned it to draft";
      if (s.after === "void") return c.reason ? `Voided it: “${str(c.reason)}”` : "Voided it";
      if (s.after === "sent") {
        const e = c.emailed as { to?: string } | false | undefined;
        return e && e.to ? `Sent it to ${e.to}` : "Marked it sent without emailing";
      }
      return `Changed the status to ${str(s.after).replace("_", " ")}`;
    }
    default:
      return action.replace(/_/g, " ");
  }
}

/** Newest first; a run of "Changed the draft" by the same person becomes one line. */
export function activityItems(rows: readonly ActivityRow[]): ActivityItem[] {
  const out: ActivityItem[] = [];
  for (const r of [...rows].sort((a, b) => b.at.getTime() - a.at.getTime())) {
    const text = activityText(r.action, r.changes);
    const last = out.at(-1);
    if (last && r.action === "updated" && last.text === text && last.who === r.who) {
      last.times += 1;
      continue;
    }
    out.push({ id: r.id, who: r.who, text, at: r.at, times: 1 });
  }
  return out;
}
