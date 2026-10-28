import { notFound } from "next/navigation";

// Any /app address with no page of its own lands here, which shows the
// "Page not found" screen inside the shell (not-found.tsx next door).
// Without this, Next.js would show the plain site-wide 404 instead.
export default function MissingPage() {
  notFound();
}
