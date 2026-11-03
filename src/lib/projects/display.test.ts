import { describe, expect, it } from "vitest";
import type { ProjectRow } from "@/server/projects/view";
import { filterProjects, listQuery, parseListParams } from "./display";
import { parseMoney, phaseProblem } from "./form";

const row = (r: Partial<ProjectRow> & { number: string }): ProjectRow => ({
  id: r.number,
  name: r.number,
  clientName: "",
  projectType: "Office",
  scopeKind: null,
  status: "active",
  steps: [],
  phaseText: "",
  pm: null,
  constructionCostCents: null,
  ...r,
});

// Fixture F1 (projects-list spec, Acceptance tests).
const F1 = [
  row({ number: "2026-011", name: "Pine Street Bistro", clientName: "Bistro LLC", projectType: "Restaurant", money: { feeCents: 4_100_000, billedCents: 0, billedPct: 0, health: "on_track" } }),
  row({ number: "2026-014", name: "Medical Office Building", clientName: "Palmetto Medical Properties", projectType: "Medical office", money: { feeCents: 18_600_000, billedCents: 0, billedPct: 0, health: "on_track" } }),
  row({ number: "2025-004", name: "Westside Tire & Service", status: "closed" }),
];
const base = parseListParams({}, true);
const numbers = (rows: ProjectRow[]) => rows.map((r) => r.number);

describe("filters and sort", () => {
  it("active tab, newest number first", () => {
    expect(numbers(filterProjects(F1, base))).toEqual(["2026-014", "2026-011"]);
  });
  it('search "palmetto" matches the client; "2025-004" on All matches the number', () => {
    expect(numbers(filterProjects(F1, { ...base, q: " palmetto " }))).toEqual(["2026-014"]);
    expect(numbers(filterProjects(F1, { ...base, status: "all", q: "2025-004" }))).toEqual(["2025-004"]);
    expect(filterProjects(F1, { ...base, q: "zzz" })).toEqual([]);
  });
  it("largest fee first", () => {
    expect(numbers(filterProjects(F1, { ...base, sort: "fee" }))).toEqual(["2026-014", "2026-011"]);
  });
  it("type filter", () => {
    expect(numbers(filterProjects(F1, { ...base, type: "Restaurant" }))).toEqual(["2026-011"]);
  });
  it("numbers sort as numbers", () => {
    expect(numbers(filterProjects([row({ number: "2026-9" }), row({ number: "2026-10" })], base))).toEqual(["2026-10", "2026-9"]);
  });
});

describe("URL params", () => {
  it("defaults, unknown values, and staff can't sort by fee", () => {
    expect(parseListParams({ status: "bogus", sort: "fee" }, false)).toEqual({ status: "active", q: "", type: "", pm: "", sort: "number" });
    expect(listQuery({ ...base, sort: "fee", status: "all" })).toBe("status=all&sort=fee");
    expect(listQuery(base)).toBe("");
  });
});

describe("form helpers", () => {
  it("money input", () => {
    expect(parseMoney("$186,000")).toBe(18_600_000);
    expect(parseMoney("1000.01")).toBe(100_001);
    expect(parseMoney("1000.5")).toBe(100_050);
    expect(parseMoney("")).toBe(0);
    expect(parseMoney("12.345")).toBeNull();
    expect(parseMoney("-5")).toBeNull();
  });
  it("phase sums must match exactly", () => {
    const ph = [{ feeType: "fixed" as const, feeCents: 100, budgetHours: 0.25 }];
    expect(phaseProblem({ totalFeeCents: 100, totalBudgetHours: 0.25, phases: ph })).toBeNull();
    expect(phaseProblem({ totalFeeCents: 100, totalBudgetHours: 0.25, phases: [] })).toBe("Include at least one phase");
    expect(phaseProblem({ totalFeeCents: 19_000_000, totalBudgetHours: 0.25, phases: [{ ...ph[0], feeCents: 19_000_000 }] })).toBeNull();
    expect(phaseProblem({ totalFeeCents: 18_600_000, totalBudgetHours: 0.25, phases: [{ ...ph[0], feeCents: 19_000_000 }] })).toBe(
      "Phase fees add up to $190,000; total fee is $186,000",
    );
  });
});
