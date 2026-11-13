import { expect, test } from "@playwright/test";
import { signInAs } from "./support/sign-in";

// Home in the browser (home spec). Read-only, so it uses the shared "E2E
// Alpha Architects" firm and doesn't count its projects. The board, time,
// approval and invoice rules are Vitest tests in src/lib/calc/home.test.ts
// and src/server/home/home.db.test.ts.

test("an owner sees every widget, and All firm is remembered after a reload", async ({ page }) => {
  await signInAs(page, "owner", "/app");
  await expect(page.getByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening), Olive$/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Log time" })).toHaveAttribute("href", "/app/time");
  await expect(page.getByRole("link", { name: "New project" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "My projects" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your time" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Invoices outstanding" })).toBeVisible();

  const scope = page.getByRole("group", { name: "Projects to show" });
  await expect(scope.getByRole("button", { name: "Mine" })).toHaveAttribute("aria-pressed", "true");
  await scope.getByRole("button", { name: "All firm" }).click();
  await expect(scope.getByRole("button", { name: "All firm" })).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await expect(page.getByRole("group", { name: "Projects to show" }).getByRole("button", { name: "All firm" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("staff get no New project, no invoices, no toggle and no billed %", async ({ page }) => {
  await signInAs(page, "alphaStaff", "/app");
  await expect(page.getByRole("heading", { name: "Your time" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "My projects" })).toBeVisible();
  await expect(page.getByRole("link", { name: "New project" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Invoices outstanding" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Waiting on you" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Projects to show" })).toHaveCount(0);
  expect(await page.content()).not.toMatch(/billed|billedPct/i);
});
