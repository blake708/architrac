import { ComingSoon } from "@/components/shell/coming-soon";
import { requireSession } from "@/lib/auth/session";

export default async function TimePage() {
  await requireSession();
  return <ComingSoon title="Time" release="1" />;
}
