import path from "node:path";
import { Document, Font, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatPercentBp, overallPercentBp } from "@/lib/calc/invoice";
import { formatDate, formatMoney } from "@/lib/format";
import type { InvoicePdfData } from "./pdf-data";

// The invoice PDF (invoicing spec rule 17): US Letter, money in IBM Plex
// Mono and always with cents. Lays out what pdf-data.ts read; no math here.

const FONTS = path.join(process.cwd(), "src", "server", "invoices", "fonts");
let registered = false;
function registerFonts() {
  if (registered) return;
  Font.register({
    family: "Barlow",
    fonts: [
      { src: path.join(FONTS, "Barlow-Regular.ttf") },
      { src: path.join(FONTS, "Barlow-SemiBold.ttf"), fontWeight: 600 },
      { src: path.join(FONTS, "Barlow-Bold.ttf"), fontWeight: 700 },
    ],
  });
  Font.register({
    family: "Plex Mono",
    fonts: [
      { src: path.join(FONTS, "IBMPlexMono-Regular.ttf") },
      { src: path.join(FONTS, "IBMPlexMono-Medium.ttf"), fontWeight: 500 },
    ],
  });
  // Long words wrap where they must instead of being hyphenated.
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}

/** "$11,160.00" / "−$215.00": always with cents (rule 17). */
export const pdfMoney = (cents: number) =>
  cents < 0 ? `−${formatMoney(-cents, { cents: true })}` : formatMoney(cents, { cents: true });

const INK = "#1F1F1F";
const MUTED = "#6B6B6B";
const LINE = "#D9D9D9";

const s = StyleSheet.create({
  page: { fontFamily: "Barlow", fontSize: 9, color: INK, paddingTop: 40, paddingBottom: 64, paddingHorizontal: 44 },
  row: { flexDirection: "row" },
  between: { flexDirection: "row", justifyContent: "space-between" },
  firmName: { fontSize: 13, fontWeight: 700 },
  muted: { color: MUTED },
  title: { fontSize: 22, fontWeight: 700, letterSpacing: 2, marginTop: 22 },
  label: { fontSize: 7.5, fontWeight: 600, color: MUTED, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 3 },
  block: { flex: 1, paddingRight: 16 },
  section: { marginTop: 18 },
  sectionTitle: { fontSize: 10, fontWeight: 700, marginBottom: 4 },
  th: { fontSize: 7.5, fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: 0.5 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LINE, paddingVertical: 4 },
  head: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: INK, paddingBottom: 3 },
  total: { flexDirection: "row", paddingVertical: 4, fontWeight: 700 },
  num: { fontFamily: "Plex Mono", textAlign: "right" },
  totals: { marginTop: 16, marginLeft: "auto", width: 250 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  due: { borderTopWidth: 1, borderTopColor: INK, marginTop: 3, paddingTop: 5, fontWeight: 700, fontSize: 11 },
  footer: { position: "absolute", left: 44, right: 44, bottom: 26, fontSize: 7.5, color: MUTED, flexDirection: "row", justifyContent: "space-between" },
  mark: {
    position: "absolute",
    top: 330,
    left: 70,
    fontSize: 120,
    fontWeight: 700,
    color: "#E2E2E2",
    transform: "rotate(-35deg)",
    letterSpacing: 10,
  },
});

type Col<T> = { title: string; width: number | string; num?: boolean; cell: (r: T) => string };

function Table<T>({ cols, rows, totals }: { cols: Col<T>[]; rows: T[]; totals?: (string | null)[] }) {
  const style = (c: Col<T>, i: number) => ({
    width: c.width,
    paddingLeft: i === 0 ? 0 : 6,
    ...(typeof c.width === "number" ? {} : { flexGrow: 1 }),
  });
  return (
    <View>
      <View style={s.head}>
        {cols.map((c, i) => (
          <Text key={c.title} style={[s.th, style(c, i), c.num ? { textAlign: "right" } : {}]}>
            {c.title}
          </Text>
        ))}
      </View>
      {rows.map((r, i) => (
        <View key={i} style={s.tr} wrap={false}>
          {cols.map((c, ci) => (
            <Text key={c.title} style={[style(c, ci), c.num ? s.num : {}]}>
              {c.cell(r)}
            </Text>
          ))}
        </View>
      ))}
      {totals && (
        <View style={s.total} wrap={false}>
          {cols.map((c, ci) => (
            <Text key={c.title} style={[style(c, ci), c.num ? s.num : {}]}>
              {totals[ci] ?? ""}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Fixed-fee phases, with an overall % complete (weighted by fee) in the total row. */
function FeeTable({ rows }: { rows: InvoicePdfData["fixed"] }) {
  return (
    <Table
      cols={[
        { title: "Phase", width: "auto", cell: (r) => r.phase },
        { title: "Fee", width: 82, num: true, cell: (r) => pdfMoney(r.feeCents) },
        { title: "% complete", width: 56, num: true, cell: (r) => formatPercentBp(r.percentCompleteBp) },
        { title: "Earned to date", width: 82, num: true, cell: (r) => pdfMoney(r.earnedCents) },
        { title: "Previously billed", width: 82, num: true, cell: (r) => pdfMoney(r.previousCents) },
        { title: "This invoice", width: 82, num: true, cell: (r) => pdfMoney(r.thisCents) },
      ]}
      rows={rows}
      totals={[
        "Total",
        pdfMoney(sum(rows.map((r) => r.feeCents))),
        formatPercentBp(overallPercentBp(rows)),
        pdfMoney(sum(rows.map((r) => r.earnedCents))),
        pdfMoney(sum(rows.map((r) => r.previousCents))),
        pdfMoney(sum(rows.map((r) => r.thisCents))),
      ]}
    />
  );
}

function HourlyTable({ rows }: { rows: InvoicePdfData["hourly"] }) {
  return (
    <Table
      cols={[
        { title: "Phase", width: 150, cell: (r) => r.phase },
        { title: "Role", width: "auto", cell: (r) => r.role },
        { title: "Hours", width: 50, num: true, cell: (r) => (r.hoursHundredths === null ? "" : (r.hoursHundredths / 100).toFixed(2)) },
        { title: "Rate", width: 70, num: true, cell: (r) => (r.rateCents === null ? "" : pdfMoney(r.rateCents)) },
        { title: "Amount", width: 82, num: true, cell: (r) => pdfMoney(r.amountCents) },
      ]}
      rows={rows}
      totals={["Total", null, null, null, pdfMoney(sum(rows.map((r) => r.amountCents)))]}
    />
  );
}

function InvoiceDocument({ d }: { d: InvoicePdfData }) {
  const number = d.number ?? "Draft";
  // Additional services print apart from the base contract.
  const contractFixed = d.fixed.filter((r) => !r.additional);
  const extraFixed = d.fixed.filter((r) => r.additional);
  const contractHourly = d.hourly.filter((r) => !r.additional);
  const extraHourly = d.hourly.filter((r) => r.additional);
  return (
    <Document title={`Invoice ${number}`} author={d.firm.name} creator="ArchiTrac" producer="ArchiTrac">
      <Page size="LETTER" style={s.page}>
        {d.mark && (
          <Text style={s.mark} fixed>
            {d.mark}
          </Text>
        )}

        {/* Header: logo or firm name left; firm details right. */}
        <View style={s.between}>
          <View style={{ width: 220 }}>
            {d.firm.logoUrl ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- a PDF image, not an <img>
              <Image src={d.firm.logoUrl} style={{ maxHeight: 54, maxWidth: 200, objectFit: "contain" }} />
            ) : (
              <Text style={s.firmName}>{d.firm.name}</Text>
            )}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            {d.firm.logoUrl && <Text style={{ fontWeight: 700 }}>{d.firm.name}</Text>}
            {d.firm.address.map((l) => (
              <Text key={l} style={s.muted}>
                {l}
              </Text>
            ))}
            {d.firm.phone && <Text style={s.muted}>{d.firm.phone}</Text>}
            {d.firm.email && <Text style={s.muted}>{d.firm.email}</Text>}
          </View>
        </View>

        <View style={s.between}>
          <Text style={s.title}>INVOICE</Text>
          <View style={{ marginTop: 22, alignItems: "flex-end" }}>
            <Text>
              <Text style={s.muted}>Invoice </Text>
              <Text style={{ fontFamily: "Plex Mono", fontWeight: 500 }}>{number}</Text>
            </Text>
            <Text>
              <Text style={s.muted}>Issued </Text>
              {formatDate(d.issueDate)}
            </Text>
            <Text>
              <Text style={s.muted}>Due </Text>
              {formatDate(d.dueDate)}
              <Text style={s.muted}> · Net {d.termsDays}</Text>
            </Text>
          </View>
        </View>

        <View style={[s.row, { marginTop: 18 }]}>
          <View style={s.block}>
            <Text style={s.label}>Bill to</Text>
            <Text style={{ fontWeight: 600 }}>{d.billTo.company}</Text>
            {d.billTo.contact && <Text>{d.billTo.contact}</Text>}
            {d.billTo.address.map((l) => (
              <Text key={l}>{l}</Text>
            ))}
          </View>
          <View style={s.block}>
            <Text style={s.label}>Project</Text>
            <Text style={{ fontWeight: 600 }}>
              <Text style={{ fontFamily: "Plex Mono" }}>{d.project.number}</Text> {d.project.name}
            </Text>
            {d.project.address.map((l) => (
              <Text key={l}>{l}</Text>
            ))}
            <Text style={s.muted}>Services through {formatDate(d.periodEnd)}</Text>
          </View>
        </View>

        {d.memo && (
          <View style={s.section}>
            <Text>{d.memo}</Text>
          </View>
        )}

        {contractFixed.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Fee</Text>
            <FeeTable rows={contractFixed} />
          </View>
        )}

        {contractHourly.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Hourly services</Text>
            <HourlyTable rows={contractHourly} />
          </View>
        )}

        {(extraFixed.length > 0 || extraHourly.length > 0) && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Additional services</Text>
            {extraFixed.length > 0 && <FeeTable rows={extraFixed} />}
            {extraHourly.length > 0 && (
              <View style={extraFixed.length > 0 ? { marginTop: 10 } : {}}>
                <HourlyTable rows={extraHourly} />
              </View>
            )}
          </View>
        )}

        {d.consultants.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Consultants</Text>
            <Table
              cols={[
                { title: "Consultant", width: "auto", cell: (r) => r.label },
                { title: "Fee", width: 82, num: true, cell: (r) => pdfMoney(r.feeCents) },
                { title: "% complete", width: 56, num: true, cell: (r) => formatPercentBp(r.percentCompleteBp) },
                { title: "Earned to date", width: 82, num: true, cell: (r) => pdfMoney(r.earnedCents) },
                { title: "Previously billed", width: 82, num: true, cell: (r) => pdfMoney(r.previousCents) },
                { title: "This invoice", width: 82, num: true, cell: (r) => pdfMoney(r.thisCents) },
              ]}
              rows={d.consultants}
              totals={[
                "Total",
                pdfMoney(sum(d.consultants.map((r) => r.feeCents))),
                formatPercentBp(overallPercentBp(d.consultants)),
                pdfMoney(sum(d.consultants.map((r) => r.earnedCents))),
                pdfMoney(sum(d.consultants.map((r) => r.previousCents))),
                pdfMoney(sum(d.consultants.map((r) => r.thisCents))),
              ]}
            />
          </View>
        )}

        {d.adjustments.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Adjustments</Text>
            <Table
              cols={[
                { title: "Description", width: "auto", cell: (r) => r.description },
                { title: "Amount", width: 82, num: true, cell: (r) => pdfMoney(r.amountCents) },
              ]}
              rows={d.adjustments}
            />
          </View>
        )}

        <View style={s.totals} wrap={false}>
          <View style={s.totalRow}>
            <Text>Subtotal</Text>
            <Text style={s.num}>{pdfMoney(d.subtotalCents)}</Text>
          </View>
          {d.taxCents !== 0 && (
            <View style={s.totalRow}>
              <Text>Tax</Text>
              <Text style={s.num}>{pdfMoney(d.taxCents)}</Text>
            </View>
          )}
          <View style={[s.totalRow, s.due]}>
            <Text>Amount due this invoice</Text>
            <Text style={s.num}>{pdfMoney(d.totalCents)}</Text>
          </View>
          {d.prior.length > 0 && (
            <View style={{ marginTop: 10 }}>
              <Text style={s.label}>Account summary</Text>
              {d.prior.map((p) => (
                <View key={p.number} style={s.totalRow}>
                  <Text style={s.muted}>
                    Invoice <Text style={{ fontFamily: "Plex Mono" }}>{p.number}</Text> outstanding
                  </Text>
                  <Text style={s.num}>{pdfMoney(p.balanceCents)}</Text>
                </View>
              ))}
              <View style={[s.totalRow, s.due]}>
                <Text>Total balance due</Text>
                <Text style={s.num}>{pdfMoney(d.totalCents + sum(d.prior.map((p) => p.balanceCents)))}</Text>
              </View>
            </View>
          )}
        </View>

        {d.timeDetail.length > 0 && (
          <View style={s.section} break>
            <Text style={s.sectionTitle}>Time detail</Text>
            <Table
              cols={[
                { title: "Date", width: 70, cell: (r) => formatDate(r.date) },
                { title: "Person", width: 100, cell: (r) => r.person },
                { title: "Phase", width: 110, cell: (r) => r.phase },
                { title: "Hours", width: 44, num: true, cell: (r) => Number(r.hours).toFixed(2) },
                { title: "Note", width: "auto", cell: (r) => r.note ?? "" },
              ]}
              rows={d.timeDetail}
            />
          </View>
        )}

        <View style={s.footer} fixed>
          <Text style={{ maxWidth: 400 }}>{d.remittance?.trim() || `Make checks payable to ${d.firm.name}.`}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** The invoice as PDF bytes. */
export async function renderInvoicePdf(d: InvoicePdfData): Promise<Uint8Array> {
  registerFonts();
  const buf = await renderToBuffer(<InvoiceDocument d={d} />);
  return new Uint8Array(buf);
}

/** "Invoice-26031-04.pdf" (numbers only contain safe characters: number-format.ts). */
export const pdfFileName = (number: string | null) => `Invoice-${(number ?? "draft").replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf`;
