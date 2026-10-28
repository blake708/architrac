import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";
import { type RailModuleKey, isModuleOn, moduleItem } from "@/lib/shell/nav";
import { ComingSoon } from "./coming-soon";
import { ModuleOff } from "./module-off";

/**
 * A module's page in Release 0 (rule 4, the module route guard): "turned off"
 * if the firm hasn't switched it on, otherwise a placeholder until it's built.
 * Real module pages will start with the same isModuleOn check.
 */
export async function ModulePage({ moduleKey }: { moduleKey: RailModuleKey }) {
  const { firm, settings, membership } = await requireSession();
  const item = moduleItem(moduleKey);

  if (!isModuleOn(settings, moduleKey)) {
    return (
      <ModuleOff
        module={item.label}
        firmName={firm.name}
        canTurnOn={can(membership, "modules.manage")}
      />
    );
  }
  return <ComingSoon title={item.label} release={String(item.release)} />;
}
