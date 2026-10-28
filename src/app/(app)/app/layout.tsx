import { requireSession } from "@/lib/auth/session";

// Every /app page runs inside this layout. It makes sure the person is signed
// in, has a firm selected and an active membership; otherwise they're sent to
// sign-in or onboarding. The menu rail and header arrive in milestone 0.5.
//
// Layouts don't re-run on every navigation, so pages and server actions call
// requireSession() themselves too. This is not the only check.
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireSession();
  return <div className="min-h-screen bg-canvas text-ink">{children}</div>;
}
