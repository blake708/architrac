import { ComingSoon } from "@/components/shell/coming-soon";
import { requireSession } from "@/lib/auth/session";

export default async function TeamPage() {
  await requireSession();
  return <ComingSoon title="Team" release="1" />;
}
