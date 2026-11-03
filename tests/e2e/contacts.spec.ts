import { type Page, expect, test } from "@playwright/test";
import { ownerPool } from "./support/clean";
import { FIRMS } from "./support/people";
import { signInAs } from "./support/sign-in";

// Contacts page in the browser (docs/specs/release-1/contacts.md). Money
// fields per role, permissions, archive rules and cross-firm checks are also
// Vitest tests in src/server/contacts/contacts.db.test.ts.
//
// Runs in order against "E2E Zeta Studio", which only this file uses.

test.describe.configure({ mode: "serial" });

async function query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const pool = ownerPool();
  const c = await pool.connect();
  try {
    const firm = await c.query<{ id: string }>("select id from firms where name = $1", [FIRMS.zeta.name]);
    await c.query("begin");
    await c.query("select set_config('app.firm_id', $1, true)", [firm.rows[0].id]);
    const r = await c.query<T>(sql.replaceAll(":firm", `'${firm.rows[0].id}'::uuid`), params);
    await c.query("commit");
    return r.rows;
  } finally {
    c.release();
    await pool.end();
  }
}

const companyRow = (page: Page, name: string) => page.locator(`tr[data-company="${name}"]`);
const contactRow = (page: Page, name: string) => page.locator(`tr[data-contact="${name}"]`);
const toast = (page: Page) => page.getByTestId("toast").last();
const summary = (page: Page) => page.getByRole("region", { name: "Contacts summary" });

test.describe("owner", () => {
  test("adding a client with no billing contact flags it", async ({ page }) => {
    await signInAs(page, "zetaOwner", "/app/contacts");
    await expect(page.getByText("No contacts yet. Add your first client or consultant.")).toBeVisible();
    await page.getByRole("button", { name: "New company" }).first().click();
    const d = page.getByRole("dialog", { name: "New company" });
    await d.getByLabel("Name").fill("Palmetto Medical Properties");
    await d.getByLabel("Description").fill("Medical developer");
    await d.getByLabel("Website").fill("www.palmettomed.com");
    await d.getByLabel("ZIP").fill("29401");
    await d.getByRole("button", { name: "Add company" }).click();
    await expect(toast(page)).toHaveText("Palmetto Medical Properties added");
    await page.keyboard.press("Escape");
    const row = companyRow(page, "Palmetto Medical Properties");
    await expect(row).toContainText("◆ No billing contact");
    await expect(summary(page)).toContainText("Missing billing contact1");
    await expect(summary(page)).toContainText("Clients with open balances");
  });

  test('a bad ZIP blocks Save; a duplicate name only warns', async ({ page }) => {
    await signInAs(page, "zetaOwner", "/app/contacts");
    await page.getByRole("button", { name: "New company" }).click();
    const d = page.getByRole("dialog", { name: "New company" });
    await d.getByLabel("Name").fill("palmetto medical properties ");
    await expect(d.getByText(/A company named Palmetto Medical Properties already exists/)).toBeVisible();
    await d.getByLabel("ZIP").fill("2940");
    await expect(d.getByText("Enter a 5-digit ZIP or ZIP+4")).toBeVisible();
    await expect(d.getByRole("button", { name: "Add company" })).toBeDisabled();
    await d.getByLabel("ZIP").fill("");
    await d.getByLabel("Name").fill("Coastal MEP Engineers");
    await d.getByLabel("Type").selectOption("consultant");
    await d.getByRole("button", { name: "Add company" }).click();
    await expect(toast(page)).toHaveText("Coastal MEP Engineers added");
  });

  test("a contact checked as billing contact fixes the flag", async ({ page }) => {
    await signInAs(page, "zetaOwner", "/app/contacts");
    await page.getByRole("button", { name: "New contact" }).click();
    const d = page.getByRole("dialog", { name: "New contact" });
    await d.getByLabel("First name").fill("Jo");
    await d.getByLabel("Last name").fill("Banks");
    await d.getByLabel("Company").selectOption({ label: "Palmetto Medical Properties" });
    await d.getByLabel("Billing contact for Palmetto Medical Properties").check();
    await d.getByLabel("Email").fill("jo@palmettomed.com");
    await d.getByLabel("Tags").fill("Billing");
    await d.getByLabel("Tags").press("Enter");
    await d.getByRole("button", { name: "Add contact" }).click();
    await expect(toast(page)).toHaveText("Jo Banks added");
    await page.keyboard.press("Escape");
    await page.getByRole("tab", { name: /Companies/ }).click();
    await expect(companyRow(page, "Palmetto Medical Properties")).toContainText("Jo Banks");
    await expect(summary(page)).toContainText("Missing billing contact0");
    const [c] = await query<{ billing: string | null }>(
      "select billing_contact_id as billing from companies where firm_id = :firm and name = 'Palmetto Medical Properties'",
    );
    expect(c.billing).not.toBeNull();
  });

  test("search, filters and the open panel live in the address", async ({ page }) => {
    await signInAs(page, "zetaOwner", "/app/contacts");
    await page.getByPlaceholder("Search companies").fill("palm");
    await expect(page.getByTestId("shown-note")).toHaveText("1 companies shown");
    await expect(page).toHaveURL(/q=palm/);
    await page.getByPlaceholder("Search companies").fill("");

    await page.getByRole("button", { name: "Consultants", exact: true }).click();
    await page.getByRole("tab", { name: /People/ }).click();
    await expect(page.getByRole("button", { name: "Consultants", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("shown-note")).toHaveText("0 people shown");
    await page.getByRole("button", { name: "All", exact: true }).click();
    await page.getByPlaceholder("Search people, titles or tags").fill("billing");
    await expect(contactRow(page, "Jo Banks")).toBeVisible();

    await page.getByRole("tab", { name: /Companies/ }).click();
    await page.getByPlaceholder("Search companies").fill("");
    await companyRow(page, "Palmetto Medical Properties").click();
    await expect(page).toHaveURL(/company=/);
    await page.reload();
    const panel = page.getByRole("dialog", { name: "Palmetto Medical Properties" });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("link", { name: "New project" })).toHaveAttribute("href", /\/app\/projects\/new\?client=/);
  });

  test("archiving the billing contact is blocked", async ({ page }) => {
    await signInAs(page, "zetaOwner", "/app/contacts?tab=people");
    await contactRow(page, "Jo Banks").click();
    await page.getByRole("dialog", { name: "Jo Banks" }).getByRole("button", { name: "Archive" }).click();
    await page.getByRole("dialog", { name: "Archive Jo Banks?" }).getByRole("button", { name: "Archive" }).click();
    await expect(toast(page)).toHaveText("Choose another billing contact for Palmetto Medical Properties first.");
  });
});

test.describe("other roles", () => {
  test("staff: no money, no New buttons, no Edit or Archive", async ({ page }) => {
    await signInAs(page, "zetaStaff", "/app/contacts");
    await expect(companyRow(page, "Palmetto Medical Properties")).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Billed / fees" })).toHaveCount(0);
    await expect(summary(page)).not.toContainText("open balances");
    await expect(page.getByRole("button", { name: "New company" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New contact" })).toHaveCount(0);
    await companyRow(page, "Palmetto Medical Properties").click();
    const panel = page.getByRole("dialog", { name: "Palmetto Medical Properties" });
    await expect(panel.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(panel.getByRole("link", { name: "New project" })).toHaveCount(0);
  });

  test("PM: can edit, can't archive, no money", async ({ page }) => {
    await signInAs(page, "zetaPm", "/app/contacts");
    await expect(page.getByRole("columnheader", { name: "Billed / fees" })).toHaveCount(0);
    await companyRow(page, "Coastal MEP Engineers").click();
    const panel = page.getByRole("dialog", { name: "Coastal MEP Engineers" });
    await expect(panel.getByRole("button", { name: "Edit" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Archive" })).toHaveCount(0);
  });
});
