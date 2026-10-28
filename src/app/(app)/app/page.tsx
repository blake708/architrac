import { SignOutButton } from "@clerk/nextjs";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/session";

// Temporary home page for milestone 0.3: proves sign-in and firm setup work.
// Replaced by the real Home screen (with the app shell) in later milestones.
export default async function AppHomePage() {
  const { firm, user, membership } = await requireSession();

  return (
    <main className="px-page-x py-12">
      <p className="num text-xs text-ink-3">Release 0 · auth check</p>
      <h1 className="mt-2 text-3xl font-medium">{firm.name}</h1>
      <p className="mt-2 text-base text-ink-3">
        Signed in as {user.firstName} {user.lastName} ({user.email}) ·{" "}
        {ROLE_LABELS[membership.appRole]}
      </p>
      <div className="mt-6">
        <SignOutButton redirectUrl="/sign-in">
          <button
            type="button"
            className="h-[var(--height-control)] rounded-sm border border-line-input bg-surface px-4 text-sm font-semibold"
          >
            Sign out
          </button>
        </SignOutButton>
      </div>
    </main>
  );
}
