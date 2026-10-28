import { ComingSoon } from "@/components/shell/coming-soon";
import { requireSession } from "@/lib/auth/session";

export default async function ContactsPage() {
  await requireSession();
  return <ComingSoon title="Contacts" release="1" />;
}
