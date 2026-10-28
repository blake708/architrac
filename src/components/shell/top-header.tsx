import { ROLE_LABELS, can } from "@/lib/auth/permissions";
import type { FirmSession } from "@/lib/auth/session";
import { AccountMenu } from "./account-menu";
import { FirmSwitcher } from "./firm-switcher";
import { CurrentPageTitle, SettingsGear } from "./header-links";
import { MobileMenuButton } from "./shell-frame";

/**
 * The dark bar across the top (app-shell spec, layout section 3).
 * Runs on the server, so the Settings gear is left out of the page entirely
 * for people who can't use it.
 */
export function TopHeader({ session }: { session: FirmSession }) {
  const { firm, user, membership } = session;
  const name = `${user.firstName} ${user.lastName}`.trim() || user.email;

  return (
    <header className="flex flex-wrap items-center gap-4 bg-chrome px-4 py-2.5 text-chrome-text md:px-page-x">
      <MobileMenuButton />
      {/* Firm display names arrive in 0.6 (settings-firm spec). */}
      <FirmSwitcher name={firm.name} logoUrl={firm.logoUrl} />
      <CurrentPageTitle />
      <div className="ml-auto flex flex-wrap items-center gap-3">
        {/* The search box (FEATURES.globalSearch) and notifications bell
            (FEATURES.notifications) go here. Both are off in Release 0, so
            nothing is rendered for them. */}
        {can(membership, "settings.view") && <SettingsGear />}
        <AccountMenu
          name={name}
          email={user.email}
          roleLabel={ROLE_LABELS[membership.appRole]}
          initials={user.initials}
          avatarUrl={user.avatarUrl}
        />
      </div>
    </header>
  );
}
