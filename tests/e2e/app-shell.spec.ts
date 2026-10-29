import { type Page, expect, test } from "@playwright/test";
import { FIRMS } from "./support/people";
import { expectShell, signInAs, useFirm } from "./support/sign-in";

// App-shell spec acceptance tests (docs/specs/release-0/app-shell.md).
// Signed-out redirects are in auth.spec.ts. Database-level tests (create-firm
// rows and rollback, webhook signature and duplicates) are Vitest tests in
// src/server.

const CORE = ["Home", "Projects", "Contacts", "Team", "Time", "Reports"];
const MODULES = [
  "Build",
  "Workload",
  "Accounting",
  "Marketing",
  "Knowledge",
  "Website",
  "Hiring",
];

function rail(page: Page) {
  return page.getByRole("navigation", { name: "Main menu" });
}

/** Rail item names, top to bottom, without the logo link. */
async function railItemNames(page: Page) {
  const names = await rail(page)
    .getByRole("link")
    .evaluateAll((links) =>
      links.map((a) => a.getAttribute("aria-label") ?? ""),
    );
  return names.filter((n) => n !== "ArchiTrac home");
}

test.describe("menu rail", () => {
  test("no modules on, as staff: exactly the 6 core items and no Modules label", async ({
    page,
  }) => {
    await signInAs(page, "staff");
    expect(await railItemNames(page)).toEqual(CORE);
    await expect(rail(page).getByText("Modules", { exact: true })).toHaveCount(
      0,
    );
  });

  test("all modules on: 6 core, the Modules label, then 7 modules in order, no Schedule or Code", async ({
    page,
  }) => {
    await signInAs(page, "alphaStaff"); // only in Alpha: every module on
    await expect(page.getByTestId("firm-name")).toHaveText(FIRMS.alpha.name);
    await expect(rail(page).locator("[data-off]")).toHaveCount(0);
    expect(await railItemNames(page)).toEqual([...CORE, ...MODULES]);
    await expect(
      rail(page).getByText("Modules", { exact: true }),
    ).toBeVisible();
    await expect(rail(page).locator("[data-off]")).toHaveCount(0);
  });

  test("admin sees modules that are off, dimmed with an Add badge", async ({
    page,
  }) => {
    await signInAs(page, "admin"); // Beta, no modules on
    expect(await railItemNames(page)).toEqual([
      ...CORE,
      ...MODULES.map((m) => `${m} (turned off)`),
    ]);
    await expect(
      rail(page).getByText("Modules", { exact: true }),
    ).toBeVisible();
    await expect(rail(page).getByText("ADD", { exact: true })).toHaveCount(7);
  });

  test("on /app/projects/123, Projects is the current item and Home is not", async ({
    page,
  }) => {
    await signInAs(page, "staff", "/app/projects/123");
    await expectShell(page);
    await expect(
      rail(page).getByRole("link", { name: "Projects", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      rail(page).getByRole("link", { name: "Home", exact: true }),
    ).not.toHaveAttribute("aria-current", /.*/);
  });

  test("Collapse menu shrinks the rail to 64px and remembers it in a cookie", async ({
    page,
    context,
  }) => {
    await signInAs(page, "staff");
    await page.getByRole("button", { name: "Collapse menu" }).click();

    await expect(rail(page)).toHaveAttribute("data-collapsed", "true");
    await expect
      .poll(() => rail(page).evaluate((n) => n.getBoundingClientRect().width))
      .toBe(64);
    await expect(rail(page).getByText("Projects", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: "Expand menu" }),
    ).toBeVisible();

    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === "architrac_rail_min")?.value).toBe(
      "1",
    );
  });

  test("with the cookie set, the server's HTML already has the 64px rail", async ({
    page,
    context,
  }) => {
    await signInAs(page, "staff");
    await context.addCookies([
      { name: "architrac_rail_min", value: "1", url: "http://localhost:3000" },
    ]);
    // Raw HTML from the server, before any browser JavaScript runs.
    const html = await (await page.request.get("/app/time")).text();
    expect(html).toMatch(
      /<nav[^>]*aria-label="Main menu"[^>]*data-collapsed="true"/,
    );
    expect(html).toContain("w-rail-min");
  });
});

test.describe("modules that are off", () => {
  test("staff opening /app/build see it's off, with no Turn on button", async ({
    page,
  }) => {
    await signInAs(page, "staff", "/app/build");
    await expect(
      page.getByRole("heading", { name: "Build is turned off" }),
    ).toBeVisible();
    await expect(
      page.getByText("Ask an owner or admin to turn it on."),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Turn on in Settings" }),
    ).toHaveCount(0);
    await expectShell(page); // rail unchanged
  });

  test("an admin opening /app/build gets a link to Settings → Modules", async ({
    page,
  }) => {
    await signInAs(page, "admin", "/app/build");
    await expect(
      page.getByRole("heading", { name: "Build is turned off" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Turn on in Settings" }),
    ).toHaveAttribute("href", "/app/settings/modules");
  });
});

test.describe("header", () => {
  test("staff: no Settings gear, and /app/settings/firm says no access", async ({
    page,
  }) => {
    await signInAs(page, "staff");
    await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);

    await page.goto("/app/settings/firm");
    await expect(
      page.getByRole("heading", { name: "You don't have access to this page" }),
    ).toBeVisible();
  });

  test("owner on /app/settings/firm: the gear is the current page", async ({
    page,
  }) => {
    await signInAs(page, "owner", "/app/settings/firm");
    await expect(page.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("Release 0: no search box and no notifications button", async ({
    page,
  }) => {
    await signInAs(page, "owner");
    const header = page.getByRole("banner");
    await expect(header.getByRole("searchbox")).toHaveCount(0);
    await expect(
      header.getByRole("button", { name: /notifications/i }),
    ).toHaveCount(0);
  });

  test("in only one firm: the firm name shows with no switcher menu", async ({
    page,
  }) => {
    await signInAs(page, "staff");
    const header = page.getByRole("banner");
    await expect(page.getByTestId("firm-name")).toHaveText(FIRMS.beta.name);
    await expect(
      header.getByRole("button", { name: FIRMS.beta.name }),
    ).toHaveCount(0);
  });

  test("account menu shows name, email and role", async ({ page }) => {
    await signInAs(page, "admin");
    await page.getByRole("button", { name: "Account menu" }).click();
    const menu = page.getByRole("menu", { name: "Account" });
    await expect(menu.getByText("Adam Admin")).toBeVisible();
    await expect(
      menu.getByText("architrac-e2e-admin+clerk_test@example.com"),
    ).toBeVisible();
    await expect(menu.getByText("Admin", { exact: true })).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "Your account" }),
    ).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "Sign out" }),
    ).toBeVisible();
  });

  test("switching firms changes the header name and the rail", async ({
    page,
  }) => {
    await signInAs(page, "switcher"); // own person: no other test moves them
    await useFirm(page, "alpha");
    await expect(rail(page).locator("[data-off]")).toHaveCount(0);

    await page.getByRole("button", { name: FIRMS.alpha.name }).click();
    const menu = page.getByRole("menu", { name: "Switch firm" });
    // Both firms are listed; the current one has the check mark.
    await expect(menu.getByRole("menuitemradio")).toHaveCount(2);
    await expect(
      menu.getByRole("menuitemradio", { name: FIRMS.alpha.name }),
    ).toHaveAttribute("aria-checked", "true");
    await menu.getByRole("menuitemradio", { name: FIRMS.beta.name }).click();

    await expect(page.getByTestId("firm-name")).toHaveText(FIRMS.beta.name, {
      timeout: 20_000,
    });
    // Beta has no modules on; an admin sees all 7 as off.
    await expect(rail(page).locator("[data-off]")).toHaveCount(7);
  });
});

test.describe("getting in", () => {
  test("signed up with no firm: /app goes to create-firm; creating one opens the app", async ({
    page,
  }) => {
    await signInAs(page, "noFirm");
    await expect(page).toHaveURL(/\/onboarding\/create-firm$/, {
      timeout: 30_000,
    });

    const name = "E2E The Middleton Group";
    await page.getByLabel("Firm name").fill(name);
    await page.getByLabel("Time zone").selectOption("America/New_York");
    await page
      .getByLabel("Fiscal year starts in")
      .selectOption({ label: "January" });
    await page.getByRole("button", { name: "Create firm" }).click();

    await expect(page).toHaveURL(/\/app$/, { timeout: 30_000 });
    await expect(page.getByTestId("firm-name")).toHaveText(name);
    // New firms start with no modules; the owner sees them all as off.
    await expect(rail(page).locator("[data-off]")).toHaveCount(7);
  });

  test("a deactivated member sees the access-off page and no rail", async ({
    page,
  }) => {
    await signInAs(page, "deactivated");
    await expect(
      page.getByRole("heading", {
        name: `Your access to ${FIRMS.beta.name} has been turned off`,
      }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(rail(page)).toHaveCount(0);
  });
});

test("an unknown /app address shows Page not found inside the shell", async ({
  page,
}) => {
  await signInAs(page, "staff", "/app/does-not-exist");
  await expect(
    page.getByRole("heading", { name: "Page not found" }),
  ).toBeVisible();
  await expectShell(page);
  await expect(page.getByRole("link", { name: "Go to Home" })).toHaveAttribute(
    "href",
    "/app",
  );
});

test.describe("phone width", () => {
  test.use({ viewport: { width: 375, height: 740 } });

  test("rail hidden; the menu button opens a drawer; Esc closes it and focus returns", async ({
    page,
  }) => {
    await signInAs(page, "staff");
    // Found by attribute: while the drawer is open, the page behind it is
    // hidden from screen readers (as it should be), and role queries skip it.
    const button = page.locator('button[aria-label="Open menu"]');
    await expect(button).toBeVisible({ timeout: 30_000 });
    await expect(rail(page)).toBeHidden();

    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(rail(page)).toBeVisible();
    await expect(
      rail(page).getByRole("link", { name: "Projects" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Collapse menu" }),
    ).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(rail(page)).toBeHidden();
    await expect(button).toBeFocused();

    // No sideways scrolling.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
  });
});
