import { SignOutButton } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";

export const metadata = { title: "Access turned off · ArchiTrac" };

/** Shown when the person's membership in the selected firm is switched off. */
export default async function AccessOffPage() {
  const result = await getSession();
  if (result.status !== "deactivated") redirect("/app");

  return (
    <section className="w-full rounded-sm border border-line bg-surface p-8">
      <h1 className="text-xl font-medium">
        Your access to {result.firm.name} has been turned off
      </h1>
      <p className="mt-2 text-sm text-ink-3">
        Ask an owner or admin if this is a mistake.
      </p>
      <div className="mt-6">
        <SignOutButton redirectUrl="/sign-in">
          <button
            type="button"
            className="h-[var(--height-control)] rounded-sm border border-line-input bg-surface px-4 text-sm font-semibold text-ink"
          >
            Sign out
          </button>
        </SignOutButton>
      </div>
    </section>
  );
}
