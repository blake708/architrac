import {
  type FeeType,
  type InvoiceLineType,
  type PriorLine,
  consultantAmount,
  consultantLastBilledBp,
  consultantPreviouslyBilled,
  hoursToHundredths,
  lastBilledBp,
  nteStanding,
  overallPercentBp,
  previouslyBilled,
} from "./invoice";

// An invoice laid out the way the client sees it (invoicing spec rule 17):
// Fee, Not-to-exceed and Hourly tables for the base contract, the same three
// for additional services, then Consultants, then the totals with
// adjustments. Built from the invoice's saved lines, so a sent invoice shows
// what was billed then; the PDF and the invoice page both use it.

export type SectionLine = {
  lineType: InvoiceLineType;
  projectPhaseId: string | null;
  consultantId: string | null;
  description: string;
  /** Hours on hourly lines. */
  quantity: string;
  rateCents: number;
  amountCents: number;
  percentCompleteBp: number | null;
  /** Fixed-fee and consultant lines: the fee when built. */
  phaseFeeCents: number | null;
  /** Fixed-fee and consultant lines: previously billed when built. */
  priorBilledCents: number | null;
};

export type SectionPhase = {
  id: string;
  name: string;
  feeType: FeeType;
  /** fixed: the fee; nte: the limit. */
  feeCents: number;
  additional: boolean;
  /** Archived phases only print when this invoice has a line on them. */
  archived: boolean;
};

export type SectionConsultant = {
  id: string;
  label: string;
  feeCents: number;
  markupBp: number;
  archived: boolean;
};

export type FeeRow = {
  name: string;
  feeCents: number;
  percentCompleteBp: number;
  earnedCents: number;
  previousCents: number;
  thisCents: number;
};

export type RoleLine = {
  role: string;
  hoursHundredths: number | null;
  rateCents: number | null;
  amountCents: number;
};

export type NteRow = {
  name: string;
  limitCents: number;
  previousCents: number;
  thisCents: number;
  billedToDateCents: number;
  remainingCents: number;
  lines: RoleLine[];
};

export type HourlyRow = RoleLine & { phase: string };

export type FeeTotals = Omit<FeeRow, "name">;
export type NteTotals = Omit<NteRow, "name" | "lines">;

export type Group = {
  fixed: FeeRow[];
  fixedTotal: FeeTotals;
  nte: NteRow[];
  nteTotal: NteTotals;
  hourly: HourlyRow[];
  hourlyTotalCents: number;
  /** Nothing in any of the three tables. */
  empty: boolean;
};

export type InvoiceSections = {
  contract: Group;
  additional: Group;
  consultants: FeeRow[];
  consultantsTotal: FeeTotals;
  adjustments: { description: string; amountCents: number }[];
  /** Before adjustments: shown only when there are adjustments. */
  servicesSubtotalCents: number;
};

export const NTE_WRITE_DOWN = "Not-to-exceed limit reached";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * The prior lines a sent invoice was built against: lines on invoices sent
 * before it. A draft (not sent) counts every other invoice.
 */
export function linesAsOf<T extends PriorLine & { sentAt?: Date | null }>(
  lines: readonly T[],
  invoiceId: string,
  sentAt: Date | null,
): T[] {
  if (!sentAt) return [...lines];
  return lines.filter(
    (l) =>
      l.invoiceId === invoiceId ||
      (l.sentAt != null && l.sentAt.getTime() < sentAt.getTime()),
  );
}

/** "Permitting · Principal · 3 h @ $145" → "Principal" (the description rule 4 writes). */
export function roleFromDescription(
  description: string,
  phaseName: string,
): string {
  const parts = description.split(" · ");
  if (parts.length < 3) return description;
  const rest = description.startsWith(`${phaseName} · `)
    ? description.slice(phaseName.length + 3).split(" · ")
    : parts.slice(1);
  return rest.slice(0, -1).join(" · ") || description;
}

export function feeTotals(rows: readonly FeeRow[]): FeeTotals {
  return {
    feeCents: sum(rows.map((r) => r.feeCents)),
    percentCompleteBp: overallPercentBp(rows),
    earnedCents: sum(rows.map((r) => r.earnedCents)),
    previousCents: sum(rows.map((r) => r.previousCents)),
    thisCents: sum(rows.map((r) => r.thisCents)),
  };
}

export function nteTotals(rows: readonly NteRow[]): NteTotals {
  return {
    limitCents: sum(rows.map((r) => r.limitCents)),
    previousCents: sum(rows.map((r) => r.previousCents)),
    thisCents: sum(rows.map((r) => r.thisCents)),
    billedToDateCents: sum(rows.map((r) => r.billedToDateCents)),
    remainingCents: sum(rows.map((r) => r.remainingCents)),
  };
}

export function group(
  fixed: FeeRow[],
  nte: NteRow[],
  hourly: HourlyRow[],
): Group {
  return {
    fixed,
    fixedTotal: feeTotals(fixed),
    nte,
    nteTotal: nteTotals(nte),
    hourly,
    hourlyTotalCents: sum(hourly.map((r) => r.amountCents)),
    empty: !fixed.length && !nte.length && !hourly.length,
  };
}

/** Subtotal before adjustments: what the services come to. */
export function servicesSubtotal(
  subtotalCents: number,
  adjustments: readonly { amountCents: number }[],
): number {
  return subtotalCents - sum(adjustments.map((a) => a.amountCents));
}

/**
 * Lay out an invoice from its saved lines (in sort order). `priorLines` are
 * the project's lines as of this invoice (see linesAsOf). Every live
 * fixed-fee and NTE phase and billed consultant gets a row, even with
 * nothing this time, so the client sees where each stands.
 */
export function invoiceSections(input: {
  invoiceId: string;
  lines: readonly SectionLine[];
  phases: readonly SectionPhase[];
  consultants: readonly SectionConsultant[];
  priorLines: readonly PriorLine[];
  subtotalCents: number;
}): InvoiceSections {
  const { invoiceId, lines, priorLines } = input;
  const byPhase = (id: string) => lines.filter((l) => l.projectPhaseId === id);

  const fixed: { additional: boolean; row: FeeRow }[] = [];
  const nte: { additional: boolean; row: NteRow }[] = [];
  const hourly: { additional: boolean; row: HourlyRow }[] = [];

  for (const p of input.phases) {
    const own = byPhase(p.id);
    if (p.archived && !own.length) continue;

    if (p.feeType === "fixed") {
      const line = own.find((l) => l.lineType === "phase_fee");
      if (line) {
        const previousCents = line.priorBilledCents ?? 0;
        fixed.push({
          additional: p.additional,
          row: {
            name: p.name,
            feeCents: line.phaseFeeCents ?? p.feeCents,
            percentCompleteBp: line.percentCompleteBp ?? 0,
            earnedCents: previousCents + line.amountCents,
            previousCents,
            thisCents: line.amountCents,
          },
        });
      } else {
        const previousCents = previouslyBilled(
          priorLines,
          p.id,
          "fixed",
          invoiceId,
        );
        fixed.push({
          additional: p.additional,
          row: {
            name: p.name,
            feeCents: p.feeCents,
            percentCompleteBp: lastBilledBp(priorLines, p.id, invoiceId),
            earnedCents: previousCents,
            previousCents,
            thisCents: 0,
          },
        });
      }
      continue;
    }

    const roleLines: RoleLine[] = own
      .filter((l) => l.lineType === "hourly" || l.lineType === "adjustment")
      .map((l) =>
        l.lineType === "hourly"
          ? {
              role: roleFromDescription(l.description, p.name),
              hoursHundredths: hoursToHundredths(l.quantity),
              rateCents: l.rateCents,
              amountCents: l.amountCents,
            }
          : {
              role: NTE_WRITE_DOWN,
              hoursHundredths: null,
              rateCents: null,
              amountCents: l.amountCents,
            },
      );

    if (p.feeType === "nte") {
      const previousCents = previouslyBilled(
        priorLines,
        p.id,
        "nte",
        invoiceId,
      );
      const thisCents = sum(roleLines.map((l) => l.amountCents));
      nte.push({
        additional: p.additional,
        row: {
          name: p.name,
          limitCents: p.feeCents,
          previousCents,
          thisCents,
          ...nteStanding({
            capCents: p.feeCents,
            previouslyBilledCents: previousCents,
            thisInvoiceCents: thisCents,
          }),
          lines: roleLines,
        },
      });
    } else
      for (const r of roleLines)
        hourly.push({ additional: p.additional, row: { phase: p.name, ...r } });
  }

  const consultants: FeeRow[] = [];
  for (const c of input.consultants) {
    const line = lines.find(
      (l) => l.lineType === "consultant" && l.consultantId === c.id,
    );
    if (line) {
      const previousCents = line.priorBilledCents ?? 0;
      consultants.push({
        name: c.label,
        feeCents:
          line.phaseFeeCents ?? consultantAmount(c.feeCents, c.markupBp),
        percentCompleteBp: line.percentCompleteBp ?? 0,
        earnedCents: previousCents + line.amountCents,
        previousCents,
        thisCents: line.amountCents,
      });
    } else if (!c.archived) {
      const previousCents = consultantPreviouslyBilled(
        priorLines,
        c.id,
        invoiceId,
      );
      consultants.push({
        name: c.label,
        feeCents: consultantAmount(c.feeCents, c.markupBp),
        percentCompleteBp: consultantLastBilledBp(priorLines, c.id, invoiceId),
        earnedCents: previousCents,
        previousCents,
        thisCents: 0,
      });
    }
  }

  const adjustments = lines
    .filter((l) => l.lineType === "adjustment" && l.projectPhaseId === null)
    .map((l) => ({ description: l.description, amountCents: l.amountCents }));

  const pick = <T>(
    xs: { additional: boolean; row: T }[],
    additional: boolean,
  ) => xs.filter((x) => x.additional === additional).map((x) => x.row);

  return {
    contract: group(pick(fixed, false), pick(nte, false), pick(hourly, false)),
    additional: group(pick(fixed, true), pick(nte, true), pick(hourly, true)),
    consultants,
    consultantsTotal: feeTotals(consultants),
    adjustments,
    servicesSubtotalCents: servicesSubtotal(input.subtotalCents, adjustments),
  };
}
