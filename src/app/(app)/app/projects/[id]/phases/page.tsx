import { notFound } from "next/navigation";
import { ConsultantsCard } from "@/components/projects/detail/consultants-card";
import { PHASE_STATUS } from "@/components/projects/project-bits";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { feeTypeSummary, fmtHours } from "@/lib/calc/project-detail";
import { formatMoney, formatMoneySigned } from "@/lib/format";
import { FEE_TYPE_LABELS } from "@/lib/projects/form";
import { getCompanyChoices, getProjectPage } from "@/server/projects/page-cache";

const th = "cap border-b border-line px-2.5 py-2 text-left text-2xs font-medium whitespace-nowrap text-muted first:pl-[18px] last:pr-[18px]";
const td = "border-b border-line-soft px-2.5 py-2.5 first:pl-[18px] last:pr-[18px]";

// Phases & fees tab (project-detail spec). Financial view only: everyone
// else gets 404. Editing phases arrives in the next pull request (1.5 B).
export default async function ProjectPhases({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getProjectPage(id);
  if (!p || !p.financial || !p.money) notFound();
  const choices = p.canEdit ? (await getCompanyChoices()).consultants : [];

  const rows = p.phases.filter((x) => x.money);
  const total = p.money.feeCents;
  const sum = (f: (m: NonNullable<(typeof rows)[number]["money"]>) => number) => rows.reduce((n, x) => n + f(x.money!), 0);
  const billed = sum((m) => m.billedCents);
  const pct = (fee: number) => (total > 0 ? `${Math.round((fee * 100) / total)}%` : "—");

  return (
    <>
      <section aria-label="Architectural fee by phase" className="rounded-sm border border-line bg-surface">
        <header className="px-[var(--spacing-card)] pt-4 pb-3">
          <h2 className="m-0 text-sm font-semibold">Architectural fee by phase</h2>
          <p className="m-0 mt-0.5 text-xs text-muted">{feeTypeSummary(rows.map((x) => x.money!.feeType))}</p>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] border-collapse text-sm">
            <thead className="bg-surface-2">
              <tr>
                <th scope="col" className={th}>Phase</th>
                <th scope="col" className={th}>Fee type</th>
                <th scope="col" className={cn(th, "text-right")}>Fee</th>
                <th scope="col" className={cn(th, "text-right")}>% of total</th>
                <th scope="col" className={cn(th, "text-right")}>Budget hours</th>
                <th scope="col" className={cn(th, "text-right")}>Hours used / budget</th>
                <th scope="col" className={cn(th, "text-right")}>% complete</th>
                <th scope="col" className={cn(th, "text-right")}>Billed</th>
                <th scope="col" className={cn(th, "text-right")}>Left to bill</th>
                <th scope="col" className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => {
                const m = x.money!;
                const left = m.feeCents - m.billedCents;
                return (
                  <tr key={x.id} data-phase={x.code}>
                    <td className={td}>
                      <span className="num mr-2 text-xs text-ink-3">{x.code}</span>
                      {x.name}
                    </td>
                    <td className={td}>{m.feeType === "nte" ? "NTE" : FEE_TYPE_LABELS[m.feeType]}</td>
                    <td className={cn(td, "num text-right")}>
                      {formatMoney(m.feeCents)}
                      {m.feeType === "hourly" && m.feeCents === 0 && <span className="text-muted"> (estimate)</span>}
                    </td>
                    <td className={cn(td, "num text-right")}>{pct(m.feeCents)}</td>
                    <td className={cn(td, "num text-right")}>{fmtHours(m.budgetHours)}</td>
                    <td className={cn(td, "num text-right", m.usedHours > m.budgetHours && "text-red")}>
                      {fmtHours(m.usedHours)} / {fmtHours(m.budgetHours)} h
                    </td>
                    <td className={cn(td, "num text-right")}>{m.feeType === "fixed" ? `${m.percentCompleteBp / 100}%` : "—"}</td>
                    <td className={cn(td, "num text-right")}>{formatMoney(m.billedCents)}</td>
                    <td className={cn(td, "num text-right", left < 0 && "text-red")}>{formatMoneySigned(left)}</td>
                    <td className={td}>
                      <Badge tone={PHASE_STATUS[x.status].tone} dot>
                        {PHASE_STATUS[x.status].label}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="px-2.5 py-2.5 pl-[18px]" colSpan={2}>Total</td>
                <td className="num px-2.5 py-2.5 text-right" data-testid="phase-fee-total">{formatMoney(total)}</td>
                <td className="num px-2.5 py-2.5 text-right">{total > 0 ? "100%" : "—"}</td>
                <td className="num px-2.5 py-2.5 text-right">{fmtHours(sum((m) => m.budgetHours))}</td>
                <td className="num px-2.5 py-2.5 text-right">
                  {fmtHours(sum((m) => m.usedHours))} / {fmtHours(sum((m) => m.budgetHours))} h
                </td>
                <td />
                <td className="num px-2.5 py-2.5 text-right">{formatMoney(billed)}</td>
                <td className="num px-2.5 py-2.5 text-right">{formatMoneySigned(total - billed)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <ConsultantsCard
        projectId={p.id}
        rows={p.consultants}
        choices={choices}
        canEdit={p.canEdit}
        defaultMarkupBp={p.edit?.defaultMarkupBp ?? 1000}
      />
    </>
  );
}
