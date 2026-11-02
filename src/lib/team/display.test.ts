import { describe, expect, it } from "vitest";
import type { PersonRow } from "@/server/team/view";
import {
  avatarColor,
  filterPeople,
  formatWeekHours,
  rateLine,
  teamSubLine,
} from "./display";

const person = (p: Partial<PersonRow>): PersonRow => ({
  id: "x",
  kind: "member",
  firstName: "Kim",
  lastName: "Lee",
  initials: "KL",
  avatarUrl: null,
  email: "kim@example.com",
  title: "Designer",
  appRole: "staff",
  firmRoleId: null,
  roleName: "Designer",
  teamId: "med",
  teamName: "Medical studio",
  leadsTeam: false,
  leaderInitials: "JR",
  weeklyHours: 40,
  targetBp: 8500,
  employmentType: "full_time",
  access: "Member",
  active: true,
  phone: null,
  licenseNote: null,
  startDate: null,
  isPrincipal: false,
  ...p,
});

const PEOPLE = [
  person({ id: "kl" }),
  person({ id: "tc", firstName: "Tom", lastName: "Cruz", roleName: "Project architect", teamId: "com" }),
  person({ id: "sg", firstName: "Sam", lastName: "Gray", roleName: "Project architect", teamId: null }),
];

describe("filterPeople", () => {
  it('"project arch" finds the project architects', () => {
    expect(filterPeople(PEOPLE, "project arch", "all").map((p) => p.id)).toEqual(["tc", "sg"]);
  });
  it("filters by team and by no team", () => {
    expect(filterPeople(PEOPLE, "", "med").map((p) => p.id)).toEqual(["kl"]);
    expect(filterPeople(PEOPLE, "", "none").map((p) => p.id)).toEqual(["sg"]);
  });
  it("searches names, ignoring case", () => {
    expect(filterPeople(PEOPLE, "CRUZ", "all").map((p) => p.id)).toEqual(["tc"]);
  });
});

describe("display rules", () => {
  it("avatar shade comes from the initials (rule 8)", () => {
    // K=75, L=76 → 151 % 6 = 1
    expect(avatarColor("KL")).toBe("#2A2A2A");
  });
  it("team sub-line (rule 7)", () => {
    expect(teamSubLine(person({}))).toBe("Leader · JR");
    expect(teamSubLine(person({ leadsTeam: true }))).toBe("Leads this team");
    expect(teamSubLine(person({ leaderInitials: null }))).toBe("No leader set");
    expect(teamSubLine(person({ teamId: null }))).toBeNull();
  });
  it("rate line", () => {
    expect(rateLine(person({}))).toBeNull(); // not sent to this viewer
    expect(rateLine(person({ rate: null }))).toEqual({ text: "No rate set", warn: true });
    expect(rateLine(person({ rate: { billCents: 0, costCents: 3800 } }))).toEqual({ text: "Not billable", warn: false });
    expect(rateLine(person({ rate: { billCents: 11500, costCents: 4400 } }))).toEqual({ text: "$115 / h", warn: false });
  });
  it("week hours", () => {
    expect(formatWeekHours(40)).toBe("40 h");
    expect(formatWeekHours(37.5)).toBe("37.5 h");
    expect(formatWeekHours(37.25)).toBe("37.25 h");
  });
});
