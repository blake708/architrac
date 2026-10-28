import { redirect } from "next/navigation";

// The gear links here; the first settings section is Firm profile.
export default function SettingsPage() {
  redirect("/app/settings/firm");
}
