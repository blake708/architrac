import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { ChooseFirm } from "./choose-firm";

/**
 * The person belongs to a firm, but none is selected in this browser
 * (app-shell spec, rule 2). Pick one for them and continue to the app.
 */
export default async function ChooseFirmPage() {
  const result = await getSession();
  if (result.status === "signed_out") redirect("/sign-in");
  if (result.status === "no_firm") redirect("/onboarding/create-firm");
  if (result.status === "ok") redirect("/app");
  if (result.status === "deactivated") redirect("/onboarding/access-off");

  return <ChooseFirm />;
}
