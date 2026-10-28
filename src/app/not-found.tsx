import Link from "next/link";
import { LogoMark } from "@/components/shell/logo-mark";

// 404 for addresses outside /app (inside /app the shell has its own).
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-canvas px-4 text-ink">
      <LogoMark />
      <h1 className="m-0 text-xl font-medium">Page not found</h1>
      <Link href="/" className="text-blue underline">
        Go to the home page
      </Link>
    </main>
  );
}
