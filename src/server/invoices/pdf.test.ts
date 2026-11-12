import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import {
  type FeeRow,
  type InvoiceSections,
  NTE_WRITE_DOWN,
  feeTotals,
  group,
} from "@/lib/calc/invoice-sections";
import type { InvoicePdfData } from "./pdf-data";
import { addressLines } from "./pdf-data";
import { pdfFileName, pdfMoney, renderInvoicePdf } from "./pdf";

// Rule 17: the PDF prints the number, bill-to, the Fee / Not-to-exceed /
// Hourly / Additional services / Consultants tables, then Subtotal (only
// with adjustments), the adjustments and the total, and "Page x of N"; a
// draft preview carries the DRAFT watermark. The numbers in these tables
// come from invoiceSections() (tested in invoice-sections.test.ts); here
// we check what prints and where.

const fee = (
  name: string,
  feeCents: number,
  pctBp: number,
  previousCents: number,
  thisCents: number,
): FeeRow => ({
  name,
  feeCents,
  percentCompleteBp: pctBp,
  earnedCents: previousCents + thisCents,
  previousCents,
  thisCents,
});

const permitting = {
  // Spec rule 5 example: limit $9,300, $8,200 before, $1,315 of time → $1,100 billed, $215 written down.
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
};

const consultants = [
  fee("MEP · Coastal Engineers", 1_980_000, 5000, 594_000, 396_000),
  fee("Structural · Lowcountry SE", 1_020_000, 2000, 0, 204_000),
];

const sections = (over: Partial<InvoiceSections> = {}): InvoiceSections => ({
  contract: group(
    [
      fee("Schematic Design", 2_790_000, 10000, 1_674_000, 1_116_000),
      fee("Design Development", 4_650_000, 0, 0, 0),
    ],
    [permitting],
    [
      {
        phase: "Owner Meetings",
        role: "Principal",
        hoursHundredths: 200,
        rateCents: 19_500,
        amountCents: 39_000,
      },
    ],
  ),
  additional: group(
    [fee("Interior Finishes Package", 1_000_000, 2500, 0, 250_000)],
    [],
    [
      {
        phase: "Site Survey",
        role: "Project Architect",
        hoursHundredths: 400,
        rateCents: 11_000,
        amountCents: 44_000,
      },
    ],
  ),
  consultants,
  consultantsTotal: feeTotals(consultants),
  adjustments: [{ description: "Retainer applied", amountCents: -50_000 }],
  servicesSubtotalCents: 2_159_000,
  ...over,
});

const base: InvoicePdfData = {
  mark: null,
  firm: {
    name: "The Middleton Group",
    logoUrl: null,
    address: ["12 King St", "Charleston, SC 29401"],
    phone: "843-555-0100",
    email: "office@tmg.example",
  },
  number: "26031-04",
  issueDate: "2026-10-16",
  dueDate: "2026-11-15",
  termsDays: 30,
  periodEnd: "2026-10-31",
  billTo: {
    company: "Harbor Health",
    contact: "Pat Lee",
    address: ["1 Bay Rd", "Mt Pleasant, SC 29464"],
  },
  project: { number: "26031", name: "Medical Office Building", address: [] },
  memo: "Thank you for your business.",
  sections: sections(),
  subtotalCents: 2_109_000,
  taxCents: 0,
  totalCents: 2_109_000,
  prior: [{ number: "26031-03", balanceCents: 1_116_000 }],
  timeDetail: [
    {
      date: "2026-10-05",
      person: "Blake Middleton",
      phase: "Owner Meetings",
      hours: "2.00",
      note: "Site visit",
    },
  ],
  remittance: "Make checks payable to The Middleton Group, LLC.",
};

async function text(bytes: Uint8Array) {
  const pdf = await getDocumentProxy(bytes);
  const { text: pages, totalPages } = await extractText(pdf, {
    mergePages: false,
  });
  return { all: pages.join("\n"), pages, totalPages };
}

const ws = (t: string) => t.replace(/\s+/g, " ");

describe("invoice PDF", () => {
  it(
    "prints the number, bill-to, every table, totals and page numbers",
    { timeout: 30_000 },
    async () => {
      const bytes = await renderInvoicePdf(base);
      expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
      const { all, totalPages } = await text(bytes);
      // Time detail always starts its own page, so there are at least two.
      expect(totalPages).toBeGreaterThanOrEqual(2);
      expect(all).toContain(`Page ${totalPages} of ${totalPages}`);
      for (const s of [
        "INVOICE",
        "26031-04",
        "Harbor Health",
        "Pat Lee",
        "Schematic Design",
        "$11,160.00",
        "Design Development",
        "MEP · Coastal Engineers",
        "$3,960.00",
        "−$215.00",
        "Retainer applied",
        "Amount due this invoice",
        "$21,090.00",
        "Total balance due",
        "$32,250.00",
        "Site visit",
        "Make checks payable to The Middleton Group, LLC.",
        "Net 30",
      ])
        expect(all, s).toContain(s);
      expect(all).not.toContain("DRAFT");
    },
  );

  it(
    "a draft preview carries the DRAFT watermark and no number",
    { timeout: 30_000 },
    async () => {
      const { all } = await text(
        await renderInvoicePdf({
          ...base,
          mark: "DRAFT",
          number: null,
          timeDetail: [],
          prior: [],
        }),
      );
      expect(all).toContain("DRAFT");
      expect(all).toMatch(/Page (\d+) of \1/);
      expect(all).not.toContain("Total balance due");
    },
  );
});

describe("tables", () => {
  it(
    "fee and consultant totals show fee, overall % complete, earned and billed",
    { timeout: 30_000 },
    async () => {
      const all = ws(
        (await text(await renderInvoicePdf({ ...base, timeDetail: [] }))).all,
      );
      // Contract fee: $27,900 earned of $74,400 → 37.5%.
      expect(all).toMatch(
        /Total \$74,400\.00 37\.5% \$27,900\.00 \$16,740\.00 \$11,160\.00/,
      );
      // Consultants: $11,940 earned of $30,000 → 39.8%.
      expect(all).toMatch(
        /Total \$30,000\.00 39\.8% \$11,940\.00 \$5,940\.00 \$6,000\.00/,
      );
    },
  );

  it(
    "NTE phases show limit, billed and remaining, with their hours under each phase",
    { timeout: 30_000 },
    async () => {
      const all = ws(
        (await text(await renderInvoicePdf({ ...base, timeDetail: [] }))).all,
      );
      const at = (t: string) => all.indexOf(t);
      expect(all).toContain("Not-to-exceed");
      expect(all).toMatch(
        /Permitting \$9,300\.00 \$8,200\.00 \$1,100\.00 \$9,300\.00 \$0\.00/,
      );
      expect(at("Project Architect · 8.00 h @ $110.00")).toBeGreaterThan(
        at("Permitting"),
      );
      expect(at(NTE_WRITE_DOWN)).toBeGreaterThan(
        at("Principal · 3.00 h @ $145.00"),
      );
      // NTE work isn't repeated in the hourly table.
      expect(all.split("Permitting").length - 1).toBe(1);
    },
  );

  it(
    "additional services print in their own sections after the base contract",
    { timeout: 30_000 },
    async () => {
      const all = ws(
        (await text(await renderInvoicePdf({ ...base, timeDetail: [] }))).all,
      );
      const at = (t: string) => all.indexOf(t);
      expect(at("Additional services")).toBeGreaterThan(at("Owner Meetings"));
      expect(at("Interior Finishes Package")).toBeGreaterThan(
        at("Additional services"),
      );
      expect(at("Additional services · hourly")).toBeGreaterThan(
        at("Interior Finishes Package"),
      );
      expect(at("Site Survey")).toBeGreaterThan(
        at("Additional services · hourly"),
      );
      expect(at("Consultants")).toBeGreaterThan(at("Site Survey"));
      expect(all).toMatch(
        /Total \$10,000\.00 25% \$2,500\.00 \$0\.00 \$2,500\.00/,
      );
    },
  );

  it("no additional services → no section", { timeout: 30_000 }, async () => {
    const s = sections({ additional: group([], [], []) });
    const { all } = await text(
      await renderInvoicePdf({ ...base, sections: s, timeDetail: [] }),
    );
    expect(all).not.toContain("Additional services");
  });
});

describe("totals", () => {
  it(
    "subtotal, then each adjustment, then the amount due",
    { timeout: 30_000 },
    async () => {
      const all = ws(
        (await text(await renderInvoicePdf({ ...base, timeDetail: [] }))).all,
      );
      expect(all).toMatch(
        /Subtotal \$21,590\.00 Retainer applied −\$500\.00 Amount due this invoice \$21,090\.00/,
      );
      // No separate Adjustments table any more.
      expect(all).not.toMatch(/Adjustments/i);
    },
  );

  it("no adjustments → no subtotal line", { timeout: 30_000 }, async () => {
    const s = sections({ adjustments: [], servicesSubtotalCents: 2_109_000 });
    const all = ws(
      (
        await text(
          await renderInvoicePdf({ ...base, sections: s, timeDetail: [] }),
        )
      ).all,
    );
    expect(all).not.toContain("Subtotal");
    expect(all).toContain("Amount due this invoice $21,090.00");
  });
});

describe("page breaks", () => {
  it(
    "a section that would split moves whole to the next page",
    { timeout: 30_000 },
    async () => {
      // Enough fixed-fee phases to push the Consultants section near the foot of page 1.
      const many = Array.from({ length: 22 }, (_, i) =>
        fee(
          `Phase ${String(i + 1).padStart(2, "0")}`,
          100_000,
          5000,
          0,
          50_000,
        ),
      );
      const s = sections({
        contract: group(many, [], []),
        additional: group([], [], []),
      });
      const { pages } = await text(
        await renderInvoicePdf({
          ...base,
          sections: s,
          timeDetail: [],
          memo: null,
        }),
      );
      const page = (t: string) => pages.findIndex((p) => p.includes(t));
      // Each section's title, rows and total row land on the same page.
      expect(page("Phase 01")).toBe(page("Phase 22"));
      expect(page("Consultants")).toBe(page("Structural · Lowcountry SE"));
      expect(page("Consultants")).toBe(page("$30,000.00"));
    },
  );
});

describe("PDF helpers", () => {
  it("money always shows cents, with a real minus", () => {
    expect(pdfMoney(1_116_000)).toBe("$11,160.00");
    expect(pdfMoney(-21_500)).toBe("−$215.00");
  });
  it("file names", () => {
    expect(pdfFileName("26031-04")).toBe("Invoice-26031-04.pdf");
    expect(pdfFileName("2026 128")).toBe("Invoice-2026-128.pdf");
  });
  it("address lines", () => {
    expect(
      addressLines({
        addressLine1: "1 Bay Rd",
        addressLine2: null,
        city: "Mt Pleasant",
        state: "SC",
        postalCode: "29464",
      }),
    ).toEqual(["1 Bay Rd", "Mt Pleasant, SC 29464"]);
  });
});
