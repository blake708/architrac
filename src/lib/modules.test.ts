import { describe, expect, it } from "vitest";
import {
  MODULES,
  MODULE_KEYS,
  modulesOnCount,
  normalizeModules,
} from "./modules";

const TMG = [
  "build",
  "workload",
  "accounting",
  "marketing",
  "knowledge",
  "website",
  "hiring",
];

describe("module keys", () => {
  it("8 modules in card order, no Schedule", () => {
    expect(MODULE_KEYS).toEqual([
      "build",
      "workload",
      "accounting",
      "marketing",
      "knowledge",
      "code",
      "website",
      "hiring",
    ]);
    expect(MODULES.map((m) => m.key)).toEqual(MODULE_KEYS);
  });
});

describe("modulesOnCount", () => {
  it("TMG seed (all but Code) is 7 of 8", () => {
    expect(modulesOnCount(TMG)).toBe(7);
  });
  it("ignores unknown and retired keys like schedule", () => {
    expect(modulesOnCount(["schedule", "nonsense", "code"])).toBe(1);
    expect(modulesOnCount([])).toBe(0);
  });
});

describe("normalizeModules", () => {
  it("keeps card order and drops repeats and unknown keys", () => {
    expect(normalizeModules(["hiring", "code", "build", "build", "x"])).toEqual(
      ["build", "code", "hiring"],
    );
  });
  it("switching Code on then off saves the same array as before", () => {
    const withCode = normalizeModules([...TMG, "code"]);
    const without = normalizeModules(withCode.filter((k) => k !== "code"));
    expect(without).toEqual(TMG);
  });
});
