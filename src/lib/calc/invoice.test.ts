import { describe, expect, it } from "vitest";
import {
  type PriorLine,
  agingBucket,
  agingPill,
  consultantAmount,
  daysPastDue,
  divRoundHalfUp,
  endOfMonth,
  fixedFeeLine,
  formatPercentBp,
  hoursSuggestBp,
  hourlyGroups,
  hoursToHundredths,
  invoiceDueDate,
  invoiceTotals,
  lastBilledBp,
  nteCap,
  paymentProblem,
  periodStart,
  previouslyBilled,
  projectInvoiceSummary,
  statusFromPaid,
  timeValueCents,
} from "./invoice";

// Examples from docs/specs/release-1/invoicing.md, business rules 2–11.
// Seed: Medical Office Building (MOB), fixed fee $186,000; SD 15 %, DD 25 %.
// Invoices 2026-097 $9,300 (paid), 2026-109 $16,740 (paid), 2026-121 $11,160 (sent).

const line = (p: Partial<PriorLine> & Pick<PriorLine, "invoiceId" | "amountCents">): PriorLine => ({
  invoiceStatus: "paid",
  issueDate: "2026-09-16",
  projectPhaseId: "SD",
  lineType: "phase_fee",
  percentCompleteBp: null,
  ...p,
});

describe("rounding", () => {
  it("rounds half up, and half away from zero below 0", () => {
    expect(divRoundHalfUp(5, 2)).toBe(3);
    expect(divRoundHalfUp(4, 2)).toBe(2);
    expect(divRoundHalfUp(149, 100)).toBe(1);
    expect(divRoundHalfUp(150, 100)).toBe(2);
    expect(divRoundHalfUp(-150, 100)).toBe(-2);
  });

  it("reads hours exactly", () => {
    expect(hoursToHundredths("10.50")).toBe(1050);
    expect(hoursToHundredths("2.25")).toBe(225);
    expect(hoursToHundredths("4")).toBe(400);
    expect(hoursToHundredths(0.1 + 0.2)).toBe(30);
  });
});

describe("rule 2: previously billed", () => {
  const lines: PriorLine[] = [
    line({ invoiceId: "109", amountCents: 1_674_000, percentCompleteBp: 6000 }),
    line({ invoiceId: "draft", invoiceStatus: "draft", amountCents: 999 }),
    line({ invoiceId: "void", invoiceStatus: "void", amountCents: 555, percentCompleteBp: 9000 }),
    line({ invoiceId: "109", lineType: "consultant", amountCents: 50_000 }),
    line({ invoiceId: "109", projectPhaseId: "DD", amountCents: 7 }),
  ];

  it("counts sent/paid phase-fee lines on the phase, not drafts, voids or consultant lines", () => {
    expect(previouslyBilled(lines, "SD", "fixed", null)).toBe(1_674_000);
    expect(lastBilledBp(lines, "SD", null)).toBe(6000);
  });

  it("excludes the invoice being built", () => {
    expect(previouslyBilled(lines, "SD", "fixed", "109")).toBe(0);
    expect(lastBilledBp(lines, "SD", "109")).toBe(0);
  });

  it("hourly and NTE phases count hourly and adjustment lines", () => {
    const h: PriorLine[] = [
      line({ invoiceId: "1", projectPhaseId: "P", lineType: "hourly", amountCents: 900_000 }),
      line({ invoiceId: "1", projectPhaseId: "P", lineType: "adjustment", amountCents: -80_000 }),
      line({ invoiceId: "1", projectPhaseId: "P", lineType: "phase_fee", amountCents: 1 }),
    ];
    expect(previouslyBilled(h, "P", "nte", null)).toBe(820_000);
  });

  it("an NTE phase whose earlier invoice was voided bills that time again", () => {
    const h: PriorLine[] = [line({ invoiceId: "v", invoiceStatus: "void", projectPhaseId: "P", lineType: "hourly", amountCents: 820_000 })];
    expect(previouslyBilled(h, "P", "nte", null)).toBe(0);
  });

  it("last billed % comes from the most recent counted line", () => {
    const l: PriorLine[] = [
      line({ invoiceId: "a", issueDate: "2026-08-16", amountCents: 1, percentCompleteBp: 2000 }),
      line({ invoiceId: "b", issueDate: "2026-09-16", amountCents: 1, percentCompleteBp: 6000 }),
    ];
    expect(lastBilledBp(l, "SD", null)).toBe(6000);
  });
});

describe("rule 3: fixed-fee line", () => {
  const SD_FEE = 2_790_000; // 18,600,000 × 1500 / 10000
  const DD_FEE = 4_650_000;

  it("SD at 100 % after 60 % billed: $11,160 (2026-121)", () => {
    expect(fixedFeeLine({ feeCents: SD_FEE, percentCompleteBp: 10000, previouslyBilledCents: 1_674_000, lastBilledBp: 6000 })).toEqual({
      ok: true,
      earnedToDateCents: 2_790_000,
      amountCents: 1_116_000,
      omit: false,
    });
  });

  it("DD at 30 % with nothing billed: $13,950.00", () => {
    const r = fixedFeeLine({ feeCents: DD_FEE, percentCompleteBp: 3000, previouslyBilledCents: 0, lastBilledBp: 0 });
    expect(r).toMatchObject({ ok: true, amountCents: 1_395_000 });
  });

  it("the same % as last billed makes no line", () => {
    const r = fixedFeeLine({ feeCents: SD_FEE, percentCompleteBp: 6000, previouslyBilledCents: 1_674_000, lastBilledBp: 6000 });
    expect(r).toMatchObject({ ok: true, amountCents: 0, omit: true });
  });

  it("below what's already billed is refused", () => {
    expect(fixedFeeLine({ feeCents: SD_FEE, percentCompleteBp: 9000, previouslyBilledCents: 2_790_000, lastBilledBp: 10000 })).toEqual({
      ok: false,
      error: "% complete is below what's already billed (100%).",
    });
  });

  it("two decimals of percent: 30.25 % → 3025 bp", () => {
    const r = fixedFeeLine({ feeCents: DD_FEE, percentCompleteBp: 3025, previouslyBilledCents: 0, lastBilledBp: 0 });
    expect(r).toMatchObject({ ok: true, amountCents: 1_406_625 });
  });

  it("refuses a % outside 0–100", () => {
    expect(fixedFeeLine({ feeCents: 1, percentCompleteBp: 10001, previouslyBilledCents: 0, lastBilledBp: 0 }).ok).toBe(false);
  });

  it("formats basis points as a percent", () => {
    expect(formatPercentBp(6000)).toBe("60%");
    expect(formatPercentBp(3025)).toBe("30.25%");
    expect(formatPercentBp(3050)).toBe("30.5%");
    expect(formatPercentBp(3005)).toBe("30.05%");
  });
});

describe("rule 4: hourly lines", () => {
  it("groups by role and rate: 78,000 and 184,875 ($2,628.75)", () => {
    const groups = hourlyGroups([
      { roleName: "Project Architect", billRateCents: 14_500, hours: "10.50" },
      { roleName: "Principal", billRateCents: 19_500, hours: "4.00" },
      { roleName: "Project Architect", billRateCents: 14_500, hours: "2.25" },
    ]);
    expect(groups).toEqual([
      { roleName: "Principal", rateCents: 19_500, hoursHundredths: 400, amountCents: 78_000 },
      { roleName: "Project Architect", rateCents: 14_500, hoursHundredths: 1275, amountCents: 184_875 },
    ]);
    expect(groups.reduce((n, g) => n + g.amountCents, 0)).toBe(262_875);
  });

  it("a role at two frozen rates makes two lines", () => {
    expect(
      hourlyGroups([
        { roleName: "Designer", billRateCents: 11_500, hours: "1" },
        { roleName: "Designer", billRateCents: 12_000, hours: "1" },
      ]),
    ).toHaveLength(2);
  });

  it("rounds once per group", () => {
    // 0.25 h × $123.45 = $30.8625 → 3,086 cents
    expect(hourlyGroups([{ roleName: "X", billRateCents: 12_345, hours: "0.25" }])[0].amountCents).toBe(3086);
  });
});

describe("rule 5: not-to-exceed", () => {
  it("over the cap: −21,500 write-down, net $1,100.00, red warning", () => {
    expect(nteCap({ capCents: 930_000, previouslyBilledCents: 820_000, hourlyAmountCents: 131_500 })).toEqual({
      netCents: 110_000,
      writeDownCents: 21_500,
      pctOfCapBp: 10000,
      warning: "reached",
    });
  });

  it("50,000 of new time: no write-down, orange 93.5 % warning", () => {
    const r = nteCap({ capCents: 930_000, previouslyBilledCents: 820_000, hourlyAmountCents: 50_000 });
    expect(r).toMatchObject({ netCents: 50_000, writeDownCents: 0, warning: "approaching" });
    expect(formatPercentBp(r.pctOfCapBp ?? 0)).toBe("93.54%");
  });

  it("well under the cap: no warning", () => {
    expect(nteCap({ capCents: 930_000, previouslyBilledCents: 0, hourlyAmountCents: 10_000 }).warning).toBe("none");
  });

  it("cap already used up: the whole amount is written down", () => {
    expect(nteCap({ capCents: 930_000, previouslyBilledCents: 930_000, hourlyAmountCents: 5_000 })).toMatchObject({
      netCents: 0,
      writeDownCents: 5_000,
      warning: "reached",
    });
  });
});

describe("rule 6: consultant line", () => {
  it("Coastal MEP: 552,000 at 10 % markup → 607,200", () => {
    expect(consultantAmount(552_000, 1000)).toBe(607_200);
  });

  it("rounds half up", () => {
    expect(consultantAmount(5, 1000)).toBe(6); // 5.5 → 6
    expect(consultantAmount(100, 0)).toBe(100);
  });
});

describe("WIP helpers", () => {
  it("values time once: 5 h @ $145 + 2 h @ $115 = $955", () => {
    expect(timeValueCents([{ hours: "5", rateCents: 14_500 }, { hours: "2.00", rateCents: 11_500 }])).toBe(95_500);
  });
  it("suggests a % from hours, capped at 100 %", () => {
    expect(hoursSuggestBp(700, "10")).toBe(7000);
    expect(hoursSuggestBp(19_800, "186")).toBe(10000);
    expect(hoursSuggestBp(100, "0")).toBeNull();
  });
});

describe("rule 7: totals", () => {
  it("MOB October draft: DD 1,395,000 + MEP 607,200 = $20,022.00", () => {
    expect(invoiceTotals([{ amountCents: 1_395_000 }, { amountCents: 607_200 }])).toEqual({
      subtotalCents: 2_002_200,
      taxCents: 0,
      totalCents: 2_002_200,
    });
  });
});

describe("rule 8: dates", () => {
  it("issue Oct 16 + 30 days → due Nov 15", () => {
    expect(invoiceDueDate("2026-10-16", 30)).toBe("2026-11-15");
  });

  it("period starts the day after the last one, else at the project start", () => {
    expect(periodStart("2026-09-30", "2026-08-03")).toBe("2026-10-01");
    expect(periodStart(null, "2026-08-03")).toBe("2026-08-03");
    expect(periodStart(null, null)).toBeNull();
  });

  it("period through defaults to the end of the month", () => {
    expect(endOfMonth("2026-10-16")).toBe("2026-10-31");
    expect(endOfMonth("2028-02-03")).toBe("2028-02-29");
    expect(endOfMonth("2026-12-01")).toBe("2026-12-31");
  });
});

describe("rule 9: payments", () => {
  it("2026-121: 500,000 → partially paid (616,000 left); 616,000 more → paid", () => {
    expect(statusFromPaid(1_116_000, 0)).toBe("sent");
    expect(statusFromPaid(1_116_000, 500_000)).toBe("partially_paid");
    expect(statusFromPaid(1_116_000, 1_116_000)).toBe("paid");
  });

  it("refuses more than the balance, zero, or a future date", () => {
    expect(paymentProblem(616_001, 616_000, "2026-10-18", "2026-10-18")).toBe("That's more than the balance.");
    expect(paymentProblem(0, 616_000, "2026-10-18", "2026-10-18")).toBe("Enter an amount over $0.");
    expect(paymentProblem(100, 616_000, "2026-10-19", "2026-10-18")).toBe("The received date can't be in the future.");
    expect(paymentProblem(616_000, 616_000, "2026-10-18", "2026-10-18")).toBeNull();
  });
});

describe("rule 10: aging", () => {
  it("today Oct 18, 2026: 2026-121 due Nov 15 is current, 2025-188 due Jun 30 is 90+", () => {
    const a = daysPastDue("2026-10-18", "2026-11-15");
    expect(a).toBe(-28);
    expect(agingBucket(a)).toBe("current");
    expect(agingPill(a)).toEqual({ label: "Due in 28 d", tone: "neutral" });
    const b = daysPastDue("2026-10-18", "2026-06-30");
    expect(b).toBe(110);
    expect(agingBucket(b)).toBe("90_plus");
    expect(agingPill(b).tone).toBe("danger");
  });

  it("bucket edges", () => {
    expect([0, 1, 30, 31, 60, 61, 90, 91].map(agingBucket)).toEqual([
      "current",
      "1_30",
      "1_30",
      "31_60",
      "31_60",
      "61_90",
      "61_90",
      "90_plus",
    ]);
    expect(agingPill(12)).toEqual({ label: "12 d late", tone: "attention" });
    expect(agingPill(31).tone).toBe("danger");
  });

  it("counts days across a daylight-saving change", () => {
    expect(daysPastDue("2026-11-02", "2026-10-31")).toBe(2);
  });
});

describe("rule 11: project summary", () => {
  it("MOB: $37,200 billed · $26,040 received · $11,160 outstanding", () => {
    expect(
      projectInvoiceSummary([
        { status: "paid", totalCents: 930_000, amountPaidCents: 930_000 },
        { status: "paid", totalCents: 1_674_000, amountPaidCents: 1_674_000 },
        { status: "sent", totalCents: 1_116_000, amountPaidCents: 0 },
        { status: "draft", totalCents: 2_002_200, amountPaidCents: 0 },
        { status: "void", totalCents: 5_000, amountPaidCents: 0 },
      ]),
    ).toEqual({ billedCents: 3_720_000, receivedCents: 2_604_000, outstandingCents: 1_116_000 });
  });
});
