import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { CreateFirmForm } from "./create-firm-form";

export const metadata = { title: "Create your firm · ArchiTrac" };

export default async function CreateFirmPage() {
  const result = await getSession();
  if (result.status === "signed_out") redirect("/sign-in");
  if (result.status === "ok") redirect("/app");
  if (result.status === "choose_firm") redirect("/onboarding/choose-firm");
  if (result.status === "deactivated") redirect("/onboarding/access-off");

  return (
    <section className="w-full rounded-sm border border-line bg-surface p-8">
      <h1 className="text-xl font-medium">Create your firm</h1>
      <p className="mt-1 text-sm text-ink-3">
        You&apos;ll be its owner. You can invite your team and turn on modules
        later in Settings.
      </p>
      <CreateFirmForm />
    </section>
  );
}
