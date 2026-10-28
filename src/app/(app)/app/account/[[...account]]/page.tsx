import { UserProfile } from "@clerk/nextjs";
import { PageHeader } from "@/components/ui/page-header";
import { requireSession } from "@/lib/auth/session";

// "Your account" from the avatar menu: Clerk's own profile screen (name,
// email, password, photo). The [[...account]] folder lets Clerk use
// sub-pages like /app/account/security.
export default async function AccountPage() {
  await requireSession();
  return (
    <>
      <PageHeader title="Your account" />
      <main className="px-4 py-8 md:px-page-x">
        <UserProfile path="/app/account" />
      </main>
    </>
  );
}
