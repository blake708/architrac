import { describe, expect, it } from "vitest";
import {
  type ForLine,
  type ListInvoice,
  agingTotals,
  balanceCents,
  inTab,
  invoiceFor,
  monthDay,
  monthStart,
  projectStatusText,
  receivablesKpis,
  tabCounts,
  tabOf,
} from "./receivables";

// The Invoices page and project Invoices tab (invoicing spec Layout A/B,
// Data shown, rules 9–11). Today is Oct 18, 2026, as in the spec.

const TODAY = "2026-10-18";

const inv = (
  status: ListInvoice["status"],
  dueDate: string,
  totalCents: number,
  amountPaidCents = 0,
): ListInvoice => ({
  status,
  dueDate,
  totalCents,
  amountPaidCents,
});

const rows: ListInvoice[] = [
  inv("sent", "2026-11-15", 1_116_000), // 2026-121: due in 28 d → Current
  inv("partially_paid", "2026-10-01", 2_555_000, 555_000), // 17 d late → 1–30, owes 2,000,000
  inv("sent", "2026-08-17", 1_900_000), // 62 d late → 61–90
  inv("sent", "2026-06-30", 1_150_000), // 2025-188: 110 d late → 90+
  inv("paid", "2026-10-15", 1_674_000, 1_674_000),
  inv("draft", "2026-11-30", 1_395_000),
  inv("in_review", "2026-11-30", 200_000),
  inv("void", "2026-10-30", 500_000),
];

describe("balance", () => {
  it("total less paid; nothing on a void invoice", () => {
    expect(balanceCents(inv("partially_paid", TODAY, 1_116_000, 500_000))).toBe(
      616_000,
    );
    expect(balanceCents(inv("void", TODAY, 1_116_000))).toBe(0);
    expect(balanceCents(inv("paid", TODAY, 1_116_000, 1_116_000))).toBe(0);
  });
});

describe("status tabs", () => {
  it("sorts each status into its tab, with counts", () => {
    expect(tabOf("sent")).toBe("open");
    expect(tabOf("partially_paid")).toBe("open");
    expect(tabOf("in_review")).toBe("drafts");
    expect(tabOf("paid")).toBe("paid");
    expect(tabOf("void")).toBe("void");
    expect(inTab("void", "all")).toBe(true);
    expect(inTab("draft", "open")).toBe(false);
    expect(tabCounts(rows)).toEqual({
      open: 4,
      drafts: 2,
      paid: 1,
      void: 1,
      all: 8,
    });
  });
});

describe("KPIs", () => {
  it("receivables, over 60 days, drafts & in review, collected this month", () => {
    const k = receivablesKpis(
      rows,
      [
        { amountCents: 555_000, receivedOn: "2026-10-05" },
        { amountCents: 1_674_000, receivedOn: "2026-10-12" },
        { amountCents: 930_000, receivedOn: "2026-09-18" }, // last month
      ],
      TODAY,
    );
    expect(k).toEqual({
      receivablesCents: 1_116_000 + 2_000_000 + 1_900_000 + 1_150_000,
      openCount: 4,
      over60Cents: 1_900_000 + 1_150_000,
      over60Count: 2,
      draftsCount: 2,
      draftsCents: 1_595_000,
      collectedCents: 2_229_000,
      collectedCount: 2,
    });
  });
  it("month start", () => {
    expect(monthStart(TODAY)).toBe("2026-10-01");
  });
});

describe("aging bar", () => {
  it("open balances by bucket (rule 10 example: 2026-121 Current, 2025-188 90+)", () => {
    expect(agingTotals(rows, TODAY)).toEqual([
      { key: "current", label: "Current", cents: 1_116_000, count: 1 },
      { key: "1_30", label: "1–30 days", cents: 2_000_000, count: 1 },
      { key: "31_60", label: "31–60 days", cents: 0, count: 0 },
      { key: "61_90", label: "61–90 days", cents: 1_900_000, count: 1 },
      { key: "90_plus", label: "90+ days", cents: 1_150_000, count: 1 },
    ]);
  });
});

describe("project Invoices tab", () => {
  it("status wording, as in the mockup", () => {
    expect(projectStatusText("paid", "2026-10-30", "2026-10-12")).toBe(
      "Paid Oct 12",
    );
    expect(projectStatusText("sent", "2026-11-15", null)).toBe(
      "Sent · due Nov 15",
    );
    expect(
      projectStatusText("partially_paid", "2026-11-15", "2026-10-20"),
    ).toBe("Partially paid · due Nov 15");
    expect(projectStatusText("draft", "2026-11-15", null)).toBe("Draft");
    expect(projectStatusText("in_review", "2026-11-15", null)).toBe(
      "In review",
    );
    expect(projectStatusText("void", "2026-11-15", null)).toBe("Void");
    expect(monthDay("2026-01-05")).toBe("Jan 5");
  });

  const line = (l: Partial<ForLine> & Pick<ForLine, "lineType">): ForLine => ({
    name: null,
    percentCompleteBp: null,
    hoursHundredths: null,
    description: "",
    ...l,
  });

  it("For: phases with their %, hourly phases with their hours", () => {
    expect(
      invoiceFor([
        line({
          lineType: "phase_fee",
          name: "Schematic Design",
          percentCompleteBp: 10000,
        }),
      ]),
    ).toBe("Schematic Design · 100%");
    expect(
      invoiceFor([
        line({
          lineType: "phase_fee",
          name: "Design Development",
          percentCompleteBp: 3000,
        }),
        line({ lineType: "hourly", name: "Permitting", hoursHundredths: 800 }),
        line({ lineType: "hourly", name: "Permitting", hoursHundredths: 350 }),
        line({
          lineType: "adjustment",
          name: "Permitting",
          description: "write-down",
        }),
      ]),
    ).toBe("Design Development · 30%, Permitting · 11.5 h");
  });

  it("For: more than two items, and adjustment-only invoices", () => {
    expect(
      invoiceFor([
        line({ lineType: "phase_fee", name: "SD", percentCompleteBp: 10000 }),
        line({ lineType: "phase_fee", name: "DD", percentCompleteBp: 3000 }),
        line({
          lineType: "consultant",
          name: "MEP · Coastal Engineers",
          percentCompleteBp: 5000,
        }),
        line({ lineType: "hourly", name: "Close Out", hoursHundredths: 400 }),
      ]),
    ).toBe("SD · 100%, DD · 30% + 2 more");
    expect(
      invoiceFor([line({ lineType: "adjustment", description: "Retainer" })]),
    ).toBe("Retainer");
    expect(invoiceFor([])).toBe("—");
  });
});
