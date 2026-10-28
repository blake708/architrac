import { describe, expect, it, vi } from "vitest";
import {
  FIRM_NAME_MESSAGE,
  createFirmCore,
  createFirmSchema,
  slugify,
} from "./create-firm";

// Input checks and slugs. No database or Clerk needed.

const fakeDeps = () => ({
  loadUser: vi.fn(async () => ({
    clerkUserId: "user_x",
    email: "x@example.com",
    firstName: "X",
    lastName: "Y",
    avatarUrl: null,
  })),
  createOrg: vi.fn(async () => "org_x"),
  deleteOrg: vi.fn(async () => {}),
});

describe("createFirmCore: validation", () => {
  it('rejects the name "A" with the spec\'s message and never creates a Clerk org', async () => {
    const deps = fakeDeps();
    const result = await createFirmCore(
      { name: "A", timezone: "America/New_York", fiscalYearStartMonth: "1" },
      deps,
    );
    expect(result).toEqual({
      ok: false,
      fieldErrors: { name: FIRM_NAME_MESSAGE },
    });
    expect(FIRM_NAME_MESSAGE).toBe("Firm name must be 2–120 characters");
    expect(deps.createOrg).not.toHaveBeenCalled();
  });

  it("trims spaces before counting, so '  A  ' is still too short", async () => {
    const deps = fakeDeps();
    const result = await createFirmCore(
      {
        name: "  A  ",
        timezone: "America/New_York",
        fiscalYearStartMonth: "1",
      },
      deps,
    );
    expect(result.ok).toBe(false);
    expect(deps.createOrg).not.toHaveBeenCalled();
  });

  it("rejects a name over 120 characters", () => {
    const r = createFirmSchema.safeParse({
      name: "x".repeat(121),
      timezone: "America/New_York",
      fiscalYearStartMonth: 1,
    });
    expect(r.success).toBe(false);
  });

  it("accepts exactly 2 and exactly 120 characters", () => {
    for (const name of ["AB", "x".repeat(120)]) {
      const r = createFirmSchema.safeParse({
        name,
        timezone: "America/New_York",
        fiscalYearStartMonth: "1",
      });
      expect(r.success).toBe(true);
    }
  });

  it("rejects a time zone that isn't in the list", async () => {
    const deps = fakeDeps();
    const result = await createFirmCore(
      {
        name: "Good Name",
        timezone: "Europe/Paris",
        fiscalYearStartMonth: "1",
      },
      deps,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.fieldErrors?.timezone).toBeTruthy();
    expect(deps.createOrg).not.toHaveBeenCalled();
  });

  it("rejects months outside 1–12", () => {
    for (const m of ["0", "13", "1.5", "abc"]) {
      const r = createFirmSchema.safeParse({
        name: "Good Name",
        timezone: "America/New_York",
        fiscalYearStartMonth: m,
      });
      expect(r.success, `month ${m}`).toBe(false);
    }
  });

  it("returns the generic error and saves nothing if Clerk fails", async () => {
    const deps = fakeDeps();
    deps.createOrg.mockRejectedValueOnce(new Error("Clerk is down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await createFirmCore(
      {
        name: "The Middleton Group",
        timezone: "America/New_York",
        fiscalYearStartMonth: "1",
      },
      deps,
    );
    errSpy.mockRestore();
    expect(result).toEqual({
      ok: false,
      error: "We couldn't create your firm. Nothing was saved. Try again.",
    });
    expect(deps.deleteOrg).not.toHaveBeenCalled();
  });
});

describe("slugify", () => {
  it.each([
    ["The Middleton Group", "the-middleton-group"],
    ["Smith & Jones, PLLC", "smith-jones-pllc"],
    ["  Café Ünïcode  ", "cafe-unicode"],
    ["!!!", "firm"],
  ])("%s → %s", (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });

  it("is at most 60 characters and doesn't end in a dash", () => {
    const slug = slugify("a ".repeat(100));
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
  });
});
