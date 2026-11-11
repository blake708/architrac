import { describe, expect, it } from "vitest";
import { counterIn, formatNumber, usesProject, validateNumberFormat } from "./number-format";

// Examples from docs/specs/release-1/invoicing.md rule 1 (decision #5) and
// projects-list.md rule 5 (decision #28).

describe("formatNumber", () => {
  it("{YYYY}-{###}: 2026-128, then 2027-129 in January (no reset)", () => {
    expect(formatNumber("{YYYY}-{###}", "invoice", { year: 2026, n: 128 })).toBe("2026-128");
    expect(formatNumber("{YYYY}-{###}", "invoice", { year: 2027, n: 129 })).toBe("2027-129");
  });

  it("{PROJECT}-{##}: per-project invoices", () => {
    expect(formatNumber("{PROJECT}-{##}", "invoice", { year: 2026, projectNumber: "2026-014", n: 4 })).toBe("2026-014-04");
    expect(formatNumber("{PROJECT}-{##}", "invoice", { year: 2026, projectNumber: "26031", n: 4 })).toBe("26031-04");
  });

  it("{YY} and text around the codes", () => {
    expect(formatNumber("INV{YY}{####}", "invoice", { year: 2026, n: 7 })).toBe("INV260007");
    expect(formatNumber("{YY}{###}", "project", { year: 2026, n: 31 })).toBe("26031");
    expect(formatNumber("{YY}{###}", "project", { year: 2009, n: 1 })).toBe("09001");
  });

  it("pads but never cuts the counter", () => {
    expect(formatNumber("{YYYY}-{##}", "invoice", { year: 2026, n: 128 })).toBe("2026-128");
    expect(formatNumber("{#}", "invoice", { year: 2026, n: 5 })).toBe("5");
  });

  it("codes ignore case", () => {
    expect(formatNumber("{yy}{###}", "project", { year: 2026, n: 31 })).toBe("26031");
  });

  it("refuses a format that needs a project number it wasn't given", () => {
    expect(() => formatNumber("{PROJECT}-{##}", "invoice", { year: 2026, n: 1 })).toThrow();
  });

  it("refuses a bad format or counter", () => {
    expect(() => formatNumber("{YYYY}", "invoice", { year: 2026, n: 1 })).toThrow();
    expect(() => formatNumber("{###}", "invoice", { year: 2026, n: 0 })).toThrow();
  });
});

describe("validateNumberFormat", () => {
  it("accepts the examples", () => {
    for (const f of ["{YYYY}-{###}", "{PROJECT}-{##}", "INV{YY}{####}", "{YY}{###}", "A.{######}_x y"])
      expect(validateNumberFormat(f, "invoice"), f).toBeNull();
    for (const f of ["{YYYY}-{###}", "{YY}{###}", "P{####}"]) expect(validateNumberFormat(f, "project"), f).toBeNull();
  });

  it("needs exactly one counter", () => {
    expect(validateNumberFormat("{YYYY}-", "invoice")).toBe("Add a counter, like {###}.");
    expect(validateNumberFormat("{###}-{##}", "invoice")).toBe("Use only one counter.");
    expect(validateNumberFormat("{#######}", "invoice")).toBe("A counter can have at most 6 #.");
  });

  it("rejects unknown codes, stray braces and odd characters", () => {
    expect(validateNumberFormat("{FOO}-{###}", "invoice")).toMatch(/^Unknown code \{FOO\}/);
    expect(validateNumberFormat("{YYYY-{###}", "invoice")).toMatch(/Unknown code|matching/);
    expect(validateNumberFormat("{###}}", "invoice")).toBe("Every { needs a matching }.");
    expect(validateNumberFormat("<b>{###}", "invoice")).toMatch(/^Only letters/);
    expect(validateNumberFormat("{YYYY}/{###}", "invoice")).toMatch(/^Only letters/);
    expect(validateNumberFormat("", "invoice")).toMatch(/^Enter a format/);
  });

  it("{PROJECT} only in invoice formats, and only once", () => {
    expect(validateNumberFormat("{PROJECT}-{##}", "project")).toBe("{PROJECT} can't be used in a project number.");
    expect(validateNumberFormat("{PROJECT}{PROJECT}{#}", "invoice")).toBe("{PROJECT} can only be used once.");
  });

  it("project formats keep to the project number rules", () => {
    expect(validateNumberFormat("{YY}.{###}", "project")).toBe("Only letters, numbers and dashes can go between codes.");
    expect(validateNumberFormat("ABCDEFGHIJKLMNOP{######}", "project")).toMatch(/up to 20 characters/);
  });
});

describe("counterIn", () => {
  it("reads the counter back with this year filled in", () => {
    expect(counterIn("26031", "{YY}{###}", "project", { year: 2026 })).toBe(31);
    expect(counterIn("26031", "{YY}{###}", "project", { year: 2027 })).toBeNull();
    expect(counterIn("2026-1000", "{YYYY}-{###}", "project", { year: 2026 })).toBe(1000);
    expect(counterIn("2026-9x", "{YYYY}-{###}", "project", { year: 2026 })).toBeNull();
    expect(counterIn("p0411", "P{####}", "project", { year: 2026 })).toBe(411);
  });

  it("with a project number", () => {
    expect(counterIn("26031-04", "{PROJECT}-{##}", "invoice", { year: 2026, projectNumber: "26031" })).toBe(4);
    expect(counterIn("26032-04", "{PROJECT}-{##}", "invoice", { year: 2026, projectNumber: "26031" })).toBeNull();
  });
});

describe("usesProject", () => {
  it("tells per-project formats apart", () => {
    expect(usesProject("{PROJECT}-{##}")).toBe(true);
    expect(usesProject("{project}-{##}")).toBe(true);
    expect(usesProject("{YYYY}-{###}")).toBe(false);
  });
});
