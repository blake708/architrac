import { describe, expect, it } from "vitest";
import { type ActivityRow, activityItems, activityText } from "./activity";

// The invoice page's activity timeline (invoicing spec Layout D, rule 18).

describe("activityText", () => {
  it("each logged action in plain words", () => {
    expect(activityText("created", { project: "2026-014" })).toBe("Started the draft");
    expect(activityText("status_changed", { status: { before: "draft", after: "in_review" } })).toBe("Submitted it for review");
    expect(activityText("status_changed", { status: { before: "in_review", after: "draft" }, note: "Check DD %" })).toBe(
      "Returned it to draft: “Check DD %”",
    );
    expect(activityText("status_changed", { status: { after: "sent" }, emailed: { to: "ap@client.example", cc: "" } })).toBe(
      "Sent it to ap@client.example",
    );
    expect(activityText("status_changed", { status: { after: "sent" }, emailed: false })).toBe("Marked it sent without emailing");
    expect(activityText("status_changed", { status: { after: "void" }, reason: "Wrong %" })).toBe("Voided it: “Wrong %”");
    expect(activityText("resent", { to: "ap@client.example" })).toBe("Emailed it again to ap@client.example");
    expect(activityText("payment_recorded", { amountCents: 500_000, method: "check", reference: "1042", receivedOn: "2026-10-20" })).toBe(
      "Recorded a $5,000 payment (Check 1042) received Oct 20",
    );
    expect(activityText("payment_deleted", { amountCents: 616_000, receivedOn: "2026-10-22" })).toBe(
      "Deleted the $6,160 payment received Oct 22",
    );
  });
});

describe("activityItems", () => {
  const row = (id: string, action: string, minute: number, who = "Bea Middle"): ActivityRow => ({
    id,
    action,
    changes: null,
    who,
    at: new Date(Date.UTC(2026, 9, 16, 12, minute)),
  });

  it("newest first; repeated draft edits by one person become one line", () => {
    const items = activityItems([row("a", "created", 0), row("b", "updated", 1), row("c", "updated", 2), row("d", "updated", 3, "Jay Ross"), row("e", "numbered", 4)]);
    expect(items.map((i) => [i.id, i.text, i.times])).toEqual([
      ["e", "Numbered it ", 1],
      ["d", "Changed the draft", 1],
      ["c", "Changed the draft", 2],
      ["a", "Started the draft", 1],
    ]);
  });
});
