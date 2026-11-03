import { describe, expect, it } from "vitest";
import { takeFlash } from "./flash";

describe("takeFlash", () => {
  it("finds the message among other cookies", () => {
    expect(takeFlash("a=1; architrac-flash=Project%202026-023%20created; b=2")).toBe("Project 2026-023 created");
  });
  it("nothing there, empty or broken → null", () => {
    expect(takeFlash("a=1")).toBeNull();
    expect(takeFlash("architrac-flash=")).toBeNull();
    expect(takeFlash("architrac-flash=%E0%A4%A")).toBeNull();
  });
});
