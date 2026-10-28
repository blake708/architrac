import { describe, expect, it } from "vitest";
import { initials } from "./initials";

describe("initials", () => {
  it("uses first and last name", () => {
    expect(initials("Blake Middleton")).toBe("BM");
    expect(initials("Mary Ann de la Cruz")).toBe("MC");
  });
  it("uses the first two letters of a single name", () => {
    expect(initials("cher")).toBe("CH");
  });
  it("ignores extra spaces and handles blanks", () => {
    expect(initials("  ana   lopez ")).toBe("AL");
    expect(initials("   ")).toBe("?");
  });
});
