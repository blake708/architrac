import { describe, expect, it } from "vitest";
import {
  companyBilled,
  companyOpen,
  consultantFees,
  missingBillingContact,
} from "./contacts";

describe("client money (rule 4)", () => {
  // Palmetto Medical Properties: 2026-101 $18,600 paid; 2026-112 $18,600
  // sent with $7,440 paid.
  const palmetto = [
    { status: "paid" as const, totalCents: 1_860_000, amountPaidCents: 1_860_000 },
    { status: "sent" as const, totalCents: 1_860_000, amountPaidCents: 744_000 },
  ];

  it("billed $37,200, open $11,160", () => {
    expect(companyBilled(palmetto)).toBe(3_720_000);
    expect(companyOpen(palmetto)).toBe(1_116_000);
  });

  it("drafts and voids aren't billed", () => {
    const more = [
      ...palmetto,
      { status: "draft" as const, totalCents: 500_000, amountPaidCents: 0 },
      { status: "void" as const, totalCents: 900_000, amountPaidCents: 0 },
    ];
    expect(companyBilled(more)).toBe(3_720_000);
    expect(companyOpen(more)).toBe(1_116_000);
  });

  it("all paid → nothing open; written off is billed but not open", () => {
    expect(companyOpen([{ status: "paid", totalCents: 100, amountPaidCents: 100 }])).toBe(0);
    const wo = [{ status: "written_off" as const, totalCents: 500, amountPaidCents: 0 }];
    expect(companyBilled(wo)).toBe(500);
    expect(companyOpen(wo)).toBe(0);
  });
});

describe("consultant fees (rule 5)", () => {
  it("Coastal MEP: $28,500 + $13,800 = $42,300", () => {
    expect(
      consultantFees([
        { feeCents: 2_850_000, projectArchived: false },
        { feeCents: 1_380_000, projectArchived: false },
        { feeCents: 999_900, projectArchived: true },
      ]),
    ).toBe(4_230_000);
  });
});

describe("missing billing contact (rule 6)", () => {
  it("clients need an active billing contact with an email", () => {
    expect(missingBillingContact("client", null)).toBe(true);
    expect(missingBillingContact("client", { archived: true, email: "a@b.co" })).toBe(true);
    expect(missingBillingContact("client", { archived: false, email: " " })).toBe(true);
    expect(missingBillingContact("client", { archived: false, email: "a@b.co" })).toBe(false);
  });
  it("only clients count", () => {
    expect(missingBillingContact("consultant", null)).toBe(false);
  });
});
