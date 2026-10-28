import { ComingSoon } from "@/components/shell/coming-soon";
import { requireSession } from "@/lib/auth/session";

export default async function ReportsPage() {
  await requireSession();
  return <ComingSoon title="Reports" release="2" />;
}
