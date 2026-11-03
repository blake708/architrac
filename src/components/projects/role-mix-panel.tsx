"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DrawerContent } from "@/components/ui/dialog";
import { PlusIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { mixHours, mixTotalBp } from "@/lib/calc/phase-edit";
import { fmtHours } from "@/lib/calc/project-detail";
import { formatMoney } from "@/lib/format";

export type MixRow = { firmRoleId: string; shareBp: number };
export type RoleOption = { id: string; name: string; billCents: number };

const pctText = (bp: number) => String(bp / 100);
function parsePct(raw: string): number | null {
  const v = raw.trim().replace(/%$/, "");
  if (v === "") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  const bp = Math.round(Number(v) * 100);
  return bp <= 10_000 ? bp : null;
}

/**
 * A phase's role mix (Blake, 2026-11-03): each role's share of the phase
 * fee, its bill rate, dollars and hours (share × fee ÷ rate, to the quarter
 * hour). Shares must add up to exactly 100%, or the mix is empty (the phase
 * then uses the blended bill rate). Bill rates only; never cost.
 */
export function RoleMixPanel({
  title,
  feeCents,
  mix,
  roles,
  readOnly,
  onSave,
  onClose,
}: {
  title: string;
  /** The phase fee; null in Settings, where there's no fee yet. */
  feeCents: number | null;
  mix: MixRow[];
  roles: RoleOption[];
  readOnly?: boolean;
  onSave: (mix: MixRow[]) => void | Promise<void>;
  onClose: () => void;
}) {
  const [rows, setRows] = useState(() => mix.map((m) => ({ ...m, text: pctText(m.shareBp) })));
  const [saving, setSaving] = useState(false);
  const rateOf = (id: string) => roles.find((r) => r.id === id)?.billCents ?? 0;
  const total = mixTotalBp(rows);
  const bad = rows.some((r) => parsePct(r.text) === null) || rows.some((r) => !r.firmRoleId);
  const calc = feeCents === null ? null : mixHours(feeCents, rows.map((r) => ({ roleId: r.firmRoleId, shareBp: r.shareBp, rateCents: rateOf(r.firmRoleId) })));
  const unused = roles.filter((r) => !rows.some((x) => x.firmRoleId === r.id));
  const canSave = !bad && (rows.length === 0 || total === 10_000);
  const set = (i: number, p: Partial<(typeof rows)[number]>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DrawerContent
        title={title}
        description={feeCents === null ? "Default role mix for new projects" : `Fee ${formatMoney(feeCents)} · hours = share of fee ÷ role's bill rate`}
        className="max-w-[560px]!"
        footer={
          readOnly ? (
            <Button onClick={onClose}>Close</Button>
          ) : (
            <>
              {rows.length > 0 && total !== 10_000 && (
                <span role="alert" className="mr-auto text-sm text-red">
                  Shares add up to {pctText(total)}%; they need to make 100%
                </span>
              )}
              <Button onClick={onClose}>Cancel</Button>
              <Button
                variant="primary"
                disabled={!canSave || saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await onSave(rows.map(({ firmRoleId, shareBp }) => ({ firmRoleId, shareBp })));
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving ? "Saving…" : "Save roles"}
              </Button>
            </>
          )
        }
      >
        {roles.length === 0 ? (
          <p className="m-0 text-sm text-muted">Add roles and rates in Settings → Rates &amp; roles first.</p>
        ) : (
          <>
            <table className="w-full border-collapse text-sm" aria-label="Role mix">
              <thead>
                <tr className="cap text-left text-2xs text-muted">
                  <th scope="col" className="border-b border-line py-2 font-medium">Role</th>
                  <th scope="col" className="border-b border-line py-2 text-right font-medium">Share</th>
                  <th scope="col" className="border-b border-line py-2 text-right font-medium">Rate</th>
                  {calc && <th scope="col" className="border-b border-line py-2 text-right font-medium">Fee</th>}
                  {calc && <th scope="col" className="border-b border-line py-2 text-right font-medium">Hours</th>}
                  {!readOnly && <th scope="col" className="border-b border-line py-2"><span className="sr-only">Remove</span></th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const role = roles.find((x) => x.id === r.firmRoleId);
                  const res = calc?.roles[i];
                  return (
                    <tr key={i} data-role={role?.name ?? ""}>
                      <td className="border-b border-line-soft py-1.5 pr-2">
                        {readOnly ? (
                          role?.name
                        ) : (
                          <select
                            aria-label={`Role ${i + 1}`}
                            value={r.firmRoleId}
                            onChange={(e) => set(i, { firmRoleId: e.target.value })}
                            className="h-8 w-full rounded-sm border border-line-input bg-surface px-1.5"
                          >
                            <option value="">Choose…</option>
                            {roles
                              .filter((x) => x.id === r.firmRoleId || !rows.some((y) => y.firmRoleId === x.id))
                              .map((x) => (
                                <option key={x.id} value={x.id}>
                                  {x.name}
                                </option>
                              ))}
                          </select>
                        )}
                      </td>
                      <td className="border-b border-line-soft py-1.5 text-right">
                        {readOnly ? (
                          `${pctText(r.shareBp)}%`
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <input
                              aria-label={`${role?.name ?? `Role ${i + 1}`} share`}
                              value={r.text}
                              inputMode="decimal"
                              aria-invalid={parsePct(r.text) === null || undefined}
                              onChange={(e) => {
                                const bp = parsePct(e.target.value);
                                set(i, { text: e.target.value, ...(bp !== null ? { shareBp: bp } : {}) });
                              }}
                              className="num h-8 w-[64px] rounded-sm border border-line-input bg-surface px-2 text-right aria-[invalid=true]:border-red"
                            />
                            <span className="text-muted">%</span>
                          </span>
                        )}
                      </td>
                      <td className={cn("num border-b border-line-soft py-1.5 text-right", role && role.billCents <= 0 && "text-orange-strong")}>
                        {role ? (role.billCents > 0 ? `${formatMoney(role.billCents)}/h` : "No rate") : "—"}
                      </td>
                      {calc && <td className="num border-b border-line-soft py-1.5 text-right">{formatMoney(res?.cents ?? 0)}</td>}
                      {calc && <td className="num border-b border-line-soft py-1.5 text-right">{fmtHours(res?.hours ?? 0)}</td>}
                      {!readOnly && (
                        <td className="border-b border-line-soft py-1.5 text-right">
                          <Button variant="ghost" aria-label={`Remove ${role?.name ?? "role"}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                            Remove
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td className="py-2">Total</td>
                  <td className={cn("num py-2 text-right", rows.length > 0 && total !== 10_000 && "text-red")} data-testid="mix-total">
                    {pctText(total)}%
                  </td>
                  <td />
                  {calc && <td className="num py-2 text-right">{formatMoney(calc.roles.reduce((n, r) => n + r.cents, 0))}</td>}
                  {calc && (
                    <td className="num py-2 text-right" data-testid="mix-hours">
                      {fmtHours(calc.total)}
                    </td>
                  )}
                  {!readOnly && <td />}
                </tr>
              </tfoot>
            </table>
            {!readOnly && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  icon={<PlusIcon />}
                  disabled={unused.length === 0}
                  onClick={() => {
                    const next = unused[0];
                    const rest = Math.max(0, 10_000 - total);
                    setRows((rs) => [...rs, { firmRoleId: next.id, shareBp: rest, text: pctText(rest) }]);
                  }}
                >
                  Add role
                </Button>
                {rows.length > 0 && total !== 10_000 && total < 10_000 && (
                  <Button
                    onClick={() => {
                      const last = rows.length - 1;
                      const bp = rows[last].shareBp + 10_000 - total;
                      set(last, { shareBp: bp, text: pctText(bp) });
                    }}
                  >
                    Use the rest for {roles.find((x) => x.id === rows[rows.length - 1].firmRoleId)?.name ?? "the last role"}
                  </Button>
                )}
              </div>
            )}
            {calc?.roles.some((r) => r.noRate) && (
              <p className="m-0 mt-3 text-xs text-orange-strong">A role with no bill rate gets 0 hours. Set its rate in Settings → Rates &amp; roles.</p>
            )}
            {rows.length === 0 && (
              <p className="m-0 mt-3 text-xs text-muted">No roles: this phase&apos;s hours come from the firm&apos;s blended bill rate.</p>
            )}
          </>
        )}
      </DrawerContent>
    </Dialog>
  );
}
