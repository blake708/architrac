"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DrawerContent } from "@/components/ui/dialog";
import { PlusIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { mixHours, mixTotalBp } from "@/lib/calc/phase-edit";
import { fmtHours } from "@/lib/calc/project-detail";
import { formatMoney } from "@/lib/format";

// Role mixes (Blake, 2026-11-03): each role's share of the phase fee, its
// bill rate, dollars and hours (share × fee ÷ rate, to the quarter hour).
// Shares add up to exactly 100%, or there's no mix (the phase then uses the
// blended bill rate). Bill rates only; never cost.

export type MixRow = { firmRoleId: string; shareBp: number };
export type RoleOption = { id: string; name: string; billCents: number };
/** A mix row while it's being edited (keeps what's typed in the % box). */
export type MixDraft = MixRow & { text: string };

const pctText = (bp: number) => String(bp / 100);
function parsePct(raw: string): number | null {
  const v = raw.trim().replace(/%$/, "");
  if (v === "") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  const bp = Math.round(Number(v) * 100);
  return bp <= 10_000 ? bp : null;
}

export const toDrafts = (mix: MixRow[]): MixDraft[] => mix.map((m) => ({ ...m, text: pctText(m.shareBp) }));
export const fromDrafts = (rows: MixDraft[]): MixRow[] => rows.map(({ firmRoleId, shareBp }) => ({ firmRoleId, shareBp }));
/** Ready to save: no bad boxes, every row has a role, and 100% (or empty). */
export const mixReady = (rows: MixDraft[]) =>
  !rows.some((r) => parsePct(r.text) === null || !r.firmRoleId) && (rows.length === 0 || mixTotalBp(rows) === 10_000);

/** The editable roles table (used inside the phase panel and the roles panel). */
export function RoleMixEditor({
  rows,
  onChange,
  feeCents,
  roles,
}: {
  rows: MixDraft[];
  onChange: (rows: MixDraft[]) => void;
  /** The phase fee; null in Settings, where there's no fee yet. */
  feeCents: number | null;
  roles: RoleOption[];
}) {
  const rateOf = (id: string) => roles.find((r) => r.id === id)?.billCents ?? 0;
  const total = mixTotalBp(rows);
  const calc = feeCents === null ? null : mixHours(feeCents, rows.map((r) => ({ roleId: r.firmRoleId, shareBp: r.shareBp, rateCents: rateOf(r.firmRoleId) })));
  const unused = roles.filter((r) => !rows.some((x) => x.firmRoleId === r.id));
  const set = (i: number, p: Partial<MixDraft>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));

  if (roles.length === 0)
    return <p className="m-0 text-sm text-muted">Add roles and rates in Settings → Rates &amp; roles first.</p>;
  return (
    <>
      <table className="w-full border-collapse text-sm" aria-label="Role mix">
        <thead>
          <tr className="cap text-left text-2xs text-muted">
            <th scope="col" className="border-b border-line py-2 font-medium">Role</th>
            <th scope="col" className="border-b border-line py-2 text-right font-medium">Share</th>
            <th scope="col" className="border-b border-line py-2 text-right font-medium">Rate</th>
            {calc && <th scope="col" className="border-b border-line py-2 text-right font-medium">Fee</th>}
            {calc && <th scope="col" className="border-b border-line py-2 text-right font-medium">Hours</th>}
            <th scope="col" className="border-b border-line py-2"><span className="sr-only">Remove</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const role = roles.find((x) => x.id === r.firmRoleId);
            const res = calc?.roles[i];
            return (
              <tr key={i} data-role={role?.name ?? ""}>
                <td className="border-b border-line-soft py-1.5 pr-2">
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
                </td>
                <td className="border-b border-line-soft py-1.5 text-right">
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
                </td>
                <td className={cn("num border-b border-line-soft py-1.5 text-right", role && role.billCents <= 0 && "text-orange-strong")}>
                  {role ? (role.billCents > 0 ? `${formatMoney(role.billCents)}/h` : "No rate") : "—"}
                </td>
                {calc && <td className="num border-b border-line-soft py-1.5 text-right">{formatMoney(res?.cents ?? 0)}</td>}
                {calc && <td className="num border-b border-line-soft py-1.5 text-right">{fmtHours(res?.hours ?? 0)}</td>}
                <td className="border-b border-line-soft py-1.5 text-right">
                  <Button variant="ghost" aria-label={`Remove ${role?.name ?? "role"}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                    Remove
                  </Button>
                </td>
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
            <td />
          </tr>
        </tfoot>
      </table>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          icon={<PlusIcon />}
          disabled={unused.length === 0}
          onClick={() => {
            const rest = Math.max(0, 10_000 - total);
            onChange([...rows, { firmRoleId: unused[0].id, shareBp: rest, text: pctText(rest) }]);
          }}
        >
          Add role
        </Button>
        {rows.length > 0 && total < 10_000 && (
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
      {rows.length > 0 && total !== 10_000 && (
        <p role="alert" className="m-0 mt-3 text-sm text-red">
          Shares add up to {pctText(total)}%; they need to make 100%
        </p>
      )}
      {calc?.roles.some((r) => r.noRate) && (
        <p className="m-0 mt-3 text-xs text-orange-strong">A role with no bill rate gets 0 hours. Set its rate in Settings → Rates &amp; roles.</p>
      )}
      {rows.length === 0 && <p className="m-0 mt-3 text-xs text-muted">No roles: hours come from the firm&apos;s blended bill rate.</p>}
    </>
  );
}

/** A phase's roles as a small read-only table (under each phase row). */
export function RoleMixTable({
  roles,
  label,
}: {
  roles: { roleName: string; shareBp: number; rateCents: number; cents: number; hours: number }[];
  label: string;
}) {
  return (
    <table className="w-auto border-collapse text-xs [&_td]:pr-6 [&_th]:pr-6" aria-label={label}>
      <thead>
        <tr className="cap text-left text-2xs text-muted">
          <th scope="col" className="py-1 font-medium">Role</th>
          <th scope="col" className="py-1 text-right font-medium">Share</th>
          <th scope="col" className="py-1 text-right font-medium">Rate</th>
          <th scope="col" className="py-1 text-right font-medium">Fee</th>
          <th scope="col" className="py-1 text-right font-medium">Hours</th>
        </tr>
      </thead>
      <tbody>
        {roles.map((r) => (
          <tr key={r.roleName}>
            <td className="py-0.5">{r.roleName}</td>
            <td className="num py-0.5 text-right">{pctText(r.shareBp)}%</td>
            <td className={cn("num py-0.5 text-right", r.rateCents <= 0 && "text-orange-strong")}>
              {r.rateCents > 0 ? `${formatMoney(r.rateCents)}/h` : "No rate"}
            </td>
            <td className="num py-0.5 text-right">{formatMoney(r.cents)}</td>
            <td className="num py-0.5 text-right">{fmtHours(r.hours)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The roles editor in its own side panel (Settings and New project). */
export function RoleMixPanel({
  title,
  feeCents,
  mix,
  roles,
  onSave,
  onClose,
}: {
  title: string;
  feeCents: number | null;
  mix: MixRow[];
  roles: RoleOption[];
  onSave: (mix: MixRow[]) => void | Promise<void>;
  onClose: () => void;
}) {
  const [rows, setRows] = useState(() => toDrafts(mix));
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DrawerContent
        title={title}
        description={feeCents === null ? "Default role mix for new projects" : `Fee ${formatMoney(feeCents)} · hours = share of fee ÷ role's bill rate`}
        className="max-w-[560px]!"
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!mixReady(rows) || saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await onSave(fromDrafts(rows));
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? "Saving…" : "Save roles"}
            </Button>
          </>
        }
      >
        <RoleMixEditor rows={rows} onChange={setRows} feeCents={feeCents} roles={roles} />
      </DrawerContent>
    </Dialog>
  );
}
