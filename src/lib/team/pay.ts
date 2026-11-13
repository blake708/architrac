import { z } from "zod";
import type { PayType } from "@/lib/calc/pay";
import { formatDate } from "@/lib/format";

// Team → person drawer → Pay (ADR 0008). Owner/admin only. Shared by the
// form and the server. Amounts travel as cents, burden as basis points.

export const PAY_TYPES = ["salary", "hourly"] as const satisfies readonly PayType[];

export const PAY_LABELS: Record<PayType, string> = {
  salary: "Salary",
  hourly: "Hourly",
};

/** $9,999,999.99 a year; $9,999.99 an hour. */
export const SALARY_MAX_CENTS = 999_999_999;
export const WAGE_MAX_CENTS = 999_999;
/** Burden up to 200%. */
export const BURDEN_MAX_BP = 20000;

export const PAY_MESSAGES = {
  salary: "Enter an annual salary from $0 to $9,999,999",
  wage: "Enter an hourly wage from $0 to $9,999",
  burden: "Enter a percent from 0 to 200",
  date: "Pick a date",
  noHours: "Set their weekly hours to work out an hourly cost from salary",
  forbidden: "Only owners and admins can see or change pay.",
  notFound: "That person isn't in this firm.",
} as const;

export function payEarliestMessage(earliest: string) {
  return `Pick ${formatDate(earliest)} or later — their current pay starts then.`;
}

/** "22.5" → 2250 bp; null if it isn't a percent with up to 2 decimals. */
export function percentToBp(raw: string): number | null {
  const v = raw.replace(/[%\s]/g, "");
  if (v === "") return 0;
  if (!/^\d+(\.\d{0,2})?$/.test(v)) return null;
  const [w, f = ""] = v.split(".");
  return Number(w) * 100 + Number(f.padEnd(2, "0"));
}

/** 2250 bp → "22.5". */
export function bpToPercent(bp: number): string {
  return String(bp / 100);
}

/** One period of a person's pay, newest first in the drawer. */
export type PayHistoryRow = {
  payType: PayType;
  amountCents: number;
  burdenBp: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  /** Worked out with today's weekly hours. Null = can't (salary, 0 hours). */
  hourlyCostCents: number | null;
};

export const savePaySchema = z
  .object({
    membershipId: z.uuid(),
    payType: z.enum(PAY_TYPES),
    amountCents: z.number().int({ error: PAY_MESSAGES.salary }).min(0, { error: PAY_MESSAGES.salary }),
    burdenBp: z
      .number({ error: PAY_MESSAGES.burden })
      .int({ error: PAY_MESSAGES.burden })
      .min(0, { error: PAY_MESSAGES.burden })
      .max(BURDEN_MAX_BP, { error: PAY_MESSAGES.burden }),
    effectiveFrom: z.iso.date({ error: PAY_MESSAGES.date }),
  })
  .superRefine((v, ctx) => {
    const max = v.payType === "salary" ? SALARY_MAX_CENTS : WAGE_MAX_CENTS;
    if (v.amountCents > max)
      ctx.addIssue({
        code: "custom",
        path: ["amountCents"],
        message: v.payType === "salary" ? PAY_MESSAGES.salary : PAY_MESSAGES.wage,
      });
  });
export type SavePayInput = z.input<typeof savePaySchema>;
