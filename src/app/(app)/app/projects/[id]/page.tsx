import Link from "next/link";
import { notFound } from "next/navigation";
import { HoursTable } from "@/components/projects/detail/hours-table";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { KpiTile } from "@/components/ui/kpi-tile";
import {
  activityText,
  costPerSfDollars,
  feeTypeSummary,
  fmtHours,
  hoursNote,
  pctOfConstruction,
} from "@/lib/calc/project-detail";
import { formatDate, formatMoney, formatMoneyShort } from "@/lib/format";
import { getProjectPage } from "@/server/projects/page-cache";

// Overview tab (project-detail spec, Data shown → Overview). Money tiles and
// the hours table are only in the financial view; the loader leaves the
// numbers out for everyone else.
export default async function ProjectOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getProjectPage(id);
  if (!p) notFound();

  const phases = p.phases.filter((x) => x.money);
  const used = phases.reduce((n, x) => n + x.money!.usedHours, 0);
  const pctC = p.money ? pctOfConstruction(p.money.feeCents, p.constructionCostCents) : null;
  const perSf = costPerSfDollars(p.constructionCostCents, p.squareFeet);
  const dash = <span className="text-muted">—</span>;
  const address = [
    p.address.addressLine1,
    p.address.addressLine2,
    [p.address.city, [p.address.state, p.address.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", "),
  ].filter(Boolean);

  return (
    <>
      <section aria-label="Project summary" className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
        {p.money && (
          <>
            <KpiTile
              label="Architectural fee"
              value={formatMoney(p.money.feeCents)}
              note={[feeTypeSummary(phases.map((x) => x.money!.feeType), true), pctC && `${pctC} of construction`].filter(Boolean).join(" · ")}
            />
            <KpiTile
              label="Billed"
              value={formatMoney(p.money.billedCents)}
              note={`${p.money.billedPct ?? 0}% of fee · ${p.money.outstandingCents > 0 ? `${formatMoney(p.money.outstandingCents)} outstanding` : "nothing outstanding"}`}
            />
            <KpiTile
              label="Hours"
              value={`${fmtHours(used)} h`}
              note={hoursNote(phases.map((x) => ({ code: x.code, sortOrder: x.sortOrder, budgetHours: x.money!.budgetHours, usedHours: x.money!.usedHours })))}
            />
          </>
        )}
        <KpiTile
          label="Construction estimate"
          value={formatMoneyShort(p.constructionCostCents)}
          note={perSf !== null && p.squareFeet ? `$${perSf.toLocaleString("en-US")} / SF · ${p.squareFeet.toLocaleString("en-US")} SF` : undefined}
        />
      </section>

      {p.financial && <HoursTable projectId={p.id} phases={p.phases} />}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[2fr_1fr]">
        <Card title="Project information">
          <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            {(
              [
                ["Client", p.client.name],
                ["Client contact", p.clientContact ? `${p.clientContact.name}${p.clientContact.title ? ` · ${p.clientContact.title}` : ""}` : null],
                ["Address", address.length ? address.map((l) => <div key={l}>{l}</div>) : null],
                ["Building", p.squareFeet ? `${p.squareFeet.toLocaleString("en-US")} SF` : null],
                ["Start date", p.startDate ? formatDate(p.startDate) : null],
                ["Target end", p.targetEndDate ? formatDate(p.targetEndDate) : null],
                ["Principal in charge", p.principal?.name],
                ["Project manager", p.pm?.name],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt className="cap text-2xs font-medium text-muted">{label}</dt>
                <dd className="m-0 mt-0.5">{value ?? dash}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card
          title="Team"
          actions={
            <Link href={`/app/projects/${p.id}/team`} className="text-sm text-blue underline">
              View all
            </Link>
          }
        >
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-sm">
            {p.team.map((m) => (
              <li key={m.id} className="flex items-center gap-2.5">
                <Avatar name={m.name} initials={m.initials} size="sm" />
                <span className="min-w-0">
                  <span className="block font-medium">{m.name}</span>
                  <span className="block text-xs text-muted">{m.title ?? m.projectRole}</span>
                </span>
                {m.hours !== undefined && <span className="num ml-auto text-xs text-muted">{fmtHours(m.hours)} h logged</span>}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Recent activity">
        {p.activity.length === 0 ? (
          <p className="m-0 text-sm text-muted">Nothing yet.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm" data-testid="activity">
            {p.activity.map((a) => (
              <li key={a.id} className="flex gap-3">
                <span className="num w-[52px] shrink-0 text-xs text-muted">{formatDate(a.at.slice(0, 10)).replace(/, \d{4}$/, "")}</span>
                <span>
                  <strong>{a.actor}</strong> {activityText(a)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
