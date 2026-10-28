import { type Page, expect, test } from "@playwright/test";
import { clerkAdmin, ownerPool } from "./support/clean";
import { FIRMS, PEOPLE } from "./support/people";
import { expectShell, signInAs } from "./support/sign-in";

// Settings spec acceptance tests (docs/specs/release-0/settings-firm.md).
// They run in order against "E2E Gamma Group", a test firm only this file
// uses, because they change it. Rules that need no browser (normalization,
// who may change whom, last owner, invitation accepted on sign-up, calling a
// server action without access, cross-firm reads) are Vitest tests in
// src/lib and src/server/settings.

test.describe.configure({ mode: "serial" });

const GAMMA = FIRMS.gamma.name;

/** Run SQL against the dev database as the owner, with Gamma selected. */
async function query<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const pool = ownerPool();
  const c = await pool.connect();
  try {
    await c.query("begin");
    const firm = await c.query<{ id: string }>(
      "select id from firms where name = $1",
      [GAMMA],
    );
    await c.query("select set_config('app.firm_id', $1, true)", [
      firm.rows[0].id,
    ]);
    const result = await c.query<T>(
      sql.replaceAll(":firm", `'${firm.rows[0].id}'`),
      params,
    );
    await c.query("commit");
    return result.rows;
  } finally {
    c.release();
    await pool.end();
  }
}

const sectionNav = (page: Page) =>
  page.getByRole("navigation", { name: "Settings sections" });
const saveButton = (page: Page) =>
  page.getByRole("button", { name: /Save changes|Saving…/ });
const rail = (page: Page) =>
  page.getByRole("navigation", { name: "Main menu" });

test.describe("settings frame and access", () => {
  test("owner opening /app/settings lands on Firm profile", async ({
    page,
  }) => {
    await signInAs(page, "gammaOwner", "/app/settings");
    await expect(page).toHaveURL(/\/app\/settings\/firm$/);
    await expect(
      sectionNav(page).getByRole("link", { name: "Firm profile" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Firm profile",
    );
  });

  test("a project manager sees no access on Modules & plan", async ({
    page,
  }) => {
    await signInAs(page, "gammaPm", "/app/settings/modules");
    await expect(
      page.getByRole("heading", { name: "You don't have access to this page" }),
    ).toBeVisible();
    await expect(sectionNav(page)).toHaveCount(0);
  });
});

test.describe("firm profile", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "gammaOwner", "/app/settings/firm");
    await expect(page.getByRole("main").getByLabel("Firm name")).toBeVisible();
  });

  test("Save is disabled until something changes", async ({ page }) => {
    await expect(saveButton(page)).toBeDisabled();
    await expect(page.getByText("Unsaved changes")).toHaveCount(0);
    await page.getByRole("main").getByLabel("Main phone").fill("843");
    await expect(page.getByText("Unsaved changes")).toBeVisible();
    await expect(saveButton(page)).toBeEnabled();
  });

  test("phone and website are cleaned up when saved", async ({ page }) => {
    await page.getByRole("main").getByLabel("Main phone").fill("843.555.0100");
    await page
      .getByRole("main")
      .getByLabel("Website")
      .fill("https://www.TMG-Arch.com/");
    await saveButton(page).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByLabel("Main phone")).toHaveValue(
      "(843) 555-0100",
    );
    const [firm] = await query<{ phone: string; website: string }>(
      "select phone, website from firms where id = :firm",
    );
    expect(firm).toEqual({
      phone: "(843) 555-0100",
      website: "www.tmg-arch.com",
    });
  });

  test("an empty Firm name is refused and gets focus", async ({ page }) => {
    await page.getByRole("main").getByLabel("Firm name").fill("");
    await saveButton(page).click();
    await expect(page.getByText("Firm name is required")).toBeVisible();
    await expect(page.getByRole("main").getByLabel("Firm name")).toBeFocused();
    const [firm] = await query<{ name: string }>(
      "select name from firms where id = :firm",
    );
    expect(firm.name).toBe(GAMMA);
  });

  test('ZIP "2940" is refused and nothing is saved', async ({ page }) => {
    await page.getByRole("main").getByLabel("City").fill("Mount Pleasant");
    await page.getByRole("main").getByLabel("ZIP").fill("2940");
    await saveButton(page).click();
    await expect(page.getByText("Enter a 5-digit ZIP")).toBeVisible();
    const [firm] = await query<{ city: string | null }>(
      "select city from firms where id = :firm",
    );
    expect(firm.city).toBeNull();
  });

  test('Display name "TMG" shows in the header, Clerk and the activity log', async ({
    page,
  }) => {
    await page.getByRole("main").getByLabel("Display name").fill("TMG");
    await saveButton(page).click();
    await expect(page.getByTestId("firm-name")).toHaveText("TMG");

    const [firm] = await query<{ clerk_org_id: string }>(
      "select clerk_org_id from firms where id = :firm",
    );
    const org = await clerkAdmin().organizations.getOrganization({
      organizationId: firm.clerk_org_id,
    });
    expect(org.name).toBe("TMG");

    const logs = await query<{ changes: { display_name?: { after: string } } }>(
      "select changes from activity_log where firm_id = :firm and entity_type = 'firm' and changes ? 'display_name'",
    );
    expect(logs).toHaveLength(1);
    expect(logs[0].changes.display_name?.after).toBe("TMG");
  });

  test("leaving with unsaved changes asks first; Cancel stays", async ({
    page,
  }) => {
    await page.getByRole("main").getByLabel("City").fill("Charleston");
    let message = "";
    page.once("dialog", (d) => {
      message = d.message();
      void d.dismiss();
    });
    await sectionNav(page)
      .getByRole("link", { name: "Modules & plan" })
      .click();
    expect(message).toBe("Discard unsaved changes?");
    await expect(page).toHaveURL(/\/app\/settings\/firm$/);
    await expect(page.getByRole("main").getByLabel("City")).toHaveValue(
      "Charleston",
    );
  });
});

test.describe("modules & plan", () => {
  const ORDER = [
    "Build",
    "Workload",
    "Accounting",
    "Marketing",
    "Knowledge",
    "Code",
    "Website",
    "Hiring",
  ];
  const card = (page: Page, name: string) =>
    page.getByRole("region", { name: `${name} module` });

  test.beforeEach(async ({ page }) => {
    await signInAs(page, "gammaOwner", "/app/settings/modules");
    await expect(card(page, "Build")).toBeVisible();
  });

  test("8 cards in order, Code off, 7 of 8, seats", async ({ page }) => {
    const names = await page
      .getByRole("region", { name: / module$/ })
      .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    expect(names).toEqual(ORDER.map((n) => `${n} module`));
    await expect(
      page.getByRole("switch", { name: "Turn on Code" }),
    ).toHaveAttribute("aria-checked", "false");
    const plan = page.getByRole("region", { name: "Plan" });
    await expect(plan).toContainText("7 of 8");
    // Gamma has 4 active people.
    await expect(plan).toContainText("4 seats");
  });

  test("switching Hiring off and saving updates the menu without a reload", async ({
    page,
  }) => {
    await expect(
      rail(page).getByRole("link", { name: "Hiring", exact: true }),
    ).toBeVisible();
    await page.getByRole("switch", { name: "Turn off Hiring" }).click();
    await expect(card(page, "Hiring")).toHaveCSS(
      "border-color",
      "rgb(220, 220, 220)",
    );
    await saveButton(page).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    // Owners still see modules that are off, dimmed (decided in 0.5).
    await expect(
      rail(page).getByRole("link", { name: "Hiring (turned off)" }),
    ).toBeVisible();
    const [row] = await query<{ modules_enabled: string[] }>(
      "select modules_enabled from firm_settings where firm_id = :firm",
    );
    expect(row.modules_enabled).not.toContain("hiring");
  });

  test("Code on then off is still unsaved, and saves the same list", async ({
    page,
  }) => {
    const [before] = await query<{ modules_enabled: string[] }>(
      "select modules_enabled from firm_settings where firm_id = :firm",
    );
    await page.getByRole("switch", { name: "Turn on Code" }).click();
    await page.getByRole("switch", { name: "Turn off Code" }).click();
    await expect(page.getByText("Unsaved changes")).toBeVisible();
    await saveButton(page).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    const [after] = await query<{ modules_enabled: string[] }>(
      "select modules_enabled from firm_settings where firm_id = :firm",
    );
    expect(after.modules_enabled).toEqual(before.modules_enabled);
  });
});

test.describe("users & access", () => {
  const INVITEE = "architrac-e2e-invitee+clerk_test@example.com";
  const row = (page: Page, text: string) =>
    page.getByTestId("person-row").filter({ hasText: text });

  test("an admin can't invite an owner", async ({ page }) => {
    await signInAs(page, "gammaAdmin", "/app/settings/users");
    const options = await page
      .getByLabel("Role", { exact: true })
      .locator("option")
      .allTextContents();
    expect(options).toEqual(["Admin", "Project manager", "Staff"]);
  });

  test("an admin sees an owner's row as plain text with no actions", async ({
    page,
  }) => {
    await signInAs(page, "gammaAdmin", "/app/settings/users");
    const owner = row(page, PEOPLE.gammaOwner.email);
    await expect(owner).toContainText("Owner");
    await expect(owner.getByRole("combobox")).toHaveCount(0);
    await expect(
      owner.getByRole("button", { name: /^Actions for/ }),
    ).toHaveCount(0);
  });

  test("the only owner's own row has no role select and no actions", async ({
    page,
  }) => {
    await signInAs(page, "gammaOwner", "/app/settings/users");
    const me = row(page, PEOPLE.gammaOwner.email);
    await expect(me).toContainText("(you)");
    await expect(me.getByRole("combobox")).toHaveCount(0);
    await expect(me.getByRole("button", { name: /^Actions for/ })).toHaveCount(
      0,
    );
  });

  test("inviting someone as Staff: Invited row, saved, sent through Clerk", async ({
    page,
  }) => {
    await signInAs(page, "gammaOwner", "/app/settings/users");
    await page.getByRole("main").getByLabel("Email").fill(INVITEE);
    await page
      .getByRole("main")
      .getByLabel("Role", { exact: true })
      .selectOption("staff");
    await page.getByRole("main").getByLabel("Title").fill("Designer");
    await page.getByRole("button", { name: "Send invite" }).click();
    await expect(page.getByTestId("toast")).toHaveText(
      `Invite sent to ${INVITEE}`,
    );
    await expect(row(page, INVITEE)).toContainText("Invited");

    const [inv] = await query<{
      status: string;
      app_role: string;
      title: string;
      clerk_invitation_id: string;
    }>(
      "select status, app_role, title, clerk_invitation_id from invitations where firm_id = :firm and email = $1",
      [INVITEE],
    );
    expect(inv).toMatchObject({
      status: "pending",
      app_role: "staff",
      title: "Designer",
    });
    const [firm] = await query<{ clerk_org_id: string }>(
      "select clerk_org_id from firms where id = :firm",
    );
    const list = await clerkAdmin().organizations.getOrganizationInvitationList(
      {
        organizationId: firm.clerk_org_id,
        status: ["pending"],
      },
    );
    expect(list.data.map((i) => i.id)).toContain(inv.clerk_invitation_id);
  });

  test("inviting an active member is refused", async ({ page }) => {
    await signInAs(page, "gammaOwner", "/app/settings/users");
    await page.getByRole("main").getByLabel("Email").fill(PEOPLE.gammaJr.email);
    await page.getByRole("button", { name: "Send invite" }).click();
    await expect(
      page.getByText(`${PEOPLE.gammaJr.email} is already a member`),
    ).toBeVisible();
  });

  test("revoking the invitation removes the row", async ({ page }) => {
    await signInAs(page, "gammaOwner", "/app/settings/users");
    await row(page, INVITEE)
      .getByRole("button", { name: `Actions for ${INVITEE}` })
      .click();
    await page.getByRole("menuitem", { name: "Revoke" }).click();
    await expect(row(page, INVITEE)).toHaveCount(0);
    const [inv] = await query<{ status: string }>(
      "select status from invitations where firm_id = :firm and email = $1",
      [INVITEE],
    );
    expect(inv.status).toBe("revoked");
  });

  test("deactivating JR: Off, removed from Clerk, history kept", async ({
    page,
  }) => {
    await signInAs(page, "gammaOwner", "/app/settings/users");
    await row(page, PEOPLE.gammaJr.email)
      .getByRole("button", { name: "Actions for Jo Rivers" })
      .click();
    await page.getByRole("menuitem", { name: "Deactivate" }).click();
    await expect(page.getByRole("dialog")).toContainText(
      /Turn off access for Jo Rivers\? They won't be able to sign in to .+\. Their time and history stay\./,
    );
    await page.getByRole("button", { name: "Turn off access" }).click();
    await expect(row(page, PEOPLE.gammaJr.email)).toContainText("Off");

    const [m] = await query<{ active: boolean; archived_at: Date | null }>(
      `select m.active, m.archived_at from memberships m join users u on u.id = m.user_id
       where m.firm_id = :firm and u.email = $1`,
      [PEOPLE.gammaJr.email],
    );
    expect(m).toEqual({ active: false, archived_at: null });
    const [firm] = await query<{ clerk_org_id: string }>(
      "select clerk_org_id from firms where id = :firm",
    );
    const members =
      await clerkAdmin().organizations.getOrganizationMembershipList({
        organizationId: firm.clerk_org_id,
      });
    expect(members.data.map((x) => x.publicUserData?.identifier)).not.toContain(
      PEOPLE.gammaJr.email,
    );
  });
});

test.describe("phone width", () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test("section menu stacks above Main; the people table scrolls inside its card", async ({
    page,
  }) => {
    await signInAs(page, "gammaOwner", "/app/settings/users");
    await expectShell(page);
    const nav = await sectionNav(page).boundingBox();
    const table = page.getByRole("region", { name: "People", exact: true });
    const tableBox = await table.boundingBox();
    expect(nav && tableBox && nav.y + nav.height <= tableBox.y).toBe(true);

    const pageScroll = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(pageScroll.scroll).toBeLessThanOrEqual(pageScroll.client);
    const inner = await table.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(inner).toBe(true);
  });
});
