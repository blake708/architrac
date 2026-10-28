import { type APIResponse, expect, test } from "@playwright/test";

// App-shell spec acceptance test 1: signed-out visitors are sent to sign-in,
// remembering where they were going.

/** A redirect to sign-in whose return link (redirect_url) points at `path`. */
function expectSignInRedirect(response: APIResponse, path: string) {
  expect([302, 307]).toContain(response.status());
  const location = new URL(response.headers()["location"], "http://localhost");
  expect(location.pathname).toBe("/sign-in");
  const back = location.searchParams.get("redirect_url");
  expect(back, "sign-in link should say where to come back to").not.toBeNull();
  expect(new URL(back ?? "", "http://localhost").pathname).toBe(path);
}

test("signed out: /app/projects redirects to sign-in with redirect_url", async ({
  page,
}) => {
  const response = await page.request.get("/app/projects", {
    maxRedirects: 0,
  });
  expectSignInRedirect(response, "/app/projects");
});

test("signed out: onboarding pages also redirect to sign-in", async ({
  page,
}) => {
  const response = await page.request.get("/onboarding/create-firm", {
    maxRedirects: 0,
  });
  expectSignInRedirect(response, "/onboarding/create-firm");
});

test("signed out: the sign-in page shows Clerk's sign-in form", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await expect(page.getByText("ARCHITRAC")).toBeVisible();
  await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible({
    timeout: 15_000,
  });
});
