import { ComingSoon } from "@/components/shell/coming-soon";
import { requireSession } from "@/lib/auth/session";

export default async function ProjectsPage() {
  await requireSession();
  return <ComingSoon title="Projects" release="1" />;
}
