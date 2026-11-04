"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { PlusIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { consultantFeeToClient } from "@/lib/calc/project-detail";
import { DISCIPLINES, moneyExact, parseMoney } from "@/lib/projects/form";
import { saveCompany } from "@/server/contacts/actions";
import type { CompanyChoice } from "@/server/projects/page";

// Consultants on New project (Blake, 2026-11-04): the same fields as on the
// project's Phases & fees tab. Their fees are separate from the
// architectural fee; the card's total shows what the client pays overall.

export type ConsultantDraft = {
  key: string;
  discipline: string;
  companyId: string;
  contactId: string;
  fee: string;
  markup: string;
  billedThrough: boolean;
};

const NEW = "__new";

export const newConsultant = (markupBp: number): ConsultantDraft => ({
  key: `c-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
  discipline: "",
  companyId: "",
  contactId: "",
  fee: "",
  markup: String(markupBp / 100),
  billedThrough: true,
});

/** Markup "10" / "12.5%" → basis points; null when not 0–100 with up to 2 decimals. */
export function parseMarkup(raw: string): number | null {
  const v = raw.trim().replace(/%$/, "").trim() || "0";
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  const bp = Math.round(Number(v) * 100);
  return bp <= 10_000 ? bp : null;
}

/** Problems found on the page, keyed like the server's ("consultants.0.feeCents"). */
export function checkConsultants(
  rows: readonly ConsultantDraft[],
): Record<string, string> {
  const errors: Record<string, string> = {};
  rows.forEach((r, i) => {
    if (!r.discipline.trim())
      errors[`consultants.${i}.discipline`] = "Pick a discipline";
    if (!r.companyId || r.companyId === NEW)
      errors[`consultants.${i}.companyId`] = "Pick a consultant";
    if (parseMoney(r.fee) === null)
      errors[`consultants.${i}.feeCents`] = "Enter an amount of $0 or more";
    if (parseMarkup(r.markup) === null)
      errors[`consultants.${i}.markupBp`] = "Use 0–100%, up to 2 decimals";
  });
  return errors;
}

export function NewConsultants({
  rows,
  onChange,
  choices,
  defaultMarkupBp,
  archFeeCents,
  errors,
}: {
  rows: ConsultantDraft[];
  onChange: (rows: ConsultantDraft[]) => void;
  choices: CompanyChoice[];
  defaultMarkupBp: number;
  archFeeCents: number;
  errors: Record<string, string>;
}) {
  const [companies, setCompanies] = useState(choices);
  const [adding, setAdding] = useState<{
    key: string;
    name: string;
    error: string | null;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (key: string, p: Partial<ConsultantDraft>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const toClient = rows.reduce((n, r) => {
    const fee = parseMoney(r.fee);
    const markup = parseMarkup(r.markup);
    if (fee === null || markup === null) return n;
    return (
      n +
      (consultantFeeToClient({
        feeCents: fee,
        markupBp: markup,
        billedThrough: r.billedThrough,
      }) ?? 0)
    );
  }, 0);

  function addCompany() {
    if (!adding) return;
    const name = adding.name.trim();
    if (!name) return setAdding({ ...adding, error: "Enter a name" });
    startTransition(async () => {
      const r = await saveCompany({
        id: null,
        name,
        kind: "consultant",
        description: "",
        phone: "",
        website: "",
        addressLine1: "",
        addressLine2: "",
        city: "",
        state: "",
        postalCode: "",
        primaryContactId: null,
        billingContactId: null,
        notes: "",
      });
      if (!r.ok)
        return setAdding({
          ...adding,
          error:
            r.fieldErrors?.name ?? r.error ?? "Couldn't add the consultant.",
        });
      setCompanies((c) =>
        [...c, { id: r.data.id, name, kind: "consultant", contacts: [] }].sort(
          (a, b) => a.name.localeCompare(b.name),
        ),
      );
      set(adding.key, { companyId: r.data.id, contactId: "" });
      setAdding(null);
    });
  }

  const box =
    "h-8 rounded-sm border border-line-input bg-surface px-2 aria-[invalid=true]:border-red";
  const th =
    "cap border-b border-line px-2 py-2 text-left text-2xs font-medium text-muted";
  const err = (i: number, k: string) => errors[`consultants.${i}.${k}`];

  return (
    <section
      aria-labelledby="new-consultants-title"
      className="rounded-sm border border-line bg-surface"
    >
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-[var(--spacing-card)] pt-4 pb-3">
        <h2 id="new-consultants-title" className="m-0 text-sm font-semibold">
          Consultants
        </h2>
        <span className="text-[12.5px] text-muted">
          Fees from their proposals. Separate from the architectural fee.
        </span>
      </header>
      <datalist id="disciplines">
        {DISCIPLINES.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table
            className="w-full min-w-[880px] border-collapse text-sm"
            aria-label="Consultants"
          >
            <thead className="bg-surface-2">
              <tr>
                <th scope="col" className={cn(th, "pl-[18px]")}>
                  Discipline
                </th>
                <th scope="col" className={th}>
                  Consultant
                </th>
                <th scope="col" className={th}>
                  Contact
                </th>
                <th scope="col" className={cn(th, "text-right")}>
                  Fee
                </th>
                <th scope="col" className={cn(th, "text-right")}>
                  Markup
                </th>
                <th scope="col" className={th}>
                  Billed through us
                </th>
                <th scope="col" className={cn(th, "text-right")}>
                  Fee to client
                </th>
                <th scope="col" className={cn(th, "pr-[18px]")}>
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const company = companies.find((c) => c.id === r.companyId);
                const fee = parseMoney(r.fee);
                const markup = parseMarkup(r.markup);
                const client =
                  fee !== null && markup !== null
                    ? consultantFeeToClient({
                        feeCents: fee,
                        markupBp: markup,
                        billedThrough: r.billedThrough,
                      })
                    : null;
                const rowErrors = [
                  "discipline",
                  "companyId",
                  "contactId",
                  "feeCents",
                  "markupBp",
                ]
                  .map((k) => err(i, k))
                  .filter(Boolean);
                const n = i + 1;
                return (
                  <tr key={r.key} data-consultant={n}>
                    <td className="border-b border-line-soft px-2 py-1.5 pl-[18px] align-top">
                      <input
                        aria-label={`Consultant ${n} discipline`}
                        list="disciplines"
                        value={r.discipline}
                        maxLength={40}
                        aria-invalid={!!err(i, "discipline") || undefined}
                        onChange={(e) =>
                          set(r.key, { discipline: e.target.value })
                        }
                        className={cn(box, "w-[120px]")}
                      />
                      {rowErrors.length > 0 && (
                        <p
                          role="alert"
                          className="m-0 mt-1 text-[12.5px] whitespace-nowrap text-red"
                        >
                          {rowErrors[0]}
                        </p>
                      )}
                    </td>
                    <td className="border-b border-line-soft px-2 py-1.5 align-top">
                      {adding?.key === r.key ? (
                        <span className="flex flex-col gap-1">
                          <span className="flex gap-1.5">
                            <input
                              aria-label="New consultant name"
                              autoFocus
                              value={adding.name}
                              maxLength={200}
                              onChange={(e) =>
                                setAdding({
                                  ...adding,
                                  name: e.target.value,
                                  error: null,
                                })
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  addCompany();
                                }
                              }}
                              className={cn(box, "w-[160px]")}
                            />
                            <Button
                              type="button"
                              variant="primary"
                              disabled={pending}
                              onClick={addCompany}
                            >
                              Add
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => setAdding(null)}
                            >
                              Cancel
                            </Button>
                          </span>
                          {adding.error && (
                            <span className="text-[12.5px] text-red">
                              {adding.error}
                            </span>
                          )}
                        </span>
                      ) : (
                        <select
                          aria-label={`Consultant ${n} company`}
                          value={r.companyId}
                          aria-invalid={!!err(i, "companyId") || undefined}
                          onChange={(e) =>
                            e.target.value === NEW
                              ? setAdding({ key: r.key, name: "", error: null })
                              : set(r.key, {
                                  companyId: e.target.value,
                                  contactId: "",
                                })
                          }
                          className={cn(box, "w-[180px]")}
                        >
                          <option value="">Choose…</option>
                          {companies.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                          <option value={NEW}>+ New consultant…</option>
                        </select>
                      )}
                    </td>
                    <td className="border-b border-line-soft px-2 py-1.5 align-top">
                      <select
                        aria-label={`Consultant ${n} contact`}
                        value={r.contactId}
                        disabled={!company || company.contacts.length === 0}
                        onChange={(e) =>
                          set(r.key, { contactId: e.target.value })
                        }
                        className={cn(box, "w-[150px]")}
                      >
                        <option value="">—</option>
                        {company?.contacts.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="border-b border-line-soft px-2 py-1.5 text-right align-top">
                      <input
                        aria-label={`Consultant ${n} fee`}
                        value={r.fee}
                        inputMode="decimal"
                        aria-invalid={!!err(i, "feeCents") || undefined}
                        onChange={(e) => set(r.key, { fee: e.target.value })}
                        className={cn(box, "num w-[110px] text-right")}
                      />
                    </td>
                    <td className="border-b border-line-soft px-2 py-1.5 text-right align-top whitespace-nowrap">
                      <input
                        aria-label={`Consultant ${n} markup`}
                        value={r.markup}
                        inputMode="decimal"
                        aria-invalid={!!err(i, "markupBp") || undefined}
                        onChange={(e) => set(r.key, { markup: e.target.value })}
                        className={cn(box, "num w-[56px] text-right")}
                      />
                      <span className="ml-1 text-muted">%</span>
                    </td>
                    <td className="border-b border-line-soft px-2 py-1.5 align-top">
                      <input
                        type="checkbox"
                        aria-label={`Consultant ${n} billed through us`}
                        checked={r.billedThrough}
                        onChange={(e) =>
                          set(r.key, { billedThrough: e.target.checked })
                        }
                        className="mt-2 size-4 cursor-pointer accent-ink"
                      />
                    </td>
                    <td
                      className="num border-b border-line-soft px-2 py-1.5 text-right align-top leading-8"
                      data-testid={`consultant-${n}-to-client`}
                    >
                      {client === null ? (
                        <span className="font-sans text-xs text-muted">
                          Not billed through
                        </span>
                      ) : (
                        moneyExact(client)
                      )}
                    </td>
                    <td className="border-b border-line-soft px-2 py-1.5 pr-[18px] text-right align-top">
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label={`Remove consultant ${n}`}
                        onClick={() =>
                          onChange(rows.filter((x) => x.key !== r.key))
                        }
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-[var(--spacing-card)] py-4 text-sm">
        <Button
          type="button"
          icon={<PlusIcon />}
          onClick={() => onChange([...rows, newConsultant(defaultMarkupBp)])}
        >
          Add consultant
        </Button>
        <span className="ml-auto text-ink-3" data-testid="total-to-client">
          Architectural fee {moneyExact(archFeeCents)} + consultants{" "}
          {moneyExact(toClient)} ={" "}
          <strong className="num text-ink">
            {moneyExact(archFeeCents + toClient)}
          </strong>{" "}
          to the client
        </span>
      </div>
    </section>
  );
}

/** Drafts → what the server expects (call after checkConsultants passes). */
export function consultantsPayload(rows: readonly ConsultantDraft[]) {
  return rows.map((r) => ({
    discipline: r.discipline.trim(),
    companyId: r.companyId,
    contactId: r.contactId || null,
    feeCents: parseMoney(r.fee) ?? 0,
    markupBp: parseMarkup(r.markup) ?? 0,
    billedThrough: r.billedThrough,
  }));
}
