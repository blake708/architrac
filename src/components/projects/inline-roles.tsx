"use client";

import { useState } from "react";
import { PlusIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { shareFromHours } from "@/lib/calc/benchmarks";
import { mixHours, mixTotalBp } from "@/lib/calc/phase-edit";
import { fmtHours } from "@/lib/calc/project-detail";
import { formatMoney } from "@/lib/format";
import type { MixRow, RoleOption } from "./role-mix-panel";

// Roles under a phase on New project (Blake, 2026-11-04): pick a role, then
// type its share of the phase fee OR its hours; the other one follows
// (hours = share × fee ÷ bill rate, to the quarter hour). Shares must add up
// to 100%, or there are no roles (the phase then uses the blended rate).

const pctText = (bp: number) => String(bp / 100);
function parsePct(raw: string): number | null {
  const v = raw.trim().replace(/%$/, "");
  if (v === "") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  const bp = Math.round(Number(v) * 100);
  return bp <= 10_000 ? bp : null;
}
function parseHours(raw: string): number | null {
  const v = raw.trim().replace(/,/g, "");
  if (v === "") return 0;
  if (!/^\d+(\.\d+)?$/.test(v)) return null;
  return Number(v);
}

/** Ready to save: every row has a role, and 100% (or no rows). */
export const rolesReady = (mix: readonly MixRow[]) =>
  mix.every((m) => m.firmRoleId) &&
  (mix.length === 0 || mixTotalBp(mix) === 10_000);

export function InlineRoles({
  phaseName,
  feeCents,
  mix,
  roles,
  onChange,
}: {
  phaseName: string;
  feeCents: number;
  mix: MixRow[];
  roles: RoleOption[];
  onChange: (mix: MixRow[]) => void;
}) {
  // What's in a box while it's typed (row index → text); cleared on blur.
  const [typing, setTyping] = useState<Record<string, string>>({});
  const rateOf = (id: string) => roles.find((r) => r.id === id)?.billCents ?? 0;
  const calc = mixHours(
    feeCents,
    mix.map((m) => ({
      roleId: m.firmRoleId,
      shareBp: m.shareBp,
      rateCents: rateOf(m.firmRoleId),
    })),
  );
  const total = mixTotalBp(mix);
  const unused = roles.filter((r) => !mix.some((m) => m.firmRoleId === r.id));
  const set = (i: number, p: Partial<MixRow>) =>
    onChange(mix.map((m, j) => (j === i ? { ...m, ...p } : m)));
  const clear = (k: string) =>
    setTyping((t) => {
      const n = { ...t };
      delete n[k];
      return n;
    });
  const box =
    "num h-7 rounded-sm border border-line-input bg-surface px-1.5 text-right aria-[invalid=true]:border-red";

  if (roles.length === 0)
    return (
      <p className="m-0 text-xs text-muted">
        Add roles and rates in Settings → Rates &amp; roles to plan hours by
        role.
      </p>
    );

  return (
    <div className="flex flex-col gap-1.5">
      {mix.length > 0 && (
        <table
          className="w-auto border-collapse text-xs [&_td]:py-0.5 [&_td]:pr-3 [&_th]:pr-3"
          aria-label={`Roles for ${phaseName}`}
        >
          <thead>
            <tr className="cap text-left text-2xs text-muted">
              <th scope="col" className="py-1 font-medium">
                Role
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Share
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Hours
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Rate
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Fee
              </th>
              <th scope="col" className="py-1">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {mix.map((m, i) => {
              const role = roles.find((r) => r.id === m.firmRoleId);
              const label = role?.name ?? `Role ${i + 1}`;
              const pctKey = `${i}:pct`;
              const hoursKey = `${i}:hours`;
              const hoursTyped = typing[hoursKey];
              const hoursBad =
                hoursTyped !== undefined &&
                (parseHours(hoursTyped) === null ||
                  shareFromHours(
                    parseHours(hoursTyped) ?? 0,
                    rateOf(m.firmRoleId),
                    feeCents,
                  ) === null);
              return (
                <tr key={i} data-role={role?.name ?? ""}>
                  <td>
                    <select
                      aria-label={`${phaseName} role ${i + 1}`}
                      value={m.firmRoleId}
                      onChange={(e) => set(i, { firmRoleId: e.target.value })}
                      className="h-7 rounded-sm border border-line-input bg-surface px-1"
                    >
                      <option value="">Choose…</option>
                      {roles
                        .filter(
                          (r) =>
                            r.id === m.firmRoleId ||
                            !mix.some((x) => x.firmRoleId === r.id),
                        )
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <input
                      aria-label={`${phaseName} ${label} share`}
                      value={typing[pctKey] ?? pctText(m.shareBp)}
                      inputMode="decimal"
                      aria-invalid={
                        (typing[pctKey] !== undefined &&
                          parsePct(typing[pctKey]) === null) ||
                        undefined
                      }
                      onChange={(e) => {
                        setTyping((t) => ({ ...t, [pctKey]: e.target.value }));
                        const bp = parsePct(e.target.value);
                        if (bp !== null) set(i, { shareBp: bp });
                      }}
                      onBlur={() => clear(pctKey)}
                      className={cn(box, "w-[56px]")}
                    />
                    <span className="ml-0.5 text-muted">%</span>
                  </td>
                  <td className="text-right">
                    <input
                      aria-label={`${phaseName} ${label} hours`}
                      value={
                        hoursTyped ??
                        fmtHours(calc.roles[i]?.hours ?? 0).replace(/,/g, "")
                      }
                      inputMode="decimal"
                      aria-invalid={hoursBad || undefined}
                      title={
                        hoursBad
                          ? "Set the phase fee and the role's bill rate first"
                          : undefined
                      }
                      onChange={(e) => {
                        setTyping((t) => ({
                          ...t,
                          [hoursKey]: e.target.value,
                        }));
                        const h = parseHours(e.target.value);
                        const bp =
                          h === null
                            ? null
                            : shareFromHours(h, rateOf(m.firmRoleId), feeCents);
                        if (bp !== null)
                          set(i, { shareBp: Math.min(bp, 10_000) });
                      }}
                      onBlur={() => clear(hoursKey)}
                      className={cn(box, "w-[64px]")}
                    />
                  </td>
                  <td
                    className={cn(
                      "num text-right",
                      role && role.billCents <= 0 && "text-orange-strong",
                    )}
                  >
                    {role
                      ? role.billCents > 0
                        ? `${formatMoney(role.billCents)}/h`
                        : "No rate"
                      : "—"}
                  </td>
                  <td className="num text-right">
                    {formatMoney(calc.roles[i]?.cents ?? 0)}
                  </td>
                  <td>
                    <button
                      type="button"
                      aria-label={`Remove ${label} from ${phaseName}`}
                      onClick={() => onChange(mix.filter((_, j) => j !== i))}
                      className="cursor-pointer border-0 bg-transparent p-0 text-muted underline hover:text-ink"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td>Total</td>
              <td
                className={cn("num text-right", total !== 10_000 && "text-red")}
                data-testid={`roles-total-${phaseName}`}
              >
                {pctText(total)}%
              </td>
              <td className="num text-right">{fmtHours(calc.total)}</td>
              <td />
              <td className="num text-right">
                {formatMoney(calc.roles.reduce((n, r) => n + r.cents, 0))}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      )}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <button
          type="button"
          disabled={unused.length === 0}
          aria-label={`Add role to ${phaseName}`}
          onClick={() => {
            const rest = Math.max(0, 10_000 - total);
            onChange([...mix, { firmRoleId: unused[0].id, shareBp: rest }]);
          }}
          className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-blue underline disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PlusIcon className="size-3" /> Add role
        </button>
        {mix.length === 0 && (
          <span className="text-muted">
            No roles: hours come from the blended bill rate.
          </span>
        )}
        {mix.length > 0 && total !== 10_000 && (
          <span role="alert" className="text-red">
            Roles add up to {pctText(total)}%; they need to make 100%.
          </span>
        )}
      </div>
    </div>
  );
}
