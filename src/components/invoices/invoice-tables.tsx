import { cn } from "@/lib/cn";
import {
  Table,
  TableBody,
  TableCell,
  TableFoot,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPercentBp } from "@/lib/calc/invoice";
import { money } from "@/lib/calc/invoice-plan";
import type {
  FeeRow,
  FeeTotals,
  Group,
  HourlyRow,
  InvoiceSections,
  NteRow,
  NteTotals,
  RoleLine,
} from "@/lib/calc/invoice-sections";

// The invoice's tables on screen, laid out like the PDF (rule 17): Fee,
// Not-to-exceed and Hourly for the base contract, the same for additional
// services, Consultants, then Subtotal / adjustments / Total. Read-only;
// the builder has its own editable versions of the first three.

/** "$1,860.00" / "−$1,860.00". */
export const signed = (cents: number) =>
  cents < 0 ? `−${money(-cents)}` : money(cents);

export const hoursAt = (l: RoleLine) =>
  l.hoursHundredths === null || l.rateCents === null
    ? l.role
    : `${l.role} · ${(l.hoursHundredths / 100).toFixed(2)} h @ ${money(l.rateCents)}`;

export function InvoiceSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const id = `sec-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <section
      aria-labelledby={id}
      className="rounded-sm border border-line bg-surface"
    >
      <h2 id={id} className="m-0 px-[18px] pt-4 pb-3 text-sm font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function FeeTable({
  label,
  first,
  rows,
  total,
}: {
  label: string;
  first: string;
  rows: FeeRow[];
  total: FeeTotals;
}) {
  return (
    <Table aria-label={label}>
      <TableHead>
        <TableRow>
          <TableHeader>{first}</TableHeader>
          <TableHeader numeric>Fee</TableHeader>
          <TableHeader numeric>% complete</TableHeader>
          <TableHeader numeric>Earned to date</TableHeader>
          <TableHeader numeric>Previously billed</TableHeader>
          <TableHeader numeric>This invoice</TableHeader>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.name}>
            <TableCell>{r.name}</TableCell>
            <TableCell numeric>{money(r.feeCents)}</TableCell>
            <TableCell numeric>
              {formatPercentBp(r.percentCompleteBp)}
            </TableCell>
            <TableCell numeric>{money(r.earnedCents)}</TableCell>
            <TableCell numeric>{money(r.previousCents)}</TableCell>
            <TableCell numeric className="font-semibold">
              {money(r.thisCents)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFoot>
        <TableRow data-total>
          <TableCell>Total</TableCell>
          <TableCell numeric>{money(total.feeCents)}</TableCell>
          <TableCell numeric>
            {formatPercentBp(total.percentCompleteBp)}
          </TableCell>
          <TableCell numeric>{money(total.earnedCents)}</TableCell>
          <TableCell numeric>{money(total.previousCents)}</TableCell>
          <TableCell numeric className="font-semibold">
            {money(total.thisCents)}
          </TableCell>
        </TableRow>
      </TableFoot>
    </Table>
  );
}

export function NteTable({
  label,
  rows,
  total,
}: {
  label: string;
  rows: NteRow[];
  total: NteTotals;
}) {
  return (
    <Table aria-label={label}>
      <TableHead>
        <TableRow>
          <TableHeader>Phase</TableHeader>
          <TableHeader numeric>Limit</TableHeader>
          <TableHeader numeric>Previously billed</TableHeader>
          <TableHeader numeric>This invoice</TableHeader>
          <TableHeader numeric>Billed to date</TableHeader>
          <TableHeader numeric>Remaining</TableHeader>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.flatMap((r) => [
          <TableRow key={r.name} data-phase={r.name}>
            <TableCell className="font-medium">{r.name}</TableCell>
            <TableCell numeric>{money(r.limitCents)}</TableCell>
            <TableCell numeric>{money(r.previousCents)}</TableCell>
            <TableCell numeric className="font-semibold">
              {money(r.thisCents)}
            </TableCell>
            <TableCell numeric>{money(r.billedToDateCents)}</TableCell>
            <TableCell numeric>{money(r.remainingCents)}</TableCell>
          </TableRow>,
          ...r.lines.map((l, i) => (
            <TableRow key={`${r.name}-${i}`} className="text-xs text-muted">
              <TableCell colSpan={3} className="pl-7">
                {hoursAt(l)}
              </TableCell>
              <TableCell
                numeric
                className={l.amountCents < 0 ? "text-red" : undefined}
              >
                {signed(l.amountCents)}
              </TableCell>
              <TableCell colSpan={2} />
            </TableRow>
          )),
        ])}
      </TableBody>
      <TableFoot>
        <TableRow data-total>
          <TableCell>Total</TableCell>
          <TableCell numeric>{money(total.limitCents)}</TableCell>
          <TableCell numeric>{money(total.previousCents)}</TableCell>
          <TableCell numeric className="font-semibold">
            {money(total.thisCents)}
          </TableCell>
          <TableCell numeric>{money(total.billedToDateCents)}</TableCell>
          <TableCell numeric>{money(total.remainingCents)}</TableCell>
        </TableRow>
      </TableFoot>
    </Table>
  );
}

export function HourlyTable({
  label,
  rows,
  totalCents,
}: {
  label: string;
  rows: HourlyRow[];
  totalCents: number;
}) {
  return (
    <Table aria-label={label}>
      <TableHead>
        <TableRow>
          <TableHeader>Phase</TableHeader>
          <TableHeader>Role</TableHeader>
          <TableHeader numeric>Hours</TableHeader>
          <TableHeader numeric>Rate</TableHeader>
          <TableHeader numeric>Amount</TableHeader>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={i}>
            <TableCell>{r.phase}</TableCell>
            <TableCell>{r.role}</TableCell>
            <TableCell numeric>
              {r.hoursHundredths === null
                ? ""
                : `${(r.hoursHundredths / 100).toFixed(2)} h`}
            </TableCell>
            <TableCell numeric>
              {r.rateCents === null ? "" : money(r.rateCents)}
            </TableCell>
            <TableCell numeric>{signed(r.amountCents)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFoot>
        <TableRow data-total>
          <TableCell colSpan={4}>Total</TableCell>
          <TableCell numeric className="font-semibold">
            {money(totalCents)}
          </TableCell>
        </TableRow>
      </TableFoot>
    </Table>
  );
}

/** One group's Fee / Not-to-exceed / Hourly sections. */
function GroupSections({
  g,
  titles,
}: {
  g: Group;
  titles: [string, string, string];
}) {
  return (
    <>
      {g.fixed.length > 0 && (
        <InvoiceSection title={titles[0]}>
          <FeeTable
            label={titles[0]}
            first="Phase"
            rows={g.fixed}
            total={g.fixedTotal}
          />
        </InvoiceSection>
      )}
      {g.nte.length > 0 && (
        <InvoiceSection title={titles[1]}>
          <NteTable label={titles[1]} rows={g.nte} total={g.nteTotal} />
        </InvoiceSection>
      )}
      {g.hourly.length > 0 && (
        <InvoiceSection title={titles[2]}>
          <HourlyTable
            label={titles[2]}
            rows={g.hourly}
            totalCents={g.hourlyTotalCents}
          />
        </InvoiceSection>
      )}
    </>
  );
}

export const CONTRACT_TITLES: [string, string, string] = [
  "Fee",
  "Not-to-exceed",
  "Hourly services",
];
export const ADDITIONAL_TITLES: [string, string, string] = [
  "Additional services",
  "Additional services · not-to-exceed",
  "Additional services · hourly",
];

/** Every table of an invoice, read-only. */
export function InvoiceTables({ x }: { x: InvoiceSections }) {
  return (
    <>
      <GroupSections g={x.contract} titles={CONTRACT_TITLES} />
      <GroupSections g={x.additional} titles={ADDITIONAL_TITLES} />
      {x.consultants.length > 0 && (
        <InvoiceSection title="Consultants">
          <FeeTable
            label="Consultants"
            first="Consultant"
            rows={x.consultants}
            total={x.consultantsTotal}
          />
        </InvoiceSection>
      )}
    </>
  );
}

const row = "flex justify-between gap-4 py-1.5";

/** Subtotal (only with adjustments), each adjustment, tax, then the total. */
export function TotalLines({
  servicesSubtotalCents,
  adjustments,
  taxCents,
  totalCents,
  totalLabel = "Total",
}: {
  servicesSubtotalCents: number;
  adjustments: { description: string; amountCents: number }[];
  taxCents: number;
  totalCents: number;
  totalLabel?: string;
}) {
  return (
    <>
      {adjustments.length > 0 && (
        <>
          <div className={row}>
            <span className="text-muted">Subtotal</span>
            <span className="num" data-testid="invoice-subtotal">
              {money(servicesSubtotalCents)}
            </span>
          </div>
          {adjustments.map((a, i) => (
            <div key={i} className={row} data-adjustment>
              <span>{a.description}</span>
              <span className={a.amountCents < 0 ? "num text-red" : "num"}>
                {signed(a.amountCents)}
              </span>
            </div>
          ))}
        </>
      )}
      {taxCents > 0 && (
        <div className={row}>
          <span className="text-muted">Tax</span>
          <span className="num">{money(taxCents)}</span>
        </div>
      )}
      <div
        className={cn(
          row,
          "text-base font-semibold",
          // A rule above the total only when there are lines above it.
          (adjustments.length > 0 || taxCents > 0) &&
            "border-t border-line pt-2.5",
        )}
      >
        <span>{totalLabel}</span>
        <span className="num" data-testid="invoice-total">
          {money(totalCents)}
        </span>
      </div>
    </>
  );
}
