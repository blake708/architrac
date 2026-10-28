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
