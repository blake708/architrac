import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Runs before every request (Next.js 16 calls this file "proxy"; it used to be
// "middleware"). Signed-out visitors to the app or onboarding pages are sent
// to sign-in, with the page they wanted saved in redirect_url.
//
// This is only the first gate. Every page and server action still checks the
// session and role on the server (src/lib/auth).

const isProtected = createRouteMatcher(["/app(.*)", "/onboarding(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isProtected(req)) return;

  const { userId } = await auth();
  if (!userId) {
    const signIn = new URL("/sign-in", req.url);
    signIn.searchParams.set(
      "redirect_url",
      req.nextUrl.pathname + req.nextUrl.search,
    );
    return NextResponse.redirect(signIn);
  }
});

export const config = {
  matcher: [
    // Everything except Next.js internals and static files...
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // ...and always API routes.
    "/(api|trpc)(.*)",
  ],
};
