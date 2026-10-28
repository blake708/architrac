import { clerkMiddleware } from "@clerk/nextjs/server";

// Runs before every request (Next.js 16 calls this file "proxy"; it used to be
// "middleware"). It lets Clerk read the session so `auth()` works in pages,
// layouts and server actions.
//
// It does NOT decide who may see what, and has no list of protected paths
// (Clerk deprecated createRouteMatcher). Every page, layout and server action
// checks the session and role itself (src/lib/auth), and signed-out visitors
// are sent to sign-in from there.
//
// Why it still calls auth(): that makes Clerk bring the session up to date
// on this request. Without it, right after someone switches firms (or creates
// one), the next page still sees the old firm (or none). The firm-switcher and
// create-firm browser tests catch this.
export default clerkMiddleware(async (auth) => {
  await auth();
});

export const config = {
  matcher: [
    // Everything except Next.js internals and static files...
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // ...and always API routes.
    "/(api|trpc)(.*)",
  ],
};
