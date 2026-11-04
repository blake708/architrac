import { BenchmarksCard } from "@/components/settings/benchmarks-card";
import { PhasesFormView } from "@/components/settings/phases-form";
import { AccessDenied } from "@/components/shell/access-denied";
import { projects } from "@/db/schema";
import { withFirm } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";
import { todayIn } from "@/lib/format";
import { STANDARD_TYPES } from "@/lib/projects/form";
import { firmDisplayName } from "@/lib/settings/firm-profile";
import { billRates, templateMixes } from "@/server/projects/roles";
import { loadBenchmarks } from "@/server/settings/benchmarks";
import { loadPhases } from "@/server/settings/phases";

// Settings → Phases & fees (settings-rates-phases spec, section A), plus each
// phase's default role mix (Blake, 2026-11-03) and project type ranges for
// New project's estimate (Blake, 2026-11-04).
export default async function SettingsPhasesPage() {
  const { firm, membership } = await requireSession();
  if (!can(membership, "settings.edit")) {
    return <AccessDenied firmName={firmDisplayName(firm)} />;
  }
  const { form, roles, mixes, ranges, types } = await withFirm(firm.id, async (db) => ({
    form: await loadPhases(db),
    roles: (await billRates(db, firm.id, todayIn(firm.timezone))).roles,
    mixes: Object.fromEntries(await templateMixes(db)),
    ranges: await loadBenchmarks(db),
    types: (await db.selectDistinct({ t: projects.projectType }).from(projects)).map((r) => r.t),
  }));
  return (
    <div className="flex flex-col gap-6">
      <PhasesFormView initial={form} roleMix={{ roles, mixes }} />
      <BenchmarksCard initial={ranges} types={[...new Set([...STANDARD_TYPES, ...types])].sort((a, b) => a.localeCompare(b))} />
    </div>
  );
}
