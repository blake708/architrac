import { describe, expect, it } from "vitest";
import {
  type PhaseRow,
  cleanPhaseRow,
  shareBarWidth,
  validatePhases,
} from "./phases";
import {
  archiveBlockedMessage,
  earliestDateMessage,
  rateErrors,
  startOfYear,
} from "./rates";
import { checkNewName, validateTimeLists } from "./time-lists";

const row = (code: string, name: string, pct: number): PhaseRow => ({
  id: null,
  code,
  name,
  description: "",
  pct,
  feeType: "fixed",
});
const SEED = [
  row("PD", "Pre-Design", 5),
  row("SD", "Schematic Design", 15),
  row("DD", "Design Development", 25),
  row("CD", "Construction Documents", 35),
  row("PRM", "Permitting", 5),
  row("CA", "Construction Admin", 15),
  row("CO", "Close Out", 0),
];

describe("validatePhases", () => {
  it("accepts the seed phases", () => {
    expect(validatePhases({ defaults: SEED, optional: [] })).toEqual({});
  });

  it("blocks a total that isn't 100%", () => {
    const defaults = SEED.map((r) => (r.code === "CD" ? { ...r, pct: 30 } : r));
    expect(validatePhases({ defaults, optional: [] }).total).toBe(
      "Phase shares must add up to 100%. Now 95%.",
    );
  });

  it("doesn't count optional phases in the total", () => {
    const optional = [{ ...row("INT", "Interior Design", 0), feeType: "hourly" as const }];
    expect(validatePhases({ defaults: SEED, optional })).toEqual({});
  });

  it("catches abbreviations used in both lists, ignoring case", () => {
    const optional = [row("pd", "Interiors", 0)];
    const errors = validatePhases({ defaults: SEED, optional });
    expect(errors["defaults.0.code"]).toMatch(/already used/);
    expect(errors["optional.0.code"]).toMatch(/already used/);
  });

  it("checks abbreviation format, names and percents", () => {
    const defaults = [row("S D", "", 101), ...SEED.slice(1)];
    const errors = validatePhases({ defaults, optional: [] });
    expect(errors["defaults.0.name"]).toBe("Enter a phase name");
    expect(errors["defaults.0.pct"]).toBe("Enter a whole number from 0 to 100");
    // "S D" becomes "SD", which another row already uses.
    expect(errors["defaults.0.code"]).toMatch(/already used/);
    expect(
      validatePhases({ defaults: [row("TOOLONG", "X", 100)], optional: [] })[
        "defaults.0.code"
      ],
    ).toMatch(/1–6/);
  });

  it("needs at least one default phase", () => {
    expect(validatePhases({ defaults: [], optional: [] }).list).toBe(
      "Keep at least one default phase",
    );
  });

  it("stores optional phases with no share", () => {
    expect(
      cleanPhaseRow({ ...row("int", " Interiors ", 20), feeType: "nte" }, "optional"),
    ).toMatchObject({
      code: "INT",
      name: "Interiors",
      isOptional: true,
      defaultFeeType: "nte",
      defaultFeeShareBp: 0,
      description: null,
    });
  });

  it("fills the share bar at 40%", () => {
    expect(shareBarWidth(35)).toBe(87.5);
    expect(shareBarWidth(50)).toBe(100);
  });
});

describe("rates messages and checks", () => {
  it("earliest date message", () => {
    expect(earliestDateMessage("2026-01-01", "Designer")).toBe(
      "Pick Jan 1, 2026 or later — Designer's current rate starts then.",
    );
  });

  it("archive blocked message", () => {
    expect(archiveBlockedMessage(6, "Designer")).toBe(
      "Move the 6 people in Designer to another role on the Team page first.",
    );
  });

  it("rate checks", () => {
    expect(rateErrors(true, 0, 44)).toEqual({
      bill: "Billable roles need a bill rate of at least $1",
    });
    expect(rateErrors(false, 0, 38)).toEqual({});
    expect(rateErrors(true, 115.5, 10_000).cost).toBeDefined();
    expect(rateErrors(true, 115.5, 44).bill).toBeDefined();
  });

  it("Add role defaults to Jan 1 of this year", () => {
    expect(startOfYear("2026-11-02")).toBe("2026-01-01");
  });
});

describe("timesheet lists", () => {
  const projectActivities = ["Design", "Travel"].map((name, i) => ({
    id: `00000000-0000-4000-8000-00000000000${i}`,
    name,
  }));

  it('"travel" is already in the list', () => {
    expect(checkNewName(projectActivities, " travel ")).toEqual({
      ok: false,
      error: "Already in the list",
    });
  });

  it("an empty name adds nothing; a new one is trimmed", () => {
    expect(checkNewName(projectActivities, "   ")).toBeNull();
    expect(checkNewName(projectActivities, " Punch walk ")).toEqual({
      ok: true,
      name: "Punch walk",
    });
  });

  it("an overhead phase needs an activity", () => {
    const errors = validateTimeLists({
      projectActivities,
      leaveTypes: [{ id: null, name: "Vacation" }],
      overheadPhases: [{ id: null, name: "IT", activities: [], loggedHours: 0 }],
    });
    expect(errors["overheadPhases.0"]).toBe(
      "Add at least one activity to IT, or remove it.",
    );
  });

  it("overhead phase names are unique", () => {
    const acts = [{ id: null, name: "Admin" }];
    const errors = validateTimeLists({
      projectActivities,
      leaveTypes: [{ id: null, name: "Vacation" }],
      overheadPhases: [
        { id: null, name: "Marketing", activities: acts, loggedHours: 0 },
        { id: null, name: "marketing", activities: acts, loggedHours: 0 },
      ],
    });
    expect(errors["overheadPhases.1.name"]).toBe(
      "Another overhead phase has this name",
    );
  });
});
