// What a draft invoice's calculated lines should be (invoicing spec rules
// 2–5). Pure: the server loads the facts, calls planDraft, then saves the
// difference. Consultant lines and free adjustments are typed in by people
// and aren't planned here.

import { formatMoney } from "@/lib/format";
import {
  type FeeType,
  type InvoiceLineType,
  type NteWarning,
  type PriorLine,
  fixedFeeLine,
  formatPercentBp,
  hourlyGroups,
  hoursToHundredths,
  lastBilledBp,
  nteCap,
  previouslyBilled,
} from "./invoice";

export type PlanPhase = {
  id: string;
  name: string;
  sortOrder: number;
  feeType: FeeType;
  /** fixed: the fee; nte: the cap; hourly: an estimate. */
  feeCents: number;
  percentCompleteBp: number;
};

export type PlanEntry = {
  id: string;
  phaseId: string;
  /** Name of the role frozen on the entry at approval; null → "Staff". */
  roleName: string | null;
  billRateCents: number;
  hours: string | number;
};

/** A calculated line. `key` matches it to the saved line on the next recalculation. */
export type PlannedLine = {
  key: string;
  lineType: Extract<InvoiceLineType, "phase_fee" | "hourly" | "adjustment">;
  projectPhaseId: string;
  description: string;
  /** "1" or hours, as numeric text. */
  quantity: string;
  rateCents: number;
  amountCents: number;
  percentCompleteBp: number | null;
  phaseFeeCents: number | null;
  priorBilledCents: number | null;
  sortOrder: number;
};

export type FixedRow = {
  phaseId: string;
  name: string;
  feeCents: number;
  lastBilledBp: number;
  percentCompleteBp: number;
  earnedToDateCents: number;
  previouslyBilledCents: number;
  /** 0 when nothing is billed this time. */
  thisInvoiceCents: number;
  /** "% complete is below what's already billed (60%)." */
  error: string | null;
};

export type HourlyRow = {
  phaseId: string;
  name: string;
  feeType: "hourly" | "nte";
  /** NTE cap (fee) or hourly estimate. */
  feeCents: number;
  previouslyBilledCents: number;
  groups: { roleName: string; rateCents: number; hoursHundredths: number; amountCents: number }[];
  hourlyAmountCents: number;
  /** What the phase bills this time, after any NTE write-down. */
  netCents: number;
  writeDownCents: number;
  pctOfCapBp: number | null;
  warning: NteWarning;
};

export type DraftPlan = { lines: PlannedLine[]; fixed: FixedRow[]; hourly: HourlyRow[] };

export const NO_ROLE_NAME = "Staff";

/** "$11,160" or "$2,628.75": cents only when they aren't zero. */
export const money = (cents: number) => formatMoney(cents, { cents: cents % 100 !== 0 });

/** 1050 hundredths → "10.5", 400 → "4", 1275 → "12.75". */
export const hoursText = (hundredths: number) => String(hundredths / 100);

/** 1275 → "12.75" (numeric(10,2) text for the quantity column). */
const quantityText = (hundredths: number) => (hundredths / 100).toFixed(2);

/**
 * Plan the calculated lines for a draft. `priorLines` are lines on the
 * project's other invoices (any status; only counted ones count). `entries`
 * are the approved time entries reserved on this draft.
 */
export function planDraft(input: {
  invoiceId: string;
  phases: readonly PlanPhase[];
  priorLines: readonly PriorLine[];
  entries: readonly PlanEntry[];
}): DraftPlan {
  const { invoiceId, priorLines } = input;
  const phases = [...input.phases].sort((a, b) => a.sortOrder - b.sortOrder);
  const lines: PlannedLine[] = [];
  const fixed: FixedRow[] = [];
  const hourly: HourlyRow[] = [];

  phases.forEach((p, i) => {
    const base = (i + 1) * 100;
    const prev = previouslyBilled(priorLines, p.id, p.feeType, invoiceId);

    if (p.feeType === "fixed") {
      const last = lastBilledBp(priorLines, p.id, invoiceId);
      const r = fixedFeeLine({
        feeCents: p.feeCents,
        percentCompleteBp: p.percentCompleteBp,
        previouslyBilledCents: prev,
        lastBilledBp: last,
      });
      fixed.push({
        phaseId: p.id,
        name: p.name,
        feeCents: p.feeCents,
        lastBilledBp: last,
        percentCompleteBp: p.percentCompleteBp,
        earnedToDateCents: r.ok ? r.earnedToDateCents : prev,
        previouslyBilledCents: prev,
        thisInvoiceCents: r.ok ? r.amountCents : 0,
        error: r.ok ? null : r.error,
      });
      if (r.ok && !r.omit)
        lines.push({
          key: `fee:${p.id}`,
          lineType: "phase_fee",
          projectPhaseId: p.id,
          description: `${p.name} · ${formatPercentBp(p.percentCompleteBp)} complete`,
          quantity: "1.00",
          rateCents: r.amountCents,
          amountCents: r.amountCents,
          percentCompleteBp: p.percentCompleteBp,
          phaseFeeCents: p.feeCents,
          priorBilledCents: prev,
          sortOrder: base,
        });
      return;
    }

    const groups = hourlyGroups(
      input.entries
        .filter((e) => e.phaseId === p.id)
        .map((e) => ({ roleName: e.roleName ?? NO_ROLE_NAME, billRateCents: e.billRateCents, hours: e.hours })),
    );
    const hourlyAmountCents = groups.reduce((n, g) => n + g.amountCents, 0);
    groups.forEach((g, j) =>
      lines.push({
        key: `hourly:${p.id}:${g.roleName}:${g.rateCents}`,
        lineType: "hourly",
        projectPhaseId: p.id,
        description: `${p.name} · ${g.roleName} · ${hoursText(g.hoursHundredths)} h @ ${money(g.rateCents)}`,
        quantity: quantityText(g.hoursHundredths),
        rateCents: g.rateCents,
        amountCents: g.amountCents,
        percentCompleteBp: null,
        phaseFeeCents: null,
        priorBilledCents: null,
        sortOrder: base + j + 1,
      }),
    );

    const cap =
      p.feeType === "nte"
        ? nteCap({ capCents: p.feeCents, previouslyBilledCents: prev, hourlyAmountCents })
        : { netCents: hourlyAmountCents, writeDownCents: 0, pctOfCapBp: null, warning: "none" as const };
    if (cap.writeDownCents > 0)
      lines.push({
        key: `nte:${p.id}`,
        lineType: "adjustment",
        projectPhaseId: p.id,
        description: `${p.name} · not-to-exceed limit reached, ${money(cap.writeDownCents)} written down`,
        quantity: "1.00",
        rateCents: -cap.writeDownCents,
        amountCents: -cap.writeDownCents,
        percentCompleteBp: null,
        phaseFeeCents: null,
        priorBilledCents: null,
        sortOrder: base + 99,
      });
    hourly.push({
      phaseId: p.id,
      name: p.name,
      feeType: p.feeType,
      feeCents: p.feeCents,
      previouslyBilledCents: prev,
      groups,
      hourlyAmountCents,
      netCents: cap.netCents,
      writeDownCents: cap.writeDownCents,
      pctOfCapBp: cap.pctOfCapBp,
      warning: cap.warning,
    });
  });

  return { lines, fixed, hourly };
}

/** Sort orders for typed-in lines: after every planned line (sort_order is a smallint, max 32,767). */
export const CONSULTANT_SORT_BASE = 20_000;
export const ADJUSTMENT_SORT_BASE = 25_000;

/** Σ hours as hundredths, for the unapproved-time warning. */
export const sumHundredths = (hours: readonly (string | number)[]) =>
  hours.reduce<number>((n, h) => n + hoursToHundredths(h), 0);
