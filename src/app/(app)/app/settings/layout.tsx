import { SettingsFormProvider } from "@/components/settings/form-state";
import { SettingsHeader } from "@/components/settings/settings-header";
import { SettingsNav } from "@/components/settings/settings-nav";
import { AccessDenied } from "@/components/shell/access-denied";
import { ToastProvider } from "@/components/ui/toast";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";
import { firmDisplayName } from "@/lib/settings/firm-profile";

// The Settings frame (settings-firm spec, Layout §1–2): header band, section
// menu, and Main. Owners and admins only (business rule 1). Each page and
// server action checks again, because layouts don't re-run on every click.
export default async function SettingsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { firm, membership } = await requireSession();
  if (!can(membership, "settings.view")) {
    return <AccessDenied firmName={firmDisplayName(firm)} />;
  }

  return (
    <SettingsFormProvider>
      <ToastProvider>
        <SettingsHeader />
        <div className="flex flex-wrap items-start">
          <SettingsNav />
          <main className="flex min-w-0 flex-[999_1_640px] flex-col gap-5 px-4 pt-7 pb-8 md:px-page-x">
            {children}
          </main>
        </div>
      </ToastProvider>
    </SettingsFormProvider>
  );
}
