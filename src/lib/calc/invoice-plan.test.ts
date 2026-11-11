import { describe, expect, it } from "vitest";
import type { PriorLine } from "./invoice";
import { type PlanPhase, money, planDraft } from "./invoice-plan";

// Invoicing spec acceptance tests that are pure math (rules 2–5), on the
// MOB seed: fixed fee $186,000; SD 15 %, DD 25 %; Permitting as NTE.

const SD: PlanPhase = { id: "SD", name: "Schematic Design", sortOrder: 2, feeType: "fixed", feeCents: 2_790_000, percentCompleteBp: 6000 };
const DD: PlanPhase = { id: "DD", name: "Design Development", sortOrder: 3, feeType: "fixed", feeCents: 4_650_000, percentCompleteBp: 0 };
const PERM: PlanPhase = { id: "PERM", name: "Permitting", sortOrder: 5, feeType: "nte", feeCents: 930_000, percentCompleteBp: 0 };
const ADD: PlanPhase = { id: "ADD", name: "Additional Services", sortOrder: 7, feeType: "hourly", feeCents: 0, percentCompleteBp: 0 };

const prior = (p: Partial<PriorLine> & Pick<PriorLine, "amountCents">): PriorLine => ({
  invoiceId: "109",
  invoiceStatus: "paid",
  issueDate: "2026-09-16",
  projectPhaseId: "SD",
  lineType: "phase_fee",
  percentCompleteBp: null,
  ...p,
});
const SD_AT_60 = prior({ amountCents: 1_674_000, percentCompleteBp: 6000 });

describe("planDraft", () => {
  it("DD set to 30 %: one phase-fee line of 1,395,000", () => {
    const plan = planDraft({ invoiceId: "new", phases: [SD, { ...DD, percentCompleteBp: 3000 }], priorLines: [SD_AT_60], entries: [] });
    expect(plan.lines).toEqual([
      {
        key: "fee:DD",
        lineType: "phase_fee",
        projectPhaseId: "DD",
        description: "Design Development · 30% complete",
        quantity: "1.00",
        rateCents: 1_395_000,
        amountCents: 1_395_000,
        percentCompleteBp: 3000,
        phaseFeeCents: 4_650_000,
        priorBilledCents: 0,
        sortOrder: 200,
      },
    ]);
  });

  it("SD at 100 % after 60 % billed: 1,116,000; the same % as last billed makes no line", () => {
    const plan = planDraft({ invoiceId: "new", phases: [{ ...SD, percentCompleteBp: 10000 }], priorLines: [SD_AT_60], entries: [] });
    expect(plan.lines.map((l) => l.amountCents)).toEqual([1_116_000]);
    expect(plan.fixed[0]).toMatchObject({ lastBilledBp: 6000, previouslyBilledCents: 1_674_000, earnedToDateCents: 2_790_000 });
    expect(planDraft({ invoiceId: "new", phases: [SD], priorLines: [SD_AT_60], entries: [] }).lines).toEqual([]);
  });

  it("a % below what's billed shows the error and makes no line", () => {
    const plan = planDraft({
      invoiceId: "new",
      phases: [{ ...SD, percentCompleteBp: 5000 }],
      priorLines: [SD_AT_60],
      entries: [],
    });
    expect(plan.lines).toEqual([]);
    expect(plan.fixed[0].error).toBe("% complete is below what's already billed (60%).");
  });

  it("this invoice's own lines don't count as previously billed", () => {
    const plan = planDraft({
      invoiceId: "109",
      phases: [{ ...SD, percentCompleteBp: 6000 }],
      priorLines: [SD_AT_60],
      entries: [],
    });
    expect(plan.lines.map((l) => l.amountCents)).toEqual([1_674_000]);
  });

  it("hourly: 4.00 h @ 19,500 and 10.50 h + 2.25 h @ 14,500 → 78,000 and 184,875", () => {
    const plan = planDraft({
      invoiceId: "new",
      phases: [ADD],
      priorLines: [],
      entries: [
        { id: "1", phaseId: "ADD", roleName: "Principal", billRateCents: 19_500, hours: "4.00" },
        { id: "2", phaseId: "ADD", roleName: "Project Architect", billRateCents: 14_500, hours: "10.50" },
        { id: "3", phaseId: "ADD", roleName: "Project Architect", billRateCents: 14_500, hours: "2.25" },
      ],
    });
    expect(plan.lines.map((l) => [l.description, l.quantity, l.amountCents])).toEqual([
      ["Additional Services · Principal · 4 h @ $195", "4.00", 78_000],
      ["Additional Services · Project Architect · 12.75 h @ $145", "12.75", 184_875],
    ]);
    expect(plan.hourly[0]).toMatchObject({ hourlyAmountCents: 262_875, netCents: 262_875, warning: "none" });
  });

  it("groups by the frozen role, so the same person at two roles makes two lines", () => {
    const plan = planDraft({
      invoiceId: "new",
      phases: [ADD],
      priorLines: [],
      entries: [
        { id: "1", phaseId: "ADD", roleName: "Designer", billRateCents: 11_500, hours: "2" },
        { id: "2", phaseId: "ADD", roleName: "Project Architect", billRateCents: 11_500, hours: "3" },
        { id: "3", phaseId: "ADD", roleName: null, billRateCents: 11_500, hours: "1" },
      ],
    });
    expect(plan.hourly[0].groups.map((g) => g.roleName)).toEqual(["Designer", "Project Architect", "Staff"]);
  });

  it("NTE over the cap: −21,500 write-down line, phase net 110,000, red warning", () => {
    const plan = planDraft({
      invoiceId: "new",
      phases: [PERM],
      priorLines: [prior({ projectPhaseId: "PERM", lineType: "hourly", amountCents: 820_000 })],
      entries: [
        { id: "1", phaseId: "PERM", roleName: "Designer", billRateCents: 11_000, hours: "8.00" },
        { id: "2", phaseId: "PERM", roleName: "Project Architect", billRateCents: 14_500, hours: "3.00" },
      ],
    });
    expect(plan.lines.map((l) => [l.lineType, l.amountCents])).toEqual([
      ["hourly", 43_500],
      ["hourly", 88_000],
      ["adjustment", -21_500],
    ]);
    expect(plan.lines[2].description).toBe("Permitting · not-to-exceed limit reached, $215 written down");
    expect(plan.hourly[0]).toMatchObject({ netCents: 110_000, writeDownCents: 21_500, warning: "reached" });
  });

  it("NTE with 50,000 of new time: no write-down, orange warning", () => {
    const plan = planDraft({
      invoiceId: "new",
      phases: [PERM],
      priorLines: [prior({ projectPhaseId: "PERM", lineType: "hourly", amountCents: 820_000 })],
      entries: [{ id: "1", phaseId: "PERM", roleName: "Designer", billRateCents: 10_000, hours: "5" }],
    });
    expect(plan.lines.map((l) => l.lineType)).toEqual(["hourly"]);
    expect(plan.hourly[0]).toMatchObject({ netCents: 50_000, warning: "approaching", pctOfCapBp: 9354 });
  });

  it("lines sort by phase order", () => {
    const plan = planDraft({
      invoiceId: "new",
      phases: [{ ...DD, percentCompleteBp: 1000 }, ADD, { ...SD, percentCompleteBp: 10000 }],
      priorLines: [SD_AT_60],
      entries: [{ id: "1", phaseId: "ADD", roleName: "Designer", billRateCents: 11_500, hours: "1" }],
    });
    expect(plan.lines.map((l) => l.projectPhaseId)).toEqual(["SD", "DD", "ADD"]);
  });

  it("money shows cents only when there are some", () => {
    expect(money(1_116_000)).toBe("$11,160");
    expect(money(262_875)).toBe("$2,628.75");
  });
});
