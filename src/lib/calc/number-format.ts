// Firm-built number formats for invoice and project numbers (decisions #5
// and #28; invoicing spec rule 1, projects-list spec rule 5).
//
// A format is text with codes in braces:
//   {YYYY} / {YY}  the year (2026 / 26)
//   {PROJECT}      the project's number (invoice formats only)
//   {#} … {######} the counter, zero-padded to the number of #
// Anything else is printed as typed. Examples:
//   "{YYYY}-{###}"   + 128          → "2026-128"
//   "{YY}{###}"      + 31           → "26031"
//   "{PROJECT}-{##}" + 4 on "26031" → "26031-04"

export type NumberFormatPart =
  | { kind: "text"; text: string }
  | { kind: "year4" }
  | { kind: "year2" }
  | { kind: "project" }
  | { kind: "counter"; width: number };

/** What the format is for. Project numbers can't contain {PROJECT}. */
export type NumberFormatKind = "invoice" | "project";

export const DEFAULT_INVOICE_NUMBER_FORMAT = "{YYYY}-{###}";
export const DEFAULT_PROJECT_NUMBER_FORMAT = "{YYYY}-{###}";

export const NUMBER_FORMAT_MAX = 40;
/** projects.number allows 20 characters (projects-list spec). */
export const PROJECT_NUMBER_MAX = 20;
/** Longest invoice number a format may produce (projects can be 20 long). */
export const INVOICE_NUMBER_MAX = 40;

// Text between codes. Invoice numbers end up in file names
// ("Invoice-26031-04.pdf"), so no slashes or other punctuation.
const TEXT_ALLOWED: Record<NumberFormatKind, RegExp> = {
  invoice: /^[A-Za-z0-9._ -]*$/,
  project: /^[A-Za-z0-9-]*$/,
};

const TEXT_HINT: Record<NumberFormatKind, string> = {
  invoice: "Only letters, numbers, spaces, dashes, dots and underscores can go between codes.",
  project: "Only letters, numbers and dashes can go between codes.",
};

const CODES_HINT: Record<NumberFormatKind, string> = {
  invoice: "Use {YYYY}, {YY}, {PROJECT} or {###}.",
  project: "Use {YYYY}, {YY} or {###}.",
};

export type ParseResult = { ok: true; parts: NumberFormatPart[] } | { ok: false; error: string };

/** Split a format into its parts, or say what's wrong with it. */
export function parseNumberFormat(format: string, kind: NumberFormatKind): ParseResult {
  const text = format.trim();
  if (!text) return { ok: false, error: "Enter a format, like {YYYY}-{###}." };
  if (text.length > NUMBER_FORMAT_MAX)
    return { ok: false, error: `Keep the format to ${NUMBER_FORMAT_MAX} characters or fewer.` };

  const parts: NumberFormatPart[] = [];
  const re = /\{([^{}]*)\}/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parts.push({ kind: "text", text: text.slice(last, m.index) });
    const code = m[1].toUpperCase();
    if (code === "YYYY") parts.push({ kind: "year4" });
    else if (code === "YY") parts.push({ kind: "year2" });
    else if (code === "PROJECT" && kind === "invoice") parts.push({ kind: "project" });
    else if (code === "PROJECT") return { ok: false, error: "{PROJECT} can't be used in a project number." };
    else if (/^#{1,6}$/.test(code)) parts.push({ kind: "counter", width: code.length });
    else if (/^#+$/.test(code)) return { ok: false, error: "A counter can have at most 6 #." };
    else return { ok: false, error: `Unknown code {${m[1]}}. ${CODES_HINT[kind]}` };
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });

  for (const p of parts) {
    if (p.kind !== "text") continue;
    if (/[{}]/.test(p.text)) return { ok: false, error: "Every { needs a matching }." };
    if (!TEXT_ALLOWED[kind].test(p.text)) return { ok: false, error: TEXT_HINT[kind] };
  }
  const counters = parts.filter((p) => p.kind === "counter").length;
  if (counters === 0) return { ok: false, error: "Add a counter, like {###}." };
  if (counters > 1) return { ok: false, error: "Use only one counter." };
  if (parts.filter((p) => p.kind === "project").length > 1)
    return { ok: false, error: "{PROJECT} can only be used once." };

  // The longest number this could make must still fit.
  const max = kind === "project" ? PROJECT_NUMBER_MAX : INVOICE_NUMBER_MAX;
  const longest = render(parts, { year: 2026, projectNumber: "X".repeat(PROJECT_NUMBER_MAX), n: 1 });
  if (longest.length > max)
    return {
      ok: false,
      error:
        kind === "project"
          ? `Project numbers can be up to ${max} characters; this format makes longer ones.`
          : `Invoice numbers can be up to ${max} characters; this format can make longer ones.`,
    };
  return { ok: true, parts };
}

/** The error to show for a format, or null when it's fine. */
export function validateNumberFormat(format: string, kind: NumberFormatKind): string | null {
  const r = parseNumberFormat(format, kind);
  return r.ok ? null : r.error;
}

export type NumberContext = {
  /** The issue year (invoices) or the current year (projects), firm time zone. */
  year: number;
  /** The project's number; needed when the format has {PROJECT}. */
  projectNumber?: string;
};

export const usesProject = (format: string) => /\{project\}/i.test(format);

function render(parts: NumberFormatPart[], ctx: NumberContext & { n: number }): string {
  return parts
    .map((p) => {
      switch (p.kind) {
        case "text":
          return p.text;
        case "year4":
          return String(ctx.year).padStart(4, "0");
        case "year2":
          return String(ctx.year % 100).padStart(2, "0");
        case "project":
          return ctx.projectNumber ?? "";
        case "counter":
          // Padded, never cut: {##} with 128 → "128".
          return String(ctx.n).padStart(p.width, "0");
      }
    })
    .join("");
}

/** Build a number. Throws on a bad format (save-time validation keeps them out). */
export function formatNumber(format: string, kind: NumberFormatKind, ctx: NumberContext & { n: number }): string {
  const r = parseNumberFormat(format, kind);
  if (!r.ok) throw new Error(`Bad ${kind} number format "${format}": ${r.error}`);
  if (r.parts.some((p) => p.kind === "project") && !ctx.projectNumber)
    throw new Error("This number format needs the project number.");
  if (!Number.isInteger(ctx.n) || ctx.n < 1) throw new Error("The counter must be a whole number from 1.");
  return render(r.parts, ctx);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The counter inside a number made by this format (with this year and
 * project filled in), or null when the number doesn't fit the format.
 * Ignores case, like project numbers do. "26031" with {YY}{###} in 2026 → 31.
 */
export function counterIn(number: string, format: string, kind: NumberFormatKind, ctx: NumberContext): number | null {
  const r = parseNumberFormat(format, kind);
  if (!r.ok) return null;
  const pattern = r.parts
    .map((p) => (p.kind === "counter" ? "(\\d+)" : escape(render([p], { ...ctx, n: 1 }))))
    .join("");
  const m = new RegExp(`^${pattern}$`, "i").exec(number.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) ? n : null;
}
