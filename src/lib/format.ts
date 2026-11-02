// Turning stored values into text for the screen. Format only when showing;
// store and calculate with the raw values (CLAUDE.md rule 2).

/** "Oct 20", in the firm's time zone. */
export function formatMonthDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone,
  }).format(date);
}

const money0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const money2 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Cents as dollars. "$612,000" by default; `{ cents: true }` → "$70.40".
 * Whole dollars round to the nearest dollar (125833 → "$1,258").
 */
export function formatMoney(
  cents: number,
  opts: { cents?: boolean } = {},
): string {
  return (opts.cents ? money2 : money0).format(cents / 100);
}

/** A multiplier in hundredths: 195 → "1.95×". Null → "—". */
export function formatMultiplier(hundredths: number | null): string {
  if (hundredths === null) return "—";
  return `${(hundredths / 100).toFixed(2)}×`;
}

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * A calendar date stored as "YYYY-MM-DD" → "Jan 1, 2026". Read as UTC so the
 * day never shifts with the viewer's time zone.
 */
export function formatDate(isoDate: string): string {
  return dateFmt.format(new Date(`${isoDate}T00:00:00Z`));
}

/** Today's date in a time zone, as "YYYY-MM-DD". */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
