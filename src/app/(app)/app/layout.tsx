import { cookies } from "next/headers";
import { ShellFrame } from "@/components/shell/shell-frame";
import { TopHeader } from "@/components/shell/top-header";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";
import { railEntries } from "@/lib/shell/nav";
import { RAIL_COOKIE, isRailCollapsed } from "@/lib/shell/rail-cookie";

// Every /app page runs inside this layout: the menu rail, the top header and
// the page. It makes sure the person is signed in, has a firm selected and an
// active membership; otherwise they're sent to sign-in or onboarding.
//
// Layouts don't re-run on every navigation, so pages and server actions call
// requireSession() themselves too. This is not the only check.
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await requireSession();
  const collapsed = isRailCollapsed((await cookies()).get(RAIL_COOKIE)?.value);
  const entries = railEntries(session.settings.modulesEnabled, {
    showOffModules: can(session.membership, "modules.manage"),
  });

  return (
    <ShellFrame
      entries={entries}
      initialCollapsed={collapsed}
      header={<TopHeader session={session} />}
    >
      {children}
    </ShellFrame>
  );
}
