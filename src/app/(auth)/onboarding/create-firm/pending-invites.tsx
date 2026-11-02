"use client";

import { useOrganizationList } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * "Join {firm}" for someone signed in with a pending invitation but no invite
 * link (team spec, open question 9; roadmap 1.3). Accepting joins the Clerk
 * organization; ArchiTrac then matches the invitation by email and gives
 * them the invited access level and profile.
 */
export function PendingInvites() {
  const router = useRouter();
  const { isLoaded, setActive, userInvitations } = useOrganizationList({
    userInvitations: { status: "pending", infinite: true },
  });
  const [joining, setJoining] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isLoaded || userInvitations.isLoading) return null;
  const invites = userInvitations.data ?? [];
  if (invites.length === 0) return null;

  return (
    <section
      aria-label="Your invitations"
      className="mb-6 flex w-full flex-col gap-3 rounded-sm border border-line bg-surface p-6"
    >
      <h2 className="m-0 text-sm font-semibold">You&apos;ve been invited</h2>
      {invites.map((inv) => (
        <div key={inv.id} className="flex flex-wrap items-center gap-3">
          <span className="min-w-0 flex-1 text-base">
            {inv.publicOrganizationData.name}
          </span>
          <button
            type="button"
            disabled={joining !== null}
            onClick={async () => {
              setJoining(inv.id);
              setError(null);
              try {
                await inv.accept();
                await setActive({ organization: inv.publicOrganizationData.id });
                router.push("/app");
                router.refresh();
              } catch {
                setError("Couldn't join. Ask them to send the invite again.");
                setJoining(null);
              }
            }}
            className="h-[var(--height-control)] cursor-pointer rounded-sm border-0 bg-ink px-4 text-base font-semibold text-white hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {joining === inv.id
              ? "Joining…"
              : `Join ${inv.publicOrganizationData.name}`}
          </button>
        </div>
      ))}
      {error && <p className="m-0 text-xs text-red">{error}</p>}
      <p className="m-0 text-xs text-muted">Or create a firm of your own below.</p>
    </section>
  );
}
