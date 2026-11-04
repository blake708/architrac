import { PhasesFormView } from "@/components/settings/phases-form";
import { AccessDenied } from "@/components/shell/access-denied";
import { withFirm } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";
import { todayIn } from "@/lib/format";
import { firmDisplayName } from "@/lib/settings/firm-profile";
import { billRates, templateMixes } from "@/server/projects/roles";
import { loadPhases } from "@/server/settings/phases";

// Settings → Phases & fees (settings-rates-phases spec, section A), plus each
// phase's default role mix (Blake, 2026-11-03).
export default async function SettingsPhasesPage() {
  const { firm, membership } = await requireSession();
  if (!can(membership, "settings.edit")) {
    return <AccessDenied firmName={firmDisplayName(firm)} />;
  }
  const { form, roles, mixes } = await withFirm(firm.id, async (db) => ({
    form: await loadPhases(db),
    roles: (await billRates(db, firm.id, todayIn(firm.timezone))).roles,
    mixes: Object.fromEntries(await templateMixes(db)),
  }));
  return <PhasesFormView initial={form} roleMix={{ roles, mixes }} />;
}
