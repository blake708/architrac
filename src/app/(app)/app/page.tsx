import { ComingSoon } from "@/components/shell/coming-soon";
import { requireSession } from "@/lib/auth/session";

// Home. The real dashboard is milestone 1.10.
export default async function AppHomePage() {
  await requireSession();
  return <ComingSoon title="Home" release="1" />;
}
