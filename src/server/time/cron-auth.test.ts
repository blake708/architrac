import { describe, expect, it } from "vitest";
import { cronAuthorized } from "./cron-auth";

describe("cronAuthorized", () => {
  it("needs the exact bearer secret, and a secret to be set", () => {
    expect(cronAuthorized("Bearer s3cret", "s3cret")).toBe(true);
    expect(cronAuthorized("Bearer wrong!", "s3cret")).toBe(false);
    expect(cronAuthorized(null, "s3cret")).toBe(false);
    expect(cronAuthorized("Bearer ", "")).toBe(false);
    expect(cronAuthorized("Bearer undefined", undefined)).toBe(false);
  });
});
