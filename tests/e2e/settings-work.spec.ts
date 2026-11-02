import { type Page, expect, test } from "@playwright/test";
import { ownerPool } from "./support/clean";
import { FIRMS } from "./support/people";
import { signInAs } from "./support/sign-in";

// Settings → Phases & fees, Roles & rates, Time & approvals in the browser
// (docs/specs/release-1/settings-rates-phases.md). Only what needs a page:
// live numbers, dialogs and messages. The saved rows, KPIs with people,
// effective dates, permissions and cross-firm checks are Vitest tests in
// src/server/settings/work-settings.db.test.ts.
//
// Runs in order against "E2E Delta Design", which only this file uses.

test.describe.configure({ mode: "serial" });

const ROLES = [
  { sort: 1, name: "Principal", billable: true, bill: 18500, cost: 9500 },
  { sort: 3, name: "Project architect", billable: true, bill: 14500, cost: 5800 },
  { sort: 4, name: "Designer", billable: true, bill: 11500, cost: 4400 },
  { sort: 7, name: "Office manager", billable: false, bill: 0, cost: 3800 },
];

test.beforeAll(async () => {
  const pool = ownerPool();
  const c = await pool.connect();
  try {
    const firm = await c.query<{ id: string }>(
      "select id from firms where name = $1",
      [FIRMS.delta.name],
    );
    const firmId = firm.rows[0].id;
    await c.query("begin");
    await c.query("select set_config('app.firm_id', $1, true)", [firmId]);
    for (const r of ROLES) {
      const role = await c.query<{ id: string }>(
        "insert into firm_roles (firm_id, name, is_billable, sort_order) values ($1, $2, $3, $4) returning id",
        [firmId, r.name, r.billable, r.sort],
      );
      await c.query(
        "insert into rates (firm_id, firm_role_id, bill_rate_cents, cost_rate_cents, effective_from) values ($1, $2, $3, $4, '2026-01-01')",
        [firmId, role.rows[0].id, r.bill, r.cost],
      );
    }
    await c.query("commit");
  } finally {
    c.release();
    await pool.end();
  }
});

const main = (page: Page) => page.getByRole("main");
const roleRow = (page: Page, name: string) =>
  main(page).locator(`tr[data-role="${name}"]`);
const saveButton = (page: Page) =>
  page.getByRole("button", { name: /Save changes|Saving…/ });

test("the Settings menu has a Work group", async ({ page }) => {
  await signInAs(page, "deltaOwner", "/app/settings/firm");
  const nav = page.getByRole("navigation", { name: "Settings sections" });
  for (const name of ["Phases & fees", "Roles & rates", "Time & approvals"])
    await expect(nav.getByRole("link", { name })).toBeVisible();
});

test("a project manager can't open Roles & rates", async ({ page }) => {
  await signInAs(page, "deltaPm", "/app/settings/rates");
  await expect(
    page.getByRole("heading", { name: "You don't have access to this page" }),
  ).toBeVisible();
  await expect(page.getByText("$44")).toHaveCount(0);
});

test.describe("Roles & rates", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "deltaOwner", "/app/settings/rates");
    await expect(roleRow(page, "Designer")).toBeVisible();
  });

  test("multiplier pills and Not billable", async ({ page }) => {
    const principal = roleRow(page, "Principal").getByTestId("multiplier");
    await expect(principal).toHaveText("1.95×");
    await expect(principal).toHaveAttribute("data-status", "flagged");
    const pa = roleRow(page, "Project architect").getByTestId("multiplier");
    await expect(pa).toHaveText("2.50×");
    await expect(pa).toHaveAttribute("data-status", "ok");
    const om = roleRow(page, "Office manager");
    await expect(om.getByText("Not billable")).toBeVisible();
    await expect(om.getByTestId("multiplier")).toHaveText("—");
  });

  test("Designer cost 40 updates the multiplier and example before saving", async ({
    page,
  }) => {
    await page.getByLabel("Designer cost rate").fill("40");
    await expect(roleRow(page, "Designer").getByTestId("multiplier")).toHaveText("2.88×");
    await expect(page.getByTestId("designer-example")).toHaveText("$64.00 / h");
    await expect(page.getByText("Unsaved changes")).toBeVisible();
  });

  test("the overhead calculator fills in the rate", async ({ page }) => {
    await page.getByLabel("Overhead expenses").fill("612000");
    await page.getByLabel("Labor cost on projects").fill("1020000");
    await expect(page.getByTestId("overhead-calc")).toHaveText(
      "$612,000 ÷ $1,020,000 = 60%",
    );
    await page.getByRole("button", { name: "Use 60%" }).click();
    await expect(page.getByRole("spinbutton", { name: "Overhead rate" })).toHaveValue("60");
    await expect(page.getByText("Unsaved changes")).toBeVisible();
  });

  test("a rate change asks for a date and rejects one that's too early", async ({
    page,
  }) => {
    await page.getByLabel("Designer bill rate").fill("120");
    await saveButton(page).click();
    const dialog = page.getByRole("dialog", { name: "Apply new rates from" });
    await expect(dialog.getByText("Designer: $115 → $120 bill")).toBeVisible();
    await dialog.getByLabel("Effective date").fill("2025-12-15");
    await dialog.getByRole("button", { name: "Apply rates" }).click();
    await expect(
      dialog.getByText("Pick Jan 1, 2026 or later — Designer's current rate starts then."),
    ).toBeVisible();

    await dialog.getByLabel("Effective date").fill("2026-12-01");
    await dialog.getByRole("button", { name: "Apply rates" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    // Still Jan 1 until the new rate starts.
    await expect(roleRow(page, "Designer").getByText("Jan 1, 2026")).toBeVisible();
  });

  test("saving overhead 75% shows a 1.75× breakeven", async ({ page }) => {
    await page.getByRole("spinbutton", { name: "Overhead rate" }).fill("75");
    await saveButton(page).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await expect(page.getByTestId("kpi-Breakeven")).toHaveText("1.75×");
  });

  test("Add role puts Senior designer last at 2.60× with 0 people", async ({ page }) => {
    await page.getByRole("button", { name: "Add role" }).click();
    const dialog = page.getByRole("dialog", { name: "Add role" });
    await dialog.getByLabel("Name").fill("Senior designer");
    await dialog.getByLabel("Bill rate $ / h").fill("130");
    await dialog.getByLabel("Cost rate $ / h").fill("50");
    await dialog.getByLabel("Effective from").fill("2026-01-01");
    await dialog.getByRole("button", { name: "Add role" }).click();
    await expect(dialog).toBeHidden();
    const last = main(page).locator("tr[data-role]").last();
    await expect(last).toHaveAttribute("data-role", "Senior designer");
    await expect(last.getByTestId("multiplier")).toHaveText("2.60×");
    await expect(last.locator("td").nth(1)).toHaveText("0");
  });
});

test.describe("Phases & fees", () => {
  test("the total turns orange and Save is blocked when it isn't 100%", async ({
    page,
  }) => {
    await signInAs(page, "deltaOwner", "/app/settings/phases");
    const total = page.getByTestId("phase-total");
    await expect(total).toHaveText("100%");
    await expect(page.getByText("Adds up to the full fee")).toBeVisible();

    await page.getByLabel("Construction Documents percent of fee").fill("30");
    await expect(total).toHaveText("95%");
    await expect(page.getByText("5% of the fee is unassigned")).toBeVisible();
    await saveButton(page).click();
    await expect(main(page).getByRole("alert")).toHaveText(
      "Phase shares must add up to 100%. Now 95%.",
    );
  });

  test("an optional phase can be added with a fee type", async ({ page }) => {
    await signInAs(page, "deltaOwner", "/app/settings/phases");
    await expect(page.getByText("No optional phases yet.")).toBeVisible();
    await page.getByRole("button", { name: "Add optional phase" }).click();
    const optional = page.getByRole("region", { name: "Optional phases" });
    await optional.getByLabel("Phase name").fill("Interior Design");
    await optional.getByLabel("Interior Design abbreviation").fill("int");
    await optional.getByLabel("Interior Design fee type").selectOption("hourly");
    await optional
      .getByLabel("Interior Design description")
      .fill("Finishes, furniture and fixtures");
    await saveButton(page).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.reload();
    await expect(optional.getByLabel("Interior Design abbreviation")).toHaveValue("INT");
    await expect(page.getByTestId("phase-total")).toHaveText("100%");
  });
});

test.describe("Timesheet phases & activities", () => {
  test('adding "travel" again says it is already in the list', async ({ page }) => {
    await signInAs(page, "deltaOwner", "/app/settings/time");
    const project = page.getByRole("group", { name: "Project activities" });
    await expect(project.getByText("Travel", { exact: true })).toBeVisible();
    await project.getByLabel("New project activity").fill("travel");
    await project.getByRole("button", { name: "Add" }).click();
    await expect(project.getByText("Already in the list")).toBeVisible();
    await expect(project.getByText("travel", { exact: true })).toHaveCount(0);
  });

  test("an overhead phase with no activities can't be saved", async ({ page }) => {
    await signInAs(page, "deltaOwner", "/app/settings/time");
    await page.getByLabel("New overhead phase").fill("IT");
    await page.getByLabel("New overhead phase").press("Enter");
    await saveButton(page).click();
    await expect(
      page.getByText("Add at least one activity to IT, or remove it."),
    ).toBeVisible();
  });
});
