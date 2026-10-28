import { describe, expect, it } from "vitest";
import {
  FIRM_NAME_REQUIRED,
  PHONE_MESSAGE,
  WEBSITE_MESSAGE,
  ZIP_MESSAGE,
  type FirmProfileForm,
  firmDisplayName,
  firmProfileChanges,
  formatPhone,
  normalizeWebsite,
  parseFirmProfile,
} from "./firm-profile";

const blank: FirmProfileForm = {
  name: "The Middleton Group",
  displayName: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  phone: "",
  website: "",
  licenseNumber: "",
  timezone: "America/New_York",
  fiscalYearStartMonth: "1",
};

function parse(over: Partial<FirmProfileForm>) {
  return parseFirmProfile({ ...blank, ...over });
}

describe("normalization (business rule 5)", () => {
  it('phone "843.555.0100" → "(843) 555-0100"', () => {
    expect(formatPhone("843.555.0100")).toBe("(843) 555-0100");
    expect(formatPhone("843-555-01")).toBeNull();
  });

  it('website "https://www.TMG-Arch.com/" → "www.tmg-arch.com"', () => {
    expect(normalizeWebsite("https://www.TMG-Arch.com/")).toBe(
      "www.tmg-arch.com",
    );
    expect(normalizeWebsite("http://example.com//")).toBe("example.com");
  });

  it('display name "" saves null and the app falls back to name', () => {
    const r = parse({ displayName: "  " });
    expect(r.ok && r.values.displayName).toBeNull();
    expect(firmDisplayName({ name: "TMG Architecture", displayName: null })).toBe(
      "TMG Architecture",
    );
    expect(firmDisplayName({ name: "TMG Architecture", displayName: "TMG" })).toBe(
      "TMG",
    );
  });

  it("saves cleaned values", () => {
    const r = parse({
      phone: "843.555.0100",
      website: "https://www.TMG-Arch.com/",
      state: "sc",
      postalCode: "29401-1234",
      fiscalYearStartMonth: "7",
    });
    expect(r).toEqual({
      ok: true,
      values: expect.objectContaining({
        phone: "(843) 555-0100",
        website: "www.tmg-arch.com",
        state: "SC",
        postalCode: "29401-1234",
        fiscalYearStartMonth: 7,
        city: null,
      }),
    });
  });
});

describe("validation", () => {
  it("Firm name is required", () => {
    expect(parse({ name: "  " })).toEqual({
      ok: false,
      fieldErrors: { name: FIRM_NAME_REQUIRED },
    });
  });

  it('ZIP "2940" → "Enter a 5-digit ZIP"', () => {
    expect(parse({ postalCode: "2940" })).toEqual({
      ok: false,
      fieldErrors: { postalCode: ZIP_MESSAGE },
    });
  });

  it("phone needs 10 digits, website needs a dot and no spaces", () => {
    const r = parse({ phone: "555-0100", website: "my site" });
    expect(r).toEqual({
      ok: false,
      fieldErrors: { phone: PHONE_MESSAGE, website: WEBSITE_MESSAGE },
    });
  });

  it("rejects unknown states, time zones and months", () => {
    const r = parse({
      state: "ZZ",
      timezone: "Europe/London",
      fiscalYearStartMonth: "13",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.fieldErrors).sort()).toEqual([
        "fiscalYearStartMonth",
        "state",
        "timezone",
      ]);
    }
  });

  it("enforces lengths", () => {
    const r = parse({ displayName: "x".repeat(81), licenseNumber: "x".repeat(51) });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.fieldErrors.displayName).toMatch(/80 characters/);
      expect(r.fieldErrors.licenseNumber).toMatch(/50 characters/);
    }
  });
});

describe("firmProfileChanges", () => {
  it("lists only changed fields, by column name", () => {
    const r = parse({ displayName: "TMG" });
    if (!r.ok) throw new Error("expected ok");
    const before = { ...r.values, displayName: null };
    expect(firmProfileChanges(before, r.values)).toEqual({
      display_name: { before: null, after: "TMG" },
    });
  });
});
