import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";

type ModuleOffProps = {
  /** "Build" */
  module: string;
  firmName: string;
  /** Owner/admin: show the button to Settings. Decided on the server. */
  canTurnOn: boolean;
};

/** Shown on a module's page when the firm hasn't switched it on (rule 4). */
export function ModuleOff({ module, firmName, canTurnOn }: ModuleOffProps) {
  return (
    <PageHeader
      title={`${module} is turned off`}
      description={
        <>
          {module} isn&apos;t turned on for {firmName}.{" "}
          {!canTurnOn && "Ask an owner or admin to turn it on."}
        </>
      }
      actions={
        canTurnOn && (
          <Link
            href="/app/settings/modules"
            className={buttonClasses("primary")}
          >
            Turn on in Settings
          </Link>
        )
      }
    />
  );
}
