"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, controlClasses } from "@/components/ui/field";
import { MoreIcon, PlusIcon } from "@/components/ui/icons";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import {
  type MultiplierStatus,
  type RoleRateFacts,
  avgMultiplierHundredths,
  blendedBillRateCents,
  breakevenHundredths,
  multiplierHundredths,
  multiplierStatus,
  overheadPctFromActuals,
  rolesFlagged,
  trueHourCost,
} from "@/lib/calc/rates";
import { cn } from "@/lib/cn";
import { formatDate, formatMoney, formatMultiplier } from "@/lib/format";
import {
  OVERHEAD_MAX_PCT,
  RATE_MESSAGES,
  type RatesView,
  type RoleView,
  archiveBlockedMessage,
  dollarsToCents,
  earliestDateMessage,
  rateErrors,
} from "@/lib/settings/rates";
import { archiveRole, saveRates } from "@/server/settings/actions";
import { ErrorBanner } from "./error-banner";
import { useSettingsForm } from "./form-state";
import { RoleDialog } from "./role-dialog";

const FORM_ID = "rates-form";

/** What's typed in a role's two inputs (strings, so a field can be empty). */
type Typed = Record<string, { bill: string; cost: string }>;

const typedFrom = (v: RatesView): Typed =>
  Object.fromEntries(
    v.roles.map((r) => [
      r.id,
      { bill: String(r.billCents / 100), cost: String(r.costCents / 100) },
    ]),
  );
const toNum = (s: string) => (s.trim() === "" ? Number.NaN : Number(s));
/** Typed money for the calculator: "$612,000" → 61200000 cents. */
const moneyToCents = (s: string) => {
  const n = Number(s.replace(/[^0-9.]/g, ""));
  return s.trim() === "" || !Number.isFinite(n) ? 0 : Math.round(n * 100);
};

const PILL: Record<MultiplierStatus, string> = {
  flagged: "bg-orange-tint text-orange-strong",
  ok: "bg-green-tint text-green",
  none: "text-muted",
};

/** Settings → Roles & rates (settings-rates-phases spec, section B). */
export function RatesForm({ initial }: { initial: RatesView }) {
  const router = useRouter();
  const toast = useToast();
  const [view, setView] = useState(initial);
  const [typed, setTyped] = useState(() => typedFrom(initial));
  const [overhead, setOverhead] = useState(String(initial.overheadBp / 100));
  const [includeOverhead, setIncludeOverhead] = useState(
    initial.includeOverheadDefault,
  );
  const [expenses, setExpenses] = useState("");
  const [labor, setLabor] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [from, setFrom] = useState(initial.today);
  const [dateError, setDateError] = useState<string | null>(null);
  const [roleDialog, setRoleDialog] = useState<
    { open: false } | { open: true; role: RoleView | null }
  >({ open: false });
  const [pending, startTransition] = useTransition();

  /** Typed numbers for one role, falling back to saved ones while invalid. */
  const live = (r: RoleView) => {
    const t = typed[r.id];
    const bill = r.isBillable ? toNum(t?.bill ?? "") : 0;
    const cost = toNum(t?.cost ?? "");
    return {
      billCents: Number.isFinite(bill) ? dollarsToCents(bill) : r.billCents,
      costCents: Number.isFinite(cost) ? dollarsToCents(cost) : r.costCents,
    };
  };

  const changes = view.roles
    .map((r) => ({ role: r, ...live(r) }))
    .filter((c) => c.billCents !== c.role.billCents || c.costCents !== c.role.costCents);
  const overheadNum = toNum(overhead);
  const overheadBp = Number.isFinite(overheadNum)
    ? Math.round(overheadNum * 100)
    : view.overheadBp;
  const dirty =
    changes.length > 0 ||
    overhead !== String(view.overheadBp / 100) ||
    includeOverhead !== view.includeOverheadDefault ||
    view.roles.some(
      (r) =>
        typed[r.id]?.bill !== String(r.billCents / 100) ||
        typed[r.id]?.cost !== String(r.costCents / 100),
    );
  const markSaved = useSettingsForm(FORM_ID, dirty, pending);

  const facts: RoleRateFacts[] = view.roles.map((r) => ({ ...live(r), people: r.people }));
  const blended = blendedBillRateCents(facts);
  const avg = avgMultiplierHundredths(facts);
  const flagged = rolesFlagged(facts);
  const breakeven = breakevenHundredths(overheadBp);

  const exampleRole =
    view.roles.find((r) => r.name === "Designer") ??
    view.roles.find((r) => r.isBillable);
  const example = exampleRole
    ? trueHourCost(live(exampleRole).costCents, overheadBp)
    : null;

  const calcPct = overheadPctFromActuals(moneyToCents(expenses), moneyToCents(labor));

  function applyView(next: RatesView) {
    setView(next);
    setTyped(typedFrom(next));
    setOverhead(String(next.overheadBp / 100));
    setIncludeOverhead(next.includeOverheadDefault);
    setErrors({});
    setBanner(null);
  }

  /** Check what's typed before saving (the server checks again). */
  function localErrors() {
    const out: Record<string, string> = {};
    for (const r of view.roles) {
      const t = typed[r.id];
      const e = rateErrors(r.isBillable, r.isBillable ? toNum(t.bill) : 0, toNum(t.cost));
      if (e.bill) out[`roles.${r.id}.bill`] = e.bill;
      if (e.cost) out[`roles.${r.id}.cost`] = e.cost;
    }
    if (
      !Number.isInteger(overheadNum) ||
      overheadNum < 0 ||
      overheadNum > OVERHEAD_MAX_PCT
    )
      out.overhead = RATE_MESSAGES.overhead;
    return out;
  }

  /** The earliest allowed "apply from" date, and whose rate sets it. */
  function earliestProblem(date: string): string | null {
    for (const c of changes) {
      const open = c.role.history.find((h) => h.effectiveTo === null);
      if (open && date < open.effectiveFrom)
        return earliestDateMessage(open.effectiveFrom, c.role.name);
    }
    return null;
  }

  function send(effectiveFrom: string | null) {
    startTransition(async () => {
      const result = await saveRates({
        roles: view.roles.map((r) => ({
          id: r.id,
          billDollars: r.isBillable ? toNum(typed[r.id].bill) : 0,
          costDollars: toNum(typed[r.id].cost),
        })),
        effectiveFrom,
        overheadPct: overheadNum,
        includeOverheadDefault: includeOverhead,
      });
      if (!result.ok) {
        const fe = (result.fieldErrors ?? {}) as Record<string, string>;
        if (fe.effectiveFrom) {
          setDateError(fe.effectiveFrom);
          return;
        }
        setConfirmOpen(false);
        setErrors(fe as Record<string, string>);
        setBanner(result.error ?? RATE_MESSAGES.summary);
        return;
      }
      setConfirmOpen(false);
      applyView(result.data.view);
      markSaved();
      router.refresh();
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || pending) return;
    const found = localErrors();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setBanner(RATE_MESSAGES.summary);
      return;
    }
    setBanner(null);
    if (changes.length > 0) {
      setFrom(view.today);
      setDateError(null);
      setConfirmOpen(true);
      return;
    }
    send(null);
  }

  function onArchive(r: RoleView) {
    if (r.people > 0) {
      setBanner(archiveBlockedMessage(r.people, r.name));
      return;
    }
    startTransition(async () => {
      const result = await archiveRole(r.id);
      if (!result.ok) {
        setBanner(result.error ?? RATE_MESSAGES.summary);
        return;
      }
      applyView(result.data.view);
      toast(`${r.name} archived`);
      router.refresh();
    });
  }

  const setRole = (id: string, patch: Partial<{ bill: string; cost: string }>) =>
    setTyped((t) => ({ ...t, [id]: { ...t[id], ...patch } }));

  const errId = (k: string) => `rates-${k.replaceAll(".", "-")}-error`;
  const aria = (k: string) =>
    errors[k] ? ({ "aria-invalid": true, "aria-describedby": errId(k) } as const) : {};

  return (
    <form
      id={FORM_ID}
      onSubmit={onSubmit}
      noValidate
      className="flex max-w-[1040px] flex-col gap-4"
    >
      {banner && <ErrorBanner message={banner} />}

      {/* 1. KPI strip */}
      <section
        aria-label="Rate summary"
        className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] rounded-sm border border-line bg-surface"
      >
        <Kpi
          label="Blended bill rate"
          value={blended === null ? "—" : `${formatMoney(blended)} / h`}
          note="Average across billable staff"
        />
        <Kpi label="Avg. multiplier" value={formatMultiplier(avg)} note="Bill rate ÷ cost rate" />
        <Kpi
          label="Roles flagged"
          value={view.roles.length === 0 ? "—" : String(flagged)}
          note={flagged === 0 ? "All roles at 2.5× or higher" : "Multiplier under 2.5×"}
        />
        <Kpi
          label="Breakeven"
          value={formatMultiplier(breakeven)}
          note={`Covers labor + ${overheadBp / 100}% overhead, no profit`}
        />
      </section>

      {/* 2. Roles & hourly rates */}
      <section
        aria-labelledby="roles-title"
        className="rounded-sm border border-line bg-surface"
      >
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 pt-4 pb-3">
          <h2 id="roles-title" className="m-0 text-sm font-semibold">
            Roles &amp; hourly rates
          </h2>
          <span className="text-[12.5px] text-muted">
            Bill rate is what clients pay on hourly work. Cost rate is salary
            plus burden, used for profit and P&amp;L. Changes apply to time
            logged from the effective date.
          </span>
        </header>
        {view.roles.length === 0 ? (
          <p className="m-0 px-5 py-4 text-sm text-muted">
            No roles yet. Add the roles your firm bills by.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead className="bg-surface-2">
                <tr>
                  {[
                    ["Role", "text-left"],
                    ["People", "text-right"],
                    ["Bill rate / h", "text-right"],
                    ["Cost rate / h", "text-right"],
                    ["Multiplier", "text-right"],
                    ["Effective", "text-left"],
                  ].map(([h, align]) => (
                    <th
                      key={h}
                      scope="col"
                      className={cn(
                        "border-b border-line px-2.5 py-2.5 text-2xs font-medium whitespace-nowrap text-muted first:pl-[18px]",
                        align,
                      )}
                    >
                      {h}
                    </th>
                  ))}
                  <th scope="col" className="w-12 border-b border-line pr-[18px]">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="[&>tr]:border-b [&>tr]:border-line-soft">
                {view.roles.map((r) => {
                  const l = live(r);
                  const m = multiplierHundredths(l.billCents, l.costCents);
                  const status = multiplierStatus(l.billCents, l.costCents);
                  const billKey = `roles.${r.id}.bill`;
                  const costKey = `roles.${r.id}.cost`;
                  return (
                    <tr key={r.id} data-role={r.name}>
                      <td className="py-2.5 pr-2.5 pl-[18px] align-top">
                        <div className="font-medium">{r.name}</div>
                        {r.description && (
                          <div className="text-xs text-muted">{r.description}</div>
                        )}
                      </td>
                      <td className="num px-2.5 py-2.5 text-right align-top text-[12.5px]">
                        {r.people}
                      </td>
                      <td className="px-2.5 py-2 text-right align-top">
                        {r.isBillable ? (
                          <MoneyCell
                            label={`${r.name} bill rate`}
                            value={typed[r.id]?.bill ?? ""}
                            step={5}
                            onChange={(v) => setRole(r.id, { bill: v })}
                            error={errors[billKey]}
                            errorId={errId(billKey)}
                            aria={aria(billKey)}
                          />
                        ) : (
                          <span className="text-[12.5px] text-muted">Not billable</span>
                        )}
                      </td>
                      <td className="px-2.5 py-2 text-right align-top">
                        <MoneyCell
                          label={`${r.name} cost rate`}
                          value={typed[r.id]?.cost ?? ""}
                          step={1}
                          onChange={(v) => setRole(r.id, { cost: v })}
                          error={errors[costKey]}
                          errorId={errId(costKey)}
                          aria={aria(costKey)}
                        />
                      </td>
                      <td className="px-2.5 py-2.5 text-right align-top">
                        <span
                          data-testid="multiplier"
                          data-status={status}
                          className={cn(
                            "num inline-flex h-6 items-center rounded-sm px-2 text-[12.5px] font-semibold",
                            PILL[status],
                          )}
                        >
                          {formatMultiplier(m)}
                        </span>
                      </td>
                      <td className="px-2.5 py-2.5 align-top">
                        {r.effectiveFrom ? (
                          <RateHistory role={r} />
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-[18px] pl-2.5 text-right align-top">
                        <Menu>
                          <MenuTrigger asChild>
                            <button
                              type="button"
                              aria-label={`Actions for ${r.name}`}
                              className="inline-flex size-8 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent text-muted hover:bg-line-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-blue"
                            >
                              <MoreIcon className="size-4" />
                            </button>
                          </MenuTrigger>
                          <MenuContent>
                            <MenuItem onSelect={() => setRoleDialog({ open: true, role: r })}>
                              Edit role
                            </MenuItem>
                            <MenuItem danger onSelect={() => onArchive(r)}>
                              Archive role
                            </MenuItem>
                          </MenuContent>
                        </Menu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <footer className="flex flex-wrap items-center gap-3 px-5 pt-3 pb-4">
          <p className="m-0 flex-[1_1_360px] text-[12.5px] leading-normal text-muted">
            Multipliers under 2.5× are flagged. Most firms target 2.8–3.2× on
            billable roles to cover overhead and profit. People are assigned a
            role on the{" "}
            <Link href="/app/team" className="text-blue underline">
              Team
            </Link>{" "}
            page.
          </p>
          <Button
            icon={<PlusIcon />}
            className="ml-auto h-8"
            onClick={() => setRoleDialog({ open: true, role: null })}
          >
            Add role
          </Button>
        </footer>
      </section>

      {/* 3. Overhead rate */}
      <section
        aria-labelledby="overhead-title"
        className="rounded-sm border border-line bg-surface px-5 pt-[18px] pb-5"
      >
        <header className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="overhead-title" className="m-0 text-sm font-semibold">
            Overhead rate
          </h2>
          <span className="text-[12.5px] text-muted">
            The office costs that aren&apos;t billed to any project: rent,
            software, insurance, admin staff, marketing time. Used to show true
            profit on projects and in Reports.
          </span>
        </header>
        <div className="flex flex-wrap gap-6">
          <div className="flex flex-[1_1_280px] flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="overhead-rate" className="cap text-xs font-medium text-muted">
                Overhead rate
              </label>
              <span className="flex items-center gap-2">
                <input
                  id="overhead-rate"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={OVERHEAD_MAX_PCT}
                  step={1}
                  value={overhead}
                  onChange={(e) => setOverhead(e.target.value)}
                  className={cn(controlClasses, "num h-[var(--height-control)] w-24 text-right")}
                  {...aria("overhead")}
                />
                <span className="text-sm text-ink-3">% of labor cost</span>
              </span>
              {errors.overhead ? (
                <p id={errId("overhead")} className="m-0 text-xs text-red">
                  {errors.overhead}
                </p>
              ) : (
                <p className="m-0 text-xs text-muted">
                  For every $1 spent on project labor, the firm spends{" "}
                  {formatMoney(overheadBp / 100, { cents: true })} on overhead.
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-3">
              <StatBox
                label="Breakeven multiplier"
                value={formatMultiplier(breakeven)}
                note="Bill rate ÷ cost rate below this loses money"
              />
              {exampleRole && example && (
                <StatBox
                  label={`Example · ${exampleRole.name}`}
                  value={`${formatMoney(example.trueCostCents, { cents: true })} / h`}
                  note={`${formatMoney(live(exampleRole).costCents)} labor + ${formatMoney(example.overheadCents, { cents: true })} overhead = true cost of an hour`}
                  testId="designer-example"
                />
              )}
            </div>
            <div className="flex items-start gap-3">
              <Switch
                checked={includeOverhead}
                onCheckedChange={setIncludeOverhead}
                aria-label="Include overhead in project profit by default"
              />
              <div>
                <div className="text-base">Include overhead in project profit by default</div>
                <div className="text-xs text-muted">
                  Project snapshots start with overhead included. People can
                  switch it off for their view.
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-[1_1_320px] flex-col gap-3 rounded-sm border border-dashed border-line-strong p-4">
            <div className="cap text-xs font-semibold text-ink-3">
              Work it out from last year
            </div>
            <div className="flex flex-wrap gap-3">
              <Input
                label="Overhead expenses"
                inputMode="decimal"
                value={expenses}
                onChange={(e) => setExpenses(e.target.value)}
                wrapperClassName="flex-1 min-w-[140px]"
                className="num"
                placeholder="$0"
              />
              <Input
                label="Labor cost on projects"
                inputMode="decimal"
                value={labor}
                onChange={(e) => setLabor(e.target.value)}
                wrapperClassName="flex-1 min-w-[140px]"
                className="num"
                placeholder="$0"
              />
            </div>
            <p className="num m-0 text-sm" data-testid="overhead-calc">
              {formatMoney(moneyToCents(expenses))} ÷ {formatMoney(moneyToCents(labor))} ={" "}
              <strong>{calcPct === null ? "—" : `${calcPct}%`}</strong>
            </p>
            <div>
              <Button
                variant="primary"
                className="h-8"
                disabled={calcPct === null}
                onClick={() => calcPct !== null && setOverhead(String(calcPct))}
              >
                {calcPct === null ? "Use —" : `Use ${calcPct}%`}
              </Button>
            </div>
            <p className="m-0 text-xs leading-normal text-muted">
              Your accountant&apos;s profit &amp; loss statement has both
              numbers. Count only time billed to projects as labor; admin and
              marketing time is overhead. With QuickBooks connected, ArchiTrac
              fills these in.
            </p>
          </div>
        </div>
      </section>

      {/* Save with rate changes: pick the date they start. */}
      <Dialog open={confirmOpen} onOpenChange={(o) => !pending && setConfirmOpen(o)}>
        <DialogContent
          title="Apply new rates from"
          description="Time already approved keeps the rate it was approved at."
          footer={
            <>
              <Button onClick={() => setConfirmOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={pending}
                onClick={() => {
                  const problem = !from ? RATE_MESSAGES.date : earliestProblem(from);
                  setDateError(problem);
                  if (!problem) send(from);
                }}
              >
                {pending ? "Saving…" : "Apply rates"}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
              {changes.map((c) => (
                <li key={c.role.id}>{changeLine(c)}</li>
              ))}
            </ul>
            <Input
              label="Effective date"
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setDateError(null);
              }}
              error={dateError ?? undefined}
              wrapperClassName="w-[200px]"
            />
          </div>
        </DialogContent>
      </Dialog>

      <RoleDialog
        open={roleDialog.open}
        onOpenChange={(o) => !o && setRoleDialog({ open: false })}
        role={roleDialog.open ? roleDialog.role : null}
        today={view.today}
        onSaved={(next, message) => {
          setRoleDialog({ open: false });
          applyView(next);
          toast(message);
          router.refresh();
        }}
      />
    </form>
  );
}

function changeLine(c: { role: RoleView; billCents: number; costCents: number }) {
  const parts: string[] = [];
  if (c.billCents !== c.role.billCents)
    parts.push(`${formatMoney(c.role.billCents)} → ${formatMoney(c.billCents)} bill`);
  if (c.costCents !== c.role.costCents)
    parts.push(`${formatMoney(c.role.costCents)} → ${formatMoney(c.costCents)} cost`);
  return `${c.role.name}: ${parts.join(", ")}`;
}

function Kpi({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="border-r border-line-soft px-5 pt-4 pb-[18px] last:border-r-0">
      <div className="cap text-2xs font-semibold text-ink-3">{label}</div>
      <div className="num mt-1.5 text-[22px] font-medium" data-testid={`kpi-${label}`}>
        {value}
      </div>
      <div className="mt-1 text-[12.5px] text-muted">{note}</div>
    </div>
  );
}

function StatBox({
  label,
  value,
  note,
  testId,
}: {
  label: string;
  value: string;
  note: string;
  testId?: string;
}) {
  return (
    <div className="flex min-w-[180px] flex-1 flex-col gap-1 rounded-sm border border-line-soft bg-surface-2 px-3.5 py-3">
      <div className="cap text-2xs font-semibold text-ink-3">{label}</div>
      <div className="num text-lg font-semibold" data-testid={testId}>
        {value}
      </div>
      <div className="text-xs text-muted">{note}</div>
    </div>
  );
}

function MoneyCell({
  label,
  value,
  step,
  onChange,
  error,
  errorId,
  aria,
}: {
  label: string;
  value: string;
  step: number;
  onChange: (v: string) => void;
  error?: string;
  errorId: string;
  aria: object;
}) {
  return (
    <>
      <span className="inline-flex items-center gap-1">
        <span className="text-muted">$</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          step={step}
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(controlClasses, "num h-8 w-[70px] text-right text-sm")}
          {...aria}
        />
      </span>
      {error && (
        <p id={errorId} className="m-0 mt-1 max-w-[180px] text-left text-[12.5px] text-red">
          {error}
        </p>
      )}
    </>
  );
}

function RateHistory({ role }: { role: RoleView }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${role.name} rate history, current from ${formatDate(role.effectiveFrom!)}`}
          className="num cursor-pointer border-0 bg-transparent p-0 text-[12.5px] text-ink-3 underline decoration-dotted underline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-blue"
        >
          {formatDate(role.effectiveFrom!)}
        </button>
      </PopoverTrigger>
      <PopoverContent label={`${role.name} rate history`} align="end">
        <table className="border-collapse text-[12.5px]">
          <thead>
            <tr className="text-2xs text-muted">
              <th scope="col" className="pr-3 pb-1.5 text-left font-medium">From</th>
              <th scope="col" className="pr-3 pb-1.5 text-left font-medium">To</th>
              <th scope="col" className="pr-3 pb-1.5 text-right font-medium">Bill</th>
              <th scope="col" className="pb-1.5 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody className="num">
            {role.history.map((h) => (
              <tr key={h.effectiveFrom}>
                <td className="py-0.5 pr-3 whitespace-nowrap">{formatDate(h.effectiveFrom)}</td>
                <td className="py-0.5 pr-3 whitespace-nowrap">
                  {h.effectiveTo ? formatDate(h.effectiveTo) : "Current"}
                </td>
                <td className="py-0.5 pr-3 text-right">{formatMoney(h.billCents)}</td>
                <td className="py-0.5 text-right">{formatMoney(h.costCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </PopoverContent>
    </Popover>
  );
}
