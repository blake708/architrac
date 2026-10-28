import { describe, expect, it } from "vitest";
import { isCurrent, isModuleOn, railEntries, titleForPath } from "./nav";

const TMG = [
  "build",
  "workload",
  "accounting",
  "marketing",
  "knowledge",
  "website",
  "hiring",
];

function labels(entries: ReturnType<typeof railEntries>) {
  return entries.map((e) => e.label);
}

describe("railEntries", () => {
  it("no modules on, staff: exactly the 6 core items and no Modules label", () => {
    expect(labels(railEntries([], { showOffModules: false }))).toEqual([
      "Home",
      "Projects",
      "Contacts",
      "Team",
      "Time",
      "Reports",
    ]);
  });

  it("TMG's modules: 6 core + label + 7 modules = 14 rows, no Schedule or Code", () => {
    const entries = railEntries(TMG, { showOffModules: false });
    expect(entries).toHaveLength(14);
    expect(labels(entries)).toEqual([
      "Home",
      "Projects",
      "Contacts",
      "Team",
      "Time",
      "Reports",
      "Modules",
      "Build",
      "Workload",
      "Accounting",
      "Marketing",
      "Knowledge",
      "Website",
      "Hiring",
    ]);
    expect(entries.every((e) => e.kind === "label" || !e.off)).toBe(true);
  });

  it("turning off Hiring removes it for staff", () => {
    const withoutHiring = TMG.filter((k) => k !== "hiring");
    expect(
      labels(railEntries(withoutHiring, { showOffModules: false })),
    ).not.toContain("Hiring");
  });

  it("owner/admin see modules that are off, marked off, in the same order", () => {
    const entries = railEntries(["workload"], { showOffModules: true });
    const modules = entries.slice(7);
    expect(entries[6]).toEqual({ kind: "label", label: "Modules" });
    expect(modules.map((m) => [m.label, m.kind === "item" && m.off])).toEqual([
      ["Build", true],
      ["Workload", false],
      ["Accounting", true],
      ["Marketing", true],
      ["Knowledge", true],
      ["Website", true],
      ["Hiring", true],
    ]);
  });

  it("ignores unknown keys", () => {
    expect(
      railEntries(["schedule", "code", "nonsense"], { showOffModules: false }),
    ).toHaveLength(6);
  });
});

describe("isModuleOn", () => {
  it("checks modules_enabled", () => {
    expect(isModuleOn({ modulesEnabled: TMG }, "build")).toBe(true);
    expect(isModuleOn({ modulesEnabled: [] }, "build")).toBe(false);
  });
});

describe("isCurrent", () => {
  it("Home only on an exact match", () => {
    expect(isCurrent("/app", "/app")).toBe(true);
    expect(isCurrent("/app/", "/app")).toBe(true);
    expect(isCurrent("/app/projects", "/app")).toBe(false);
  });

  it("other items match themselves and pages below them", () => {
    expect(isCurrent("/app/projects", "/app/projects")).toBe(true);
    expect(isCurrent("/app/projects/123", "/app/projects")).toBe(true);
    expect(isCurrent("/app/projectsx", "/app/projects")).toBe(false);
    expect(isCurrent("/app/time", "/app/projects")).toBe(false);
  });
});

describe("titleForPath", () => {
  it("names pages from their path", () => {
    expect(titleForPath("/app")).toBe("Home");
    expect(titleForPath("/app/projects/123")).toBe("Projects");
    expect(titleForPath("/app/build")).toBe("Build");
    expect(titleForPath("/app/settings/firm")).toBe("Settings");
    expect(titleForPath("/app/does-not-exist")).toBeNull();
  });
});
