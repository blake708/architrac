import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import type { InvoicePdfData } from "./pdf-data";
import { addressLines } from "./pdf-data";
import { pdfFileName, pdfMoney, renderInvoicePdf } from "./pdf";

// Rule 17: the PDF prints the number, bill-to, fee table, totals and
// "Page 1 of N"; a draft preview carries the DRAFT watermark.

const base: InvoicePdfData = {
  mark: null,
  firm: { name: "The Middleton Group", logoUrl: null, address: ["12 King St", "Charleston, SC 29401"], phone: "843-555-0100", email: "office@tmg.example" },
  number: "26031-04",
  issueDate: "2026-10-16",
  dueDate: "2026-11-15",
  termsDays: 30,
  periodEnd: "2026-10-31",
  billTo: { company: "Harbor Health", contact: "Pat Lee", address: ["1 Bay Rd", "Mt Pleasant, SC 29464"] },
  project: { number: "26031", name: "Medical Office Building", address: [] },
  memo: "Thank you for your business.",
  fixed: [
    { phase: "Schematic Design", additional: false, feeCents: 2_790_000, percentCompleteBp: 10000, earnedCents: 2_790_000, previousCents: 1_674_000, thisCents: 1_116_000 },
    { phase: "Design Development", additional: false, feeCents: 4_650_000, percentCompleteBp: 0, earnedCents: 0, previousCents: 0, thisCents: 0 },
  ],
  hourly: [
    { phase: "Additional Services", additional: true, role: "Principal", hoursHundredths: 400, rateCents: 19_500, amountCents: 78_000 },
    { phase: "Additional Services", additional: true, role: "Not-to-exceed limit reached", hoursHundredths: null, rateCents: null, amountCents: -21_500 },
  ],
  consultants: [
    { label: "MEP · Coastal Engineers", feeCents: 1_980_000, percentCompleteBp: 5000, earnedCents: 990_000, previousCents: 594_000, thisCents: 396_000 },
  ],
  adjustments: [{ description: "Retainer applied", amountCents: -50_000 }],
  subtotalCents: 1_518_500,
  taxCents: 0,
  totalCents: 1_518_500,
  prior: [{ number: "26031-03", balanceCents: 1_116_000 }],
  timeDetail: [{ date: "2026-10-05", person: "Blake Middleton", phase: "Additional Services", hours: "4.00", note: "Site visit" }],
  remittance: "Make checks payable to The Middleton Group, LLC.",
};

async function text(bytes: Uint8Array) {
  const pdf = await getDocumentProxy(bytes);
  const { text: pages, totalPages } = await extractText(pdf, { mergePages: false });
  return { all: pages.join("\n"), totalPages };
}

describe("invoice PDF", () => {
  it("prints the number, bill-to, fee table, totals and page numbers", { timeout: 30_000 }, async () => {
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
      "$15,185.00",
      "Total balance due",
      "$26,345.00",
      "Site visit",
      "Make checks payable to The Middleton Group, LLC.",
      "Net 30",
    ])
      expect(all, s).toContain(s);
    expect(all).not.toContain("DRAFT");
  });

  it("a draft preview carries the DRAFT watermark and no number", { timeout: 30_000 }, async () => {
    const { all } = await text(await renderInvoicePdf({ ...base, mark: "DRAFT", number: null, timeDetail: [], prior: [] }));
    expect(all).toContain("DRAFT");
    expect(all).toContain("Page 1 of 1");
    expect(all).not.toContain("Total balance due");
  });
});

describe("fee tables", () => {
  const data: InvoicePdfData = {
    ...base,
    timeDetail: [],
    prior: [],
    adjustments: [],
    fixed: [
      ...base.fixed,
      { phase: "Interior Finishes Package", additional: true, feeCents: 1_000_000, percentCompleteBp: 2500, earnedCents: 250_000, previousCents: 0, thisCents: 250_000 },
    ],
    hourly: [{ ...base.hourly[0]!, phase: "Owner Meetings", additional: false }, { ...base.hourly[0]!, phase: "Site Survey", additional: true, role: "Project Architect" }],
    consultants: [
      ...base.consultants,
      { label: "Structural · Lowcountry SE", feeCents: 1_020_000, percentCompleteBp: 2000, earnedCents: 204_000, previousCents: 0, thisCents: 204_000 },
    ],
  };

  it("the fee and consultant totals show fee, overall % complete, earned and billed", { timeout: 30_000 }, async () => {
    const { all } = await text(await renderInvoicePdf(data));
    // Contract fee: $27,900 earned of $74,400 → 37.5%.
    expect(all).toMatch(/Total\s*\$74,400\.00\s*37\.5%\s*\$27,900\.00\s*\$16,740\.00\s*\$11,160\.00/);
    // Consultants: $11,940 earned of $30,000 → 39.8%.
    expect(all).toMatch(/Total\s*\$30,000\.00\s*39\.8%\s*\$11,940\.00\s*\$5,940\.00\s*\$6,000\.00/);
  });

  it("additional services print in their own section, after the contract fee and hourly work", { timeout: 30_000 }, async () => {
    const { all } = await text(await renderInvoicePdf(data));
    const at = (t: string) => all.indexOf(t);
    expect(at("Additional services")).toBeGreaterThan(at("Design Development"));
    expect(at("Additional services")).toBeGreaterThan(at("Owner Meetings"));
    expect(at("Interior Finishes Package")).toBeGreaterThan(at("Additional services"));
    expect(at("Site Survey")).toBeGreaterThan(at("Additional services"));
    // Its own total: $10,000 fee at 25%.
    expect(all).toMatch(/Total\s*\$10,000\.00\s*25%\s*\$2,500\.00\s*\$0\.00\s*\$2,500\.00/);
    // The contract fee total leaves the additional service out.
    expect(all).toMatch(/Total\s*\$74,400\.00/);
  });

  it("no additional services → no section", { timeout: 30_000 }, async () => {
    const { all } = await text(await renderInvoicePdf({ ...data, fixed: base.fixed, hourly: [data.hourly[0]!] }));
    expect(all).not.toContain("Additional services");
  });
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
    expect(addressLines({ addressLine1: "1 Bay Rd", addressLine2: null, city: "Mt Pleasant", state: "SC", postalCode: "29464" })).toEqual([
      "1 Bay Rd",
      "Mt Pleasant, SC 29464",
    ]);
  });
});
