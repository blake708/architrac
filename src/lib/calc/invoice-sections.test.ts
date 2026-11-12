import { describe, expect, it } from "vitest";
import type { PriorLine } from "./invoice";
import {
  NTE_WRITE_DOWN,
  type SectionLine,
  type SectionPhase,
  invoiceSections,
  linesAsOf,
  roleFromDescription,
  servicesSubtotal,
} from "./invoice-sections";

// Rule 17: the invoice as the client sees it, built from its saved lines.

const INV = "inv-4";
const line = (
  l: Partial<SectionLine> & Pick<SectionLine, "lineType" | "amountCents">,
): SectionLine => ({
  projectPhaseId: null,
  consultantId: null,
  description: "",
  quantity: "1.00",
  rateCents: l.amountCents,
  percentCompleteBp: null,
  phaseFeeCents: null,
  priorBilledCents: null,
  ...l,
});
const phase = (
  id: string,
  name: string,
  feeType: SectionPhase["feeType"],
  feeCents: number,
  more: Partial<SectionPhase> = {},
): SectionPhase => ({
  id,
  name,
  feeType,
  feeCents,
  additional: false,
  archived: false,
  ...more,
});
const prior = (
  p: Partial<PriorLine> & Pick<PriorLine, "amountCents" | "lineType">,
): PriorLine => ({
  invoiceId: "inv-3",
  invoiceStatus: "sent",
  issueDate: "2026-09-16",
  projectPhaseId: null,
  percentCompleteBp: null,
  consultantId: null,
  ...p,
});

const phases = [
  phase("sd", "Schematic Design", "fixed", 2_790_000),
  phase("dd", "Design Development", "fixed", 4_650_000),
  phase("pm", "Permitting", "nte", 930_000),
  phase("om", "Owner Meetings", "hourly", 0),
  phase("if", "Interior Finishes Package", "fixed", 1_000_000, {
    additional: true,
  }),
  phase("ss", "Site Survey", "hourly", 0, { additional: true }),
];

const lines: SectionLine[] = [
  line({
    lineType: "phase_fee",
    projectPhaseId: "sd",
    amountCents: 1_116_000,
    percentCompleteBp: 10000,
    phaseFeeCents: 2_790_000,
    priorBilledCents: 1_674_000,
  }),
  line({
    lineType: "hourly",
    projectPhaseId: "pm",
    description: "Permitting · Project Architect · 8 h @ $110",
    quantity: "8.00",
    rateCents: 11_000,
    amountCents: 88_000,
  }),
  line({
    lineType: "hourly",
    projectPhaseId: "pm",
    description: "Permitting · Principal · 3 h @ $145",
    quantity: "3.00",
    rateCents: 14_500,
    amountCents: 43_500,
  }),
  line({
    lineType: "adjustment",
    projectPhaseId: "pm",
    description: "Permitting · not-to-exceed limit reached, $215 written down",
    amountCents: -21_500,
  }),
  line({
    lineType: "hourly",
    projectPhaseId: "om",
    description: "Owner Meetings · Principal · 2 h @ $195",
    quantity: "2.00",
    rateCents: 19_500,
    amountCents: 39_000,
  }),
  line({
    lineType: "phase_fee",
    projectPhaseId: "if",
    amountCents: 250_000,
    percentCompleteBp: 2500,
    phaseFeeCents: 1_000_000,
    priorBilledCents: 0,
  }),
  line({
    lineType: "hourly",
    projectPhaseId: "ss",
    description: "Site Survey · Project Architect · 4 h @ $110",
    quantity: "4.00",
    rateCents: 11_000,
    amountCents: 44_000,
  }),
  line({
    lineType: "consultant",
    consultantId: "mep",
    amountCents: 396_000,
    percentCompleteBp: 5000,
    phaseFeeCents: 1_980_000,
    priorBilledCents: 594_000,
  }),
  line({
    lineType: "adjustment",
    description: "Retainer applied",
    amountCents: -50_000,
  }),
];

const priorLines: PriorLine[] = [
  prior({
    projectPhaseId: "sd",
    lineType: "phase_fee",
    amountCents: 1_674_000,
    percentCompleteBp: 6000,
  }),
  prior({ projectPhaseId: "pm", lineType: "hourly", amountCents: 820_000 }),
  prior({
    consultantId: "mep",
    lineType: "consultant",
    amountCents: 594_000,
    percentCompleteBp: 3000,
  }),
  prior({
    consultantId: "se",
    lineType: "consultant",
    amountCents: 102_000,
    percentCompleteBp: 1000,
  }),
];

const consultants = [
  {
    id: "mep",
    label: "MEP · Coastal Engineers",
    feeCents: 1_800_000,
    markupBp: 1000,
    archived: false,
  },
  {
    id: "se",
    label: "Structural · Lowcountry SE",
    feeCents: 1_020_000,
    markupBp: 0,
    archived: false,
  },
];

const subtotalCents = lines.reduce((n, l) => n + l.amountCents, 0);
const x = invoiceSections({
  invoiceId: INV,
  lines,
  phases,
  consultants,
  priorLines,
  subtotalCents,
});

describe("invoiceSections", () => {
  it("fixed-fee phases: as billed on the line, and a row for phases with nothing this time", () => {
    expect(x.contract.fixed).toEqual([
      {
        name: "Schematic Design",
        feeCents: 2_790_000,
        percentCompleteBp: 10000,
        earnedCents: 2_790_000,
        previousCents: 1_674_000,
        thisCents: 1_116_000,
      },
      {
        name: "Design Development",
        feeCents: 4_650_000,
        percentCompleteBp: 0,
        earnedCents: 0,
        previousCents: 0,
        thisCents: 0,
      },
    ]);
    // $27,900 of $74,400 → 37.5%.
    expect(x.contract.fixedTotal).toEqual({
      feeCents: 7_440_000,
      percentCompleteBp: 3750,
      earnedCents: 2_790_000,
      previousCents: 1_674_000,
      thisCents: 1_116_000,
    });
  });

  it("NTE phases: limit, billed, remaining, with role lines and the write-down under them", () => {
    expect(x.contract.nte).toEqual([
      {
        name: "Permitting",
        limitCents: 930_000,
        previousCents: 820_000,
        thisCents: 110_000,
        billedToDateCents: 930_000,
        remainingCents: 0,
        lines: [
          {
            role: "Project Architect",
            hoursHundredths: 800,
            rateCents: 11_000,
            amountCents: 88_000,
          },
          {
            role: "Principal",
            hoursHundredths: 300,
            rateCents: 14_500,
            amountCents: 43_500,
          },
          {
            role: NTE_WRITE_DOWN,
            hoursHundredths: null,
            rateCents: null,
            amountCents: -21_500,
          },
        ],
      },
    ]);
  });

  it("hourly phases list their role lines", () => {
    expect(x.contract.hourly).toEqual([
      {
        phase: "Owner Meetings",
        role: "Principal",
        hoursHundredths: 200,
        rateCents: 19_500,
        amountCents: 39_000,
      },
    ]);
    expect(x.contract.hourlyTotalCents).toBe(39_000);
  });

  it("additional services are kept apart from the base contract", () => {
    expect(x.additional.fixed.map((r) => r.name)).toEqual([
      "Interior Finishes Package",
    ]);
    expect(x.additional.hourly.map((r) => r.phase)).toEqual(["Site Survey"]);
    expect(x.additional.empty).toBe(false);
    expect(x.contract.fixed.map((r) => r.name)).not.toContain(
      "Interior Finishes Package",
    );
  });

  it("consultants: as billed, plus a row for one with nothing this time", () => {
    expect(x.consultants).toEqual([
      {
        name: "MEP · Coastal Engineers",
        feeCents: 1_980_000,
        percentCompleteBp: 5000,
        earnedCents: 990_000,
        previousCents: 594_000,
        thisCents: 396_000,
      },
      {
        name: "Structural · Lowcountry SE",
        feeCents: 1_020_000,
        percentCompleteBp: 1000,
        earnedCents: 102_000,
        previousCents: 102_000,
        thisCents: 0,
      },
    ]);
    // $10,920 earned of $30,000 → 36.4%.
    expect(x.consultantsTotal.percentCompleteBp).toBe(3640);
  });

  it("adjustments and the subtotal before them", () => {
    expect(x.adjustments).toEqual([
      { description: "Retainer applied", amountCents: -50_000 },
    ]);
    expect(x.servicesSubtotalCents).toBe(subtotalCents + 50_000);
  });

  it("archived phases and consultants print only when this invoice billed them", () => {
    const y = invoiceSections({
      invoiceId: INV,
      lines: [
        line({
          lineType: "phase_fee",
          projectPhaseId: "old",
          amountCents: 5_000,
          percentCompleteBp: 10000,
          phaseFeeCents: 10_000,
          priorBilledCents: 5_000,
        }),
      ],
      phases: [
        phase("old", "Old Phase", "fixed", 10_000, { archived: true }),
        phase("gone", "Gone Phase", "fixed", 10_000, { archived: true }),
      ],
      consultants: [{ ...consultants[1]!, archived: true }],
      priorLines: [],
      subtotalCents: 5_000,
    });
    expect(y.contract.fixed.map((r) => r.name)).toEqual(["Old Phase"]);
    expect(y.consultants).toEqual([]);
    expect(y.additional.empty).toBe(true);
  });
});

describe("linesAsOf", () => {
  const at = (iso: string) => new Date(iso);
  const all = [
    {
      ...prior({ invoiceId: "a", amountCents: 1, lineType: "hourly" }),
      sentAt: at("2026-09-01T12:00:00Z"),
    },
    {
      ...prior({ invoiceId: INV, amountCents: 2, lineType: "hourly" }),
      sentAt: at("2026-10-01T12:00:00Z"),
    },
    {
      ...prior({ invoiceId: "later", amountCents: 3, lineType: "hourly" }),
      sentAt: at("2026-11-01T12:00:00Z"),
    },
    {
      ...prior({
        invoiceId: "draft",
        amountCents: 4,
        lineType: "hourly",
        invoiceStatus: "draft",
      }),
      sentAt: null,
    },
  ];
  it("a sent invoice counts only invoices sent before it", () => {
    expect(
      linesAsOf(all, INV, at("2026-10-01T12:00:00Z")).map((l) => l.invoiceId),
    ).toEqual(["a", INV]);
  });
  it("a draft counts everything", () => {
    expect(linesAsOf(all, INV, null)).toHaveLength(4);
  });
});

describe("helpers", () => {
  it("role from a line description", () => {
    expect(
      roleFromDescription("Permitting · Principal · 3 h @ $145", "Permitting"),
    ).toBe("Principal");
    // A renamed phase still finds the role between the first and last parts.
    expect(
      roleFromDescription(
        "Permits · Project Architect · 8 h @ $110",
        "Permitting",
      ),
    ).toBe("Project Architect");
    expect(roleFromDescription("Odd line", "Permitting")).toBe("Odd line");
  });
  it("subtotal before adjustments", () => {
    expect(servicesSubtotal(2_109_000, [{ amountCents: -50_000 }])).toBe(
      2_159_000,
    );
    expect(servicesSubtotal(100, [])).toBe(100);
  });
});
