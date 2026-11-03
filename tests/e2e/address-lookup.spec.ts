import { expect, test } from "@playwright/test";
import { signInAs } from "./support/sign-in";

// Real Google address lookup (ADR 0007). Runs only where GOOGLE_MAPS_API_KEY
// is set (your machine); CI has no key and skips it. Nothing is saved.

test.skip(!process.env.GOOGLE_MAPS_API_KEY, "No GOOGLE_MAPS_API_KEY");

test("New project: picking a suggestion fills the address", async ({ page }) => {
  await signInAs(page, "etaOwner", "/app/projects/new");
  const street = page.getByRole("combobox", { name: "Street address" });
  await street.fill("40 Calhoun St Charl");
  const list = page.getByRole("listbox", { name: "Address suggestions" });
  await expect(list.getByRole("option").first()).toBeVisible({ timeout: 10_000 });
  await expect(list).toContainText("Powered by Google");
  await list.getByRole("option", { name: /40 Calhoun St · Charleston, SC/ }).click();
  await expect(page.getByLabel("City")).toHaveValue("Charleston");
  await expect(page.getByLabel("State")).toHaveValue("SC");
  await expect(page.getByLabel("ZIP")).toHaveValue(/^29401/);
  await expect(street).toHaveValue("40 Calhoun St");
});

test("Company form: keyboard pick works too", async ({ page }) => {
  await signInAs(page, "zetaOwner", "/app/contacts");
  await page.getByRole("button", { name: "New company" }).first().click();
  const d = page.getByRole("dialog", { name: "New company" });
  await d.getByRole("combobox", { name: "Address" }).fill("40 Calhoun St Charl");
  await expect(d.getByRole("listbox", { name: "Address suggestions" }).getByRole("option").first()).toBeVisible({ timeout: 10_000 });
  await d.getByRole("combobox", { name: "Address" }).press("ArrowDown");
  await d.getByRole("combobox", { name: "Address" }).press("Enter");
  await expect(d.getByLabel("City")).toHaveValue("Charleston");
  await expect(d.getByLabel("State")).toHaveValue("SC");
});
