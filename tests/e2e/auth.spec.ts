import { expect, test } from "@playwright/test";

// App-shell spec acceptance test 1: signed-out visitors are sent to sign-in,
// remembering where they were going.

test("signed out: /app/projects redirects to sign-in with redirect_url", async ({
  page,
}) => {
  const response = await page.request.get("/app/projects", {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(307);
  expect(response.headers()["location"]).toMatch(
    /\/sign-in\?redirect_url=%2Fapp%2Fprojects$/,
  );
});

test("signed out: onboarding pages also redirect to sign-in", async ({
  page,
}) => {
  const response = await page.request.get("/onboarding/create-firm", {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(307);
  expect(response.headers()["location"]).toContain(
    "/sign-in?redirect_url=%2Fonboarding%2Fcreate-firm",
  );
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
