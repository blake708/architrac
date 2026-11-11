import { z } from "zod";

// Contacts forms and display rules (contacts spec, Actions → form fields,
// business rules 8–9). Shared by the page and the server.

export const COMPANY_KINDS = [
  "client",
  "consultant",
  "contractor",
  "agency",
  "vendor",
  "other",
] as const;
export type CompanyKind = (typeof COMPANY_KINDS)[number];

export const KIND_LABELS: Record<CompanyKind, string> = {
  client: "Client",
  consultant: "Consultant",
  contractor: "Contractor",
  agency: "Agency",
  vendor: "Vendor",
  other: "Other",
};
/** Plural, for the filter. */
export const KIND_FILTER_LABELS: Record<CompanyKind, string> = {
  client: "Clients",
  consultant: "Consultants",
  contractor: "Contractors",
  agency: "Agencies",
  vendor: "Vendors",
  other: "Other",
};

/** Pill / badge colours (fill, text) from the spec. */
export const KIND_COLORS: Record<CompanyKind, { bg: string; fg: string }> = {
  client: { bg: "#E4EBF8", fg: "#1E3F7A" },
  consultant: { bg: "#EFE7FA", fg: "#5B2E9E" },
  contractor: { bg: "#FCE7DF", fg: "#9A3412" },
  agency: { bg: "#E2F1E6", fg: "#1D6234" },
  vendor: { bg: "#EBEBEB", fg: "#3A3A3A" },
  other: { bg: "#EBEBEB", fg: "#3A3A3A" },
};

export const TAG_SUGGESTIONS = ["Main contact", "Billing", "Copy on letters", "Site"];

export const CONTACT_MESSAGES = {
  name: "Enter a company name",
  firstName: "Enter a first name",
  long: "Too long",
  zip: "Enter a 5-digit ZIP or ZIP+4",
  state: "Use the 2-letter state code",
  website: "Enter a website like www.example.com",
  email: "Enter a valid email address",
  tag: "Tags can be up to 30 characters",
  forbidden: "You don't have permission to edit contacts.",
  notFound: "This company was archived or doesn't exist.",
  contactNotFound: "This contact was archived or doesn't exist.",
  billingArchive: (company: string) =>
    `Choose another billing contact for ${company} first.`,
  openProjects: (n: number) =>
    `This company is the client on ${n} open ${n === 1 ? "project" : "projects"}.`,
  wrongCompanyContact: "Pick someone who works at this company",
} as const;

/** Rule 9: "Palmetto Medical Properties" → "PM". */
export function monogram(name: string): string {
  const words = name
    .replace(/[[\]]/g, "")
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w));
  return words
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

/** Person badge: first + last initial, or the first two letters. */
export function personInitials(first: string, last: string): string {
  return (last ? first[0] + last[0] : first.slice(0, 2)).toUpperCase();
}

/** "www.example.com" → "https://www.example.com". Null if it isn't a URL. */
export function normalizeWebsite(raw: string): string | null {
  const v = raw.trim();
  if (!v) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname.includes(".")) return null;
    return withScheme.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: CONTACT_MESSAGES.long })
    .transform((v) => (v === "" ? null : v));

export const companySchema = z.object({
  id: z.uuid().nullable(),
  name: z
    .string()
    .trim()
    .min(1, { error: CONTACT_MESSAGES.name })
    .max(200, { error: CONTACT_MESSAGES.long }),
  kind: z.enum(COMPANY_KINDS),
  description: text(200),
  phone: text(40),
  website: z
    .string()
    .transform((v, ctx) => {
      const n = normalizeWebsite(v);
      if (n === null) {
        ctx.addIssue({ code: "custom", message: CONTACT_MESSAGES.website });
        return z.NEVER;
      }
      return n === "" ? null : n;
    }),
  addressLine1: text(200),
  addressLine2: text(200),
  city: text(100),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === "" || /^[A-Z]{2}$/.test(v), { error: CONTACT_MESSAGES.state })
    .transform((v) => (v === "" ? null : v)),
  postalCode: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{5}(-\d{4})?$/.test(v), { error: CONTACT_MESSAGES.zip })
    .transform((v) => (v === "" ? null : v)),
  primaryContactId: z.uuid().nullable(),
  billingContactId: z.uuid().nullable(),
  /** Shared AP address for invoices (clients only, decision #32). */
  billingEmail: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, { error: CONTACT_MESSAGES.long })
    .refine((v) => v === "" || z.email().safeParse(v).success, {
      error: CONTACT_MESSAGES.email,
    })
    .transform((v) => (v === "" ? null : v))
    .optional()
    .default(""),
  notes: text(4000),
});
export type CompanyInput = z.input<typeof companySchema>;

export const contactSchema = z.object({
  id: z.uuid().nullable(),
  firstName: z
    .string()
    .trim()
    .min(1, { error: CONTACT_MESSAGES.firstName })
    .max(100, { error: CONTACT_MESSAGES.long }),
  lastName: z.string().trim().max(100, { error: CONTACT_MESSAGES.long }),
  designations: text(40),
  title: text(100),
  companyId: z.uuid().nullable(),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .refine((v) => v === "" || z.email().safeParse(v).success, {
      error: CONTACT_MESSAGES.email,
    })
    .transform((v) => (v === "" ? null : v)),
  phone: text(40),
  mobile: text(40),
  tags: z
    .array(z.string().trim().min(1).max(30, { error: CONTACT_MESSAGES.tag }))
    .max(20)
    .transform((tags) => {
      const seen = new Set<string>();
      return tags.filter((t) => {
        const k = t.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }),
  notes: text(4000),
  /** Set this contact as the company's main / billing contact. */
  isMain: z.boolean(),
  isBilling: z.boolean(),
});
export type ContactInput = z.input<typeof contactSchema>;

export function fieldErrorsOf(issues: { path: PropertyKey[]; message: string }[]) {
  const out: Record<string, string> = {};
  for (const i of issues) out[String(i.path[0] ?? "form")] ??= i.message;
  return out;
}
