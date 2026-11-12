import { describe, expect, it } from "vitest";
import type { CompanyRow, ContactRow } from "@/server/contacts/view";
import { filterCompanies, filterPeople, moneyCell, personName } from "./display";
import { monogram, normalizeWebsite, personInitials } from "./form";

const company = (c: Partial<CompanyRow>): CompanyRow => ({
  id: "x",
  name: "X",
  kind: "client",
  description: null,
  phone: null,
  website: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  state: null,
  postalCode: null,
  notes: null,
  primaryContactId: null,
  billingContactId: null,
  billingEmail: null,
  missingBilling: false,
  projects: [],
  ...c,
});
const person = (p: Partial<ContactRow>): ContactRow => ({
  id: "p",
  firstName: "A",
  lastName: "B",
  designations: null,
  title: null,
  email: null,
  phone: null,
  mobile: null,
  tags: [],
  notes: null,
  companyId: null,
  companyArchived: false,
  ...p,
});

const COMPANIES = [
  company({ id: "pmp", name: "Palmetto Medical Properties", description: "Medical developer" }),
  company({ id: "mep", name: "Coastal MEP Engineers", kind: "consultant", primaryContactId: "rk" }),
];
const PEOPLE = [
  person({ id: "rk", firstName: "Ravi", lastName: "Kumar", designations: "PE", companyId: "mep" }),
  person({ id: "jb", firstName: "Jo", lastName: "Banks", tags: ["Billing"], companyId: "pmp" }),
  person({ id: "solo", firstName: "Sol", lastName: "Oh" }),
];
const byId = new Map(COMPANIES.map((c) => [c.id, c]));

describe("filters (rules 2 and 8)", () => {
  it('"palm" finds only Palmetto', () => {
    expect(filterCompanies(COMPANIES, PEOPLE, "palm", "all").map((c) => c.id)).toEqual(["pmp"]);
  });
  it("companies match their main contact's name", () => {
    expect(filterCompanies(COMPANIES, PEOPLE, "ravi", "all").map((c) => c.id)).toEqual(["mep"]);
  });
  it('"billing" finds people tagged Billing', () => {
    expect(filterPeople(PEOPLE, byId, "billing", "all").map((p) => p.id)).toEqual(["jb"]);
  });
  it("kind filter uses the company's kind; no company only under All", () => {
    expect(filterPeople(PEOPLE, byId, "", "consultant").map((p) => p.id)).toEqual(["rk"]);
    expect(filterPeople(PEOPLE, byId, "", "client").map((p) => p.id)).toEqual(["jb"]);
    expect(filterPeople(PEOPLE, byId, "", "all").map((p) => p.id)).toContain("solo");
  });
});

describe("display", () => {
  it("monograms (rule 9)", () => {
    expect(monogram("Palmetto Medical Properties")).toBe("PM");
    expect(monogram("[Town of] Mount Pleasant")).toBe("TO");
    expect(monogram("3D Print Co")).toBe("PC");
    expect(personInitials("Ravi", "Kumar")).toBe("RK");
    expect(personInitials("Cher", "")).toBe("CH");
  });
  it("names carry designations", () => {
    expect(personName(PEOPLE[0])).toBe("Ravi Kumar, PE");
  });
  it("money cell", () => {
    expect(moneyCell(company({}))).toBeNull(); // not sent
    expect(moneyCell(company({ money: { kind: "client", billedCents: 0, openCents: 0 } }))).toBeNull();
    expect(moneyCell(company({ money: { kind: "client", billedCents: 3_720_000, openCents: 1_116_000 } }))).toEqual({
      main: "$37,200",
      note: "$11,160 open",
      open: true,
    });
    expect(moneyCell(company({ money: { kind: "client", billedCents: 100_000, openCents: 0 } }))?.note).toBe("Paid up");
    expect(moneyCell(company({ kind: "consultant", money: { kind: "consultant", feesCents: 4_230_000 } }))?.main).toBe("$42,300");
  });
  it("websites", () => {
    expect(normalizeWebsite("www.example.com")).toBe("https://www.example.com");
    expect(normalizeWebsite("http://x.co/")).toBe("http://x.co");
    expect(normalizeWebsite("not a site")).toBeNull();
    expect(normalizeWebsite("")).toBe("");
  });
});
