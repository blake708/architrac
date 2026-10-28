import { clerk } from "@clerk/testing/playwright";
import { type Page, expect } from "@playwright/test";
import { FIRMS, type FirmKey, PEOPLE, type PersonKey } from "./people";

/**
 * Make `firm` the active firm using the header's firm switcher. Needed for
 * people in two firms: Clerk reopens the firm they used last, so which one a
 * new sign-in starts in depends on what other tests did.
 */
export async function useFirm(page: Page, firm: FirmKey) {
  const name = FIRMS[firm].name;
  const current = page.getByTestId("firm-name");
  if ((await current.textContent()) === name) return;
  await page
    .getByRole("button", { name: (await current.textContent()) ?? "" })
    .click();
  await page
    .getByRole("menu", { name: "Switch firm" })
    .getByRole("menuitemradio", { name })
    .click();
  await expect(current).toHaveText(name, { timeout: 20_000 });
}

/** Wait until the shell has loaded for a firm (the header's firm button shows). */
export async function expectShell(page: Page) {
  await expect(page.getByTestId("firm-name")).toBeVisible({ timeout: 30_000 });
}

/**
 * Sign in as one of the test people with Clerk's testing kit (no password or
 * email code) and open /app. With no firm selected yet, the app picks the
 * person's first firm by name and lands on Home, so for people with an active
 * firm this waits for the shell before opening `path`.
 */
export async function signInAs(page: Page, who: PersonKey, path?: string) {
  await page.goto("/sign-in");
  await clerk.signIn({ page, emailAddress: PEOPLE[who].email });
  await page.goto("/app");

  const hasActiveFirm = PEOPLE[who].memberships.some(
    (m) => !("active" in m) || m.active !== false,
  );
  if (!hasActiveFirm) return;

  await expectShell(page);
  if (path && path !== "/app") await page.goto(path);
}
