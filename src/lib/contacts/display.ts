import { formatMoney } from "@/lib/format";
import type { CompanyRow, ContactRow } from "@/server/contacts/view";
import type { CompanyKind } from "./form";

// Contacts list rules (contacts spec, business rules 1–2, 8 and Data shown).
// Pure, so the page and tests share them. All rows are loaded (≤ 1,000), so
// search and filters run in the browser as you type.

export type KindFilter = "all" | CompanyKind;

export const personName = (p: Pick<ContactRow, "firstName" | "lastName" | "designations">) =>
  `${p.firstName} ${p.lastName}`.trim() + (p.designations ? `, ${p.designations}` : "");

const fullName = (p: Pick<ContactRow, "firstName" | "lastName">) =>
  `${p.firstName} ${p.lastName}`.trim();

const has = (hay: (string | null | undefined)[], q: string) =>
  hay.some((h) => h?.toLowerCase().includes(q));

/** Rule 2: name, description, main contact's name. */
export function filterCompanies(
  companies: readonly CompanyRow[],
  people: readonly ContactRow[],
  q: string,
  kind: KindFilter,
): CompanyRow[] {
  const needle = q.trim().toLowerCase();
  const byId = new Map(people.map((p) => [p.id, p]));
  return companies.filter((c) => {
    if (kind !== "all" && c.kind !== kind) return false;
    if (!needle) return true;
    const main = c.primaryContactId ? byId.get(c.primaryContactId) : undefined;
    return has([c.name, c.description, main && fullName(main)], needle);
  });
}

/**
 * Rule 2: name, title, email, company name, any tag. Rule 8: the kind filter
 * uses the company's kind; people with no company only show under All.
 */
export function filterPeople(
  people: readonly ContactRow[],
  companyById: ReadonlyMap<string, { name: string; kind: CompanyKind }>,
  q: string,
  kind: KindFilter,
): ContactRow[] {
  const needle = q.trim().toLowerCase();
  return people.filter((p) => {
    const company = p.companyId ? companyById.get(p.companyId) : undefined;
    if (kind !== "all" && company?.kind !== kind) return false;
    if (!needle) return true;
    return has([fullName(p), p.title, p.email, company?.name, ...p.tags], needle);
  });
}

/** The Billed / fees cell (owner/admin). Null = "—". */
export function moneyCell(
  c: CompanyRow,
): { main: string; note: string; open: boolean } | null {
  const m = c.money;
  if (!m) return null;
  if (m.kind === "consultant")
    return m.feesCents > 0
      ? { main: formatMoney(m.feesCents), note: "Fees, all projects", open: false }
      : null;
  // Nothing billed yet: "—", not "Paid up" (spec open question 10).
  if (m.billedCents === 0) return null;
  return m.openCents > 0
    ? { main: formatMoney(m.billedCents), note: `${formatMoney(m.openCents)} open`, open: true }
    : { main: formatMoney(m.billedCents), note: "Paid up", open: false };
}

/** "123 Main St, Suite 4, Charleston, SC 29401" lines, or null. */
export function addressLines(c: CompanyRow): string[] {
  const cityLine = [c.city, [c.state, c.postalCode].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return [c.addressLine1, c.addressLine2, cityLine].filter((x): x is string => !!x);
}
