import { describe, expect, it } from "vitest";
import {
  type BoardPhase,
  type BoardTemplate,
  type HomeInvoice,
  billedText,
  boardColumns,
  chartDays,
  currentPhase,
  dueLabel,
  greetingFor,
  homeEyebrow,
  hourIn,
  hoursBar,
  lastWeekBanner,
  outstanding,
  outstandingLine,
  timeStatusLine,
  weekBillablePct,
} from "./home";
import { weekDates } from "./timesheet";

// Home (home spec, acceptance tests). Today is Sunday Oct 18, 2026, as in the spec.

const TODAY = "2026-10-18";
const NY = "America/New_York";

describe("header", () => {
  it("greets by the hour in the firm's time zone", () => {
    // 15:00, 09:00 and 18:00 in New York (UTC−4 in October).
    expect(greetingFor(hourIn(NY, new Date("2026-10-18T19:00:00Z")))).toBe("afternoon");
    expect(greetingFor(hourIn(NY, new Date("2026-10-18T13:00:00Z")))).toBe("morning");
    expect(greetingFor(hourIn(NY, new Date("2026-10-18T22:00:00Z")))).toBe("evening");
  });

  it("uses the edges 12 and 17", () => {
    expect(greetingFor(0)).toBe("morning");
    expect(greetingFor(11)).toBe("morning");
    expect(greetingFor(12)).toBe("afternoon");
    expect(greetingFor(16)).toBe("afternoon");
    expect(greetingFor(17)).toBe("evening");
    expect(greetingFor(23)).toBe("evening");
  });

  it("writes the date line", () => {
    expect(homeEyebrow(TODAY, 10)).toBe("Sunday, October 18, 2026 · 10 active projects");
    expect(homeEyebrow(TODAY, 1)).toBe("Sunday, October 18, 2026 · 1 active project");
  });
});

describe("current phase (rule 6)", () => {
  const ph = (code: string, status: BoardPhase["status"], sortOrder: number): BoardPhase => ({ code, name: code, status, sortOrder });

  it("is the lowest current phase", () => {
    expect(currentPhase([ph("PD", "complete", 1), ph("SD", "current", 2), ph("DD", "upcoming", 3)])?.code).toBe("SD");
  });

  it("is the lowest upcoming phase when none is current", () => {
    expect(currentPhase([ph("DD", "upcoming", 3), ph("PD", "complete", 1), ph("SD", "upcoming", 2)])?.code).toBe("SD");
  });

  it("is the last phase when all are complete", () => {
    expect(currentPhase([ph("PD", "complete", 1), ph("CA", "complete", 6)])?.code).toBe("CA");
  });

  it("is null with no phases", () => {
    expect(currentPhase([])).toBeNull();
  });
});

describe("board columns (rule 6)", () => {
  const T: BoardTemplate[] = [
    { code: "SD", name: "Schematic Design", isOptional: false, sortOrder: 2 },
    { code: "PD", name: "Pre-Design", isOptional: false, sortOrder: 1 },
    { code: "DD", name: "Design Development", isOptional: false, sortOrder: 3 },
    { code: "CA", name: "Construction Admin", isOptional: false, sortOrder: 6 },
    { code: "INT", name: "Interiors", isOptional: true, sortOrder: 1 },
  ];
  const card = (number: string, phaseCode: string | null) => ({ number, phaseCode });
  const names = (cols: { name: string }[]) => cols.map((c) => c.name);

  it("shows every standard phase in order, even empty, and no optional or Other column", () => {
    const cols = boardColumns(T, []);
    expect(names(cols)).toEqual(["Pre-Design", "Schematic Design", "Design Development", "Construction Admin"]);
    expect(cols.every((c) => c.cards.length === 0)).toBe(true);
  });

  it("puts each card in its phase's column, sorted by number", () => {
    const cols = boardColumns(T, [card("2026-014", "DD"), card("2026-003", "ca"), card("2026-002", "DD")]);
    expect(cols.find((c) => c.key === "dd")?.cards.map((c) => c.number)).toEqual(["2026-002", "2026-014"]);
    expect(cols.find((c) => c.key === "ca")?.cards.map((c) => c.number)).toEqual(["2026-003"]);
  });

  it("adds an optional phase's column after the standard ones only when a card is in it", () => {
    const cols = boardColumns(T, [card("2026-020", "INT")]);
    expect(names(cols)).toEqual(["Pre-Design", "Schematic Design", "Design Development", "Construction Admin", "Interiors"]);
  });

  it("puts custom phases in Other, at the end, only when not empty", () => {
    const cols = boardColumns(T, [card("2026-030", "P2A"), card("2026-031", null)]);
    const last = cols[cols.length - 1];
    expect(last.name).toBe("Other");
    expect(last.other).toBe(true);
    expect(last.cards.map((c) => c.number)).toEqual(["2026-030", "2026-031"]);
    expect(names(boardColumns(T, [card("1", "SD")]))).not.toContain("Other");
  });
});

describe("card bars (rules 7–8)", () => {
  it("shows hours used vs budget", () => {
    expect(hoursBar(412, 600)).toEqual({ text: "412 of 600 h", value: 412, max: 600, over: false });
    expect(hoursBar(650, 600).over).toBe(true);
    expect(hoursBar(32.25, 40).text).toBe("32.3 of 40 h");
  });

  it("shows no bar without budget hours", () => {
    expect(hoursBar(12, 0)).toEqual({ text: "12 h · no budget", value: null, max: null, over: false });
  });

  it("writes billed %", () => {
    expect(billedText(20)).toBe("20% billed");
    expect(billedText(null)).toBe("No fee");
  });
});

describe("your time (rules 2–4)", () => {
  it("works out billable % half up, and — for an empty week", () => {
    // Mon 8, Tue 7.5, Wed 8, Thu 6, Fri 3 = 32.5 h, 28 billable → 86.15% → 86%.
    expect(weekBillablePct(28, 32.5)).toBe(86);
    expect(weekBillablePct(1, 8)).toBe(13); // 12.5 → 13
    expect(weekBillablePct(0, 0)).toBeNull();
  });

  it("shows weekdays always and weekend days only with hours", () => {
    const dates = weekDates("2026-10-12"); // Mon … Sun
    expect(chartDays(dates, [8, 7.5, 8, 6, 3, 0, 0])).toEqual([0, 1, 2, 3, 4]);
    expect(chartDays(dates, [8, 7.5, 8, 6, 3, 4, 0])).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("writes the status line", () => {
    expect(dueLabel("2026-10-19")).toBe("Mon Oct 19");
    expect(timeStatusLine("draft", "2026-10-19", null)).toEqual({ text: "Not submitted · due Mon Oct 19", returned: false });
    expect(timeStatusLine(null, "2026-10-19", null).text).toBe("Not started · due Mon Oct 19");
    expect(timeStatusLine("submitted", "2026-10-19", null).text).toBe("Submitted · in review");
    expect(timeStatusLine("approved", "2026-10-19", null).text).toBe("Approved");
    expect(timeStatusLine("rejected", "2026-10-19", "Split CA hours by phase")).toEqual({
      text: "Returned: Split CA hours by phase",
      returned: true,
    });
  });

  it("shows the last-week banner only after the due time", () => {
    const due = new Date("2026-10-19T13:00:00Z");
    const after = new Date("2026-10-20T13:00:00Z");
    expect(lastWeekBanner("draft", "2026-10-12", due, after)).toBe("Week of Oct 12 not submitted.");
    expect(lastWeekBanner(null, "2026-10-12", due, after)).toBe("Week of Oct 12 not submitted.");
    expect(lastWeekBanner("rejected", "2026-10-12", due, after)).toBe("Week of Oct 12 returned.");
    expect(lastWeekBanner("draft", "2026-10-12", due, new Date("2026-10-19T12:00:00Z"))).toBeNull();
    expect(lastWeekBanner("submitted", "2026-10-12", due, after)).toBeNull();
    expect(lastWeekBanner("approved", "2026-10-12", due, after)).toBeNull();
  });
});

describe("invoices outstanding (rule 9)", () => {
  const inv = (over: Partial<HomeInvoice>): HomeInvoice => ({
    id: over.number ?? "x",
    number: "x",
    projectName: "P",
    clientName: "C",
    status: "sent",
    dueDate: TODAY,
    totalCents: 0,
    amountPaidCents: 0,
    ...over,
  });

  it("matches the spec example", () => {
    const o = outstanding(
      [
        inv({ number: "2026-121", dueDate: "2026-10-30", totalCents: 1_116_000 }),
        inv({ number: "2026-118", dueDate: "2026-08-17", totalCents: 2_500_000, amountPaidCents: 600_000, status: "partially_paid" }),
      ],
      TODAY,
    );
    expect(o.totalCents).toBe(3_016_000);
    expect(outstandingLine(o)).toBe("2 open invoices · 1 over 60 days");
    expect(o.buckets.find((b) => b.key === "61_90")?.cents).toBe(1_900_000);
    expect(o.buckets.find((b) => b.key === "current")?.cents).toBe(1_116_000);
    expect(o.rows[0]).toMatchObject({ number: "2026-118", flag: "62 days past due", balanceCents: 1_900_000 });
    expect(o.rows[1].flag).toBe("Due Oct 30");
  });

  it("leaves out paid, void, draft, in-review and written-off invoices", () => {
    const statuses = ["paid", "void", "draft", "in_review", "written_off"] as const;
    const o = outstanding(statuses.map((status) => inv({ status, totalCents: 100_000 })), TODAY);
    expect(o).toMatchObject({ totalCents: 0, count: 0, over60: 0, rows: [] });
  });

  it("lists at most 5, most days past due first", () => {
    const o = outstanding(
      [1, 2, 3, 4, 5, 6].map((n) => inv({ number: `2026-10${n}`, dueDate: `2026-10-0${n}`, totalCents: 100 })),
      TODAY,
    );
    expect(o.count).toBe(6);
    expect(o.rows.map((r) => r.number)).toEqual(["2026-101", "2026-102", "2026-103", "2026-104", "2026-105"]);
  });
});
