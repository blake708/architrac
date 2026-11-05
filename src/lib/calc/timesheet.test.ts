import { describe, expect, it } from "vitest";
import {
  type CalcRow,
  billableNote,
  canRecall,
  dayLimitMessage,
  dueDate,
  isEditable,
  isIsoDate,
  parseHoursInput,
  phaseSummary,
  shortDays,
  shortWarning,
  submitProblems,
  submitRoute,
  weekDates,
  weekStartOf,
  weekTotals,
  zonedInstant,
} from "./timesheet";

// Timesheet spec, business rules 1, 6, 7 and 10–12.

let n = 0;
function row(p: Partial<CalcRow> & { hours: number[] }): CalcRow {
  n += 1;
  const hours = [...p.hours, 0, 0, 0, 0, 0, 0, 0].slice(0, 7);
  return {
    id: `r${n}`,
    rowType: "project",
    projectPhaseId: `ph${n}`,
    overheadCategoryId: null,
    activityId: `a${n}`,
    billable: true,
    notes: [null, null, null, null, null, null, null],
    projectNumber: "2026-001",
    projectName: "Project",
    phaseName: "Phase",
    categoryName: null,
    activityName: "Activity",
    closed: false,
    activityInactive: false,
    ...p,
    hours,
  };
}

// The seed week of Oct 12 (rule 11 worked example).
const seed = () => [
  row({ projectNumber: "2026-014", projectName: "Medical Office Building", phaseName: "Design Development", activityName: "Meetings", hours: [2, 1.5, 2, 1, 0, 0, 0] }),
  row({ projectNumber: "2026-006", projectName: "Summerville Office Park", phaseName: "Construction Documents", activityName: "QA/QC review", hours: [3, 2, 3, 2, 1] }),
  row({ projectNumber: "2025-038", projectName: "Coastal Credit Union Branch", phaseName: "Permitting", hours: [1, 2, 1, 1, 0] }),
  row({ projectNumber: "2025-031", projectName: "Northside Self-Storage", phaseName: "Construction Admin", hours: [1, 2, 1, 1, 0.5] }),
  row({ rowType: "overhead", projectPhaseId: null, overheadCategoryId: "oh1", projectNumber: null, projectName: null, phaseName: null, categoryName: "Marketing", activityName: "Proposals", billable: false, hours: [1, 0, 1, 1, 1.5] }),
];
const dates = weekDates("2026-10-12");
const check = { dates, today: "2026-10-14", billableNotesRequired: false };

describe("weeks and due dates (rule 1)", () => {
  it("finds the Monday week of a Wednesday, and Sunday weeks too", () => {
    expect(weekStartOf("2026-10-14", 1)).toBe("2026-10-12");
    expect(weekStartOf("2026-10-12", 1)).toBe("2026-10-12");
    expect(weekStartOf("2026-10-18", 1)).toBe("2026-10-12");
    expect(weekStartOf("2026-10-14", 0)).toBe("2026-10-11");
  });

  it("lists the 7 days, across a month end", () => {
    expect(weekDates("2026-10-26")).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
  });

  it("due Monday → the following Monday; due Friday → that week's Friday", () => {
    expect(dueDate("2026-10-12", 1)).toBe("2026-10-19");
    expect(dueDate("2026-10-12", 5)).toBe("2026-10-16");
    expect(dueDate("2026-10-11", 1)).toBe("2026-10-19");
  });

  it("turns 9:00 AM New York into the right instant, in and out of daylight time", () => {
    expect(zonedInstant("2026-10-19", "09:00:00", "America/New_York").toISOString()).toBe("2026-10-19T13:00:00.000Z");
    expect(zonedInstant("2026-11-09", "09:00", "America/New_York").toISOString()).toBe("2026-11-09T14:00:00.000Z");
    expect(zonedInstant("2026-10-16", "17:00", "America/Los_Angeles").toISOString()).toBe("2026-10-17T00:00:00.000Z");
  });

  it("checks URL dates", () => {
    expect(isIsoDate("2026-10-12")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("oct-12")).toBe(false);
  });
});

describe("hours input (rule 6)", () => {
  it("reads decimals and h:mm", () => {
    expect(parseHoursInput("1.5")).toEqual({ kind: "hours", hours: 1.5, rounded: false });
    expect(parseHoursInput(".75")).toEqual({ kind: "hours", hours: 0.75, rounded: false });
    expect(parseHoursInput("1:30")).toEqual({ kind: "hours", hours: 1.5, rounded: false });
    expect(parseHoursInput(" 8 ")).toEqual({ kind: "hours", hours: 8, rounded: false });
  });

  it("rounds to the nearest quarter and says so", () => {
    expect(parseHoursInput("1.13")).toEqual({ kind: "hours", hours: 1.25, rounded: true });
    expect(parseHoursInput("1.1")).toEqual({ kind: "hours", hours: 1, rounded: true });
    expect(parseHoursInput("0:20")).toEqual({ kind: "hours", hours: 0.25, rounded: true });
  });

  it("empty, 0 and anything that rounds to 0 clear the cell", () => {
    expect(parseHoursInput("")).toEqual({ kind: "empty" });
    expect(parseHoursInput("0")).toEqual({ kind: "empty" });
    expect(parseHoursInput("0.1")).toEqual({ kind: "empty" });
  });

  it("refuses negatives and text", () => {
    expect(parseHoursInput("-2")).toEqual({ kind: "invalid" });
    expect(parseHoursInput("abc")).toEqual({ kind: "invalid" });
    expect(parseHoursInput("1:75")).toEqual({ kind: "invalid" });
  });

  it("explains the 24-hour day limit (rule 7)", () => {
    expect(dayLimitMessage("2026-10-14", 25)).toBe("Oct 14 would total 25 h. A day can't exceed 24 h.");
  });
});

describe("totals (rule 11, seed week)", () => {
  const t = weekTotals(seed(), 40);

  it("day totals, week total and the billable split", () => {
    expect(t.dayTotals).toEqual([8, 7.5, 8, 6, 3, 0, 0]);
    expect(t.weekTotal).toBe(32.5);
    expect(t.billable).toBe(28);
    expect(t.nonBillable).toBe(4.5);
    expect(t.billablePct).toBe(86);
    expect(billableNote(t)).toBe("28 billable · 4.5 non-billable · 86% billable");
  });

  it("bar: 70% blue + 11.25% light blue", () => {
    expect(t.billableWidth).toBe(70);
    expect(t.nonBillableWidth).toBeCloseTo(11.25);
  });

  it("Tue, Thu and Fri are short of 8; weekends never are", () => {
    expect(shortDays(dates, t.dayTotals, 40)).toEqual([false, true, false, true, true, false, false]);
  });

  it("an empty week is 0% billable", () => {
    expect(weekTotals([], 40).billablePct).toBe(0);
  });

  it("short warning is 7.5 hours", () => {
    expect(shortWarning(32.5, 40)).toBe("7.5 hours short of 40. Add the missing time, or log PTO or a holiday before submitting.");
    expect(shortWarning(40, 40)).toBeNull();
  });
});

describe("phase summary (rule 12)", () => {
  it("matches the seed week", () => {
    expect(phaseSummary(seed())).toBe(
      "Medical Office Building · Design Development 6.5 h · Summerville Office Park · Construction Documents 11 h · Coastal Credit Union Branch · Permitting 5 h · Northside Self-Storage · Construction Admin 5.5 h · Overhead · Marketing 4.5 h",
    );
  });

  it("uses the name before the first comma; leave reads <category> · Leave", () => {
    const rows = [
      row({ projectName: "Clinic, Phase 2", phaseName: "SD", hours: [1] }),
      row({ rowType: "leave", projectPhaseId: null, overheadCategoryId: "l", categoryName: "PTO", billable: false, hours: [8] }),
    ];
    expect(phaseSummary(rows)).toBe("Clinic · SD 1 h · PTO · Leave 8 h");
    expect(phaseSummary([])).toBe("Nothing yet");
  });
});

describe("submit checks (rule 10)", () => {
  it("the seed week can be submitted", () => {
    expect(submitProblems(seed(), check)).toEqual([]);
  });

  it("a: an empty week", () => {
    expect(submitProblems([row({ hours: [] })], check)).toEqual(["Add your hours before submitting."]);
  });

  it("b: rows with hours need a phase and an activity; empty rows don't count", () => {
    expect(submitProblems([row({ activityId: null, hours: [3] }), row({ activityId: null, hours: [] })], check)).toEqual([
      "1 row needs a phase and an activity before you can submit.",
    ]);
    expect(submitProblems([row({ activityId: null, hours: [3] }), row({ projectPhaseId: null, hours: [1] })], check)[0]).toBe(
      "2 rows need a phase and an activity before you can submit.",
    );
  });

  it("c: hours on a closed phase", () => {
    expect(submitProblems([row({ projectNumber: "2026-017", phaseName: "Schematic Design", closed: true, hours: [2] })], check)).toEqual([
      "2026-017 Schematic Design is closed. Move these hours to an open phase.",
    ]);
  });

  it("d: an inactive activity", () => {
    expect(submitProblems([row({ activityName: "Drafting", activityInactive: true, hours: [2] })], check)).toEqual([
      "Drafting is no longer offered. Pick another activity on 2026-001.",
    ]);
  });

  it("e: two rows for the same line", () => {
    const a = row({ projectNumber: "2026-014", phaseName: "Design Development", activityName: "Meetings", projectPhaseId: "dd", activityId: "m", hours: [1] });
    const b = { ...a, id: "other", hours: [0, 2, 0, 0, 0, 0, 0] };
    expect(submitProblems([a, b], check)).toEqual(["Two rows are both 2026-014 · Design Development · Meetings. Combine them."]);
    // A non-billable copy of the same line is a different line.
    expect(submitProblems([a, { ...b, billable: false }], check)).toEqual([]);
  });

  it("f: a day over 24 hours", () => {
    expect(submitProblems([row({ hours: [0, 0, 20] }), row({ hours: [0, 0, 5] })], check)).toEqual([
      "Oct 14 totals 25 h. A day can't exceed 24 h.",
    ]);
  });

  it("g: a week that hasn't started", () => {
    expect(submitProblems([row({ hours: [2] })], { ...check, dates: weekDates("2026-10-19") })).toEqual([
      "You can't submit a week that hasn't started.",
    ]);
  });

  it("h: billable notes when the firm requires them (decision #17)", () => {
    const rows = [
      row({ hours: [2, 1], notes: ["Site meeting", null, null, null, null, null, null] }),
      row({ rowType: "overhead", projectPhaseId: null, overheadCategoryId: "oh", billable: false, hours: [1] }),
    ];
    expect(submitProblems(rows, check)).toEqual([]);
    expect(submitProblems(rows, { ...check, billableNotesRequired: true })).toEqual([
      "1 billable day needs a note before you can submit.",
    ]);
  });
});

describe("status (rules 2, 14, 18)", () => {
  it("drafts, returned sheets and new weeks are editable", () => {
    expect(isEditable(null)).toBe(true);
    expect(isEditable("draft")).toBe(true);
    expect(isEditable("rejected")).toBe(true);
    expect(isEditable("submitted")).toBe(false);
    expect(isEditable("leader_approved")).toBe(false);
    expect(isEditable("approved")).toBe(false);
  });

  it("recall until a reviewer acts", () => {
    expect(canRecall("submitted", null)).toBe(true);
    expect(canRecall("leader_approved", null)).toBe(true);
    expect(canRecall("leader_approved", new Date())).toBe(false);
    expect(canRecall("approved", null)).toBe(false);
    expect(canRecall("draft", null)).toBe(false);
  });

  it("goes to the team leader, or straight to a principal", () => {
    expect(submitRoute("kl", { membershipId: "jr", active: true })).toEqual({ status: "submitted", reviewerMembershipId: "jr" });
    expect(submitRoute("jr", { membershipId: "jr", active: true })).toEqual({ status: "leader_approved", reviewerMembershipId: null });
    expect(submitRoute("kl", { membershipId: "jr", active: false })).toEqual({ status: "leader_approved", reviewerMembershipId: null });
    expect(submitRoute("kl", null)).toEqual({ status: "leader_approved", reviewerMembershipId: null });
  });
});
