import { expect, test } from "@playwright/test";

// The /dev/ui page shows every UI kit component. These checks cover the
// design rules (2px radius, uppercase captions, mono numbers) and the
// interactive parts (tabs, dialog, drawer).

test.beforeEach(async ({ page }) => {
  await page.goto("/dev/ui");
});

test("shows a section for every component", async ({ page }) => {
  for (const name of [
    "Button",
    "Input / Select / Textarea",
    "Table",
    "Card",
    "KPI tile",
    "Tabs",
    "Badge",
    "Progress bar",
    "Avatar",
    "Dialog / Drawer",
    "Empty state",
  ]) {
    await expect(
      page.getByRole("heading", { level: 2, name, exact: true }),
    ).toBeVisible();
  }
});

test("buttons are 38px tall with a 2px radius", async ({ page }) => {
  const button = page.getByRole("button", { name: "Secondary" });
  const style = await button.evaluate((el) => {
    const s = getComputedStyle(el);
    return { height: s.height, radius: s.borderRadius };
  });
  expect(style).toEqual({ height: "38px", radius: "2px" });
});

test("captions are uppercase and numbers are mono", async ({ page }) => {
  const label = page.getByText("Project name", { exact: true });
  await expect(label).toHaveCSS("text-transform", "uppercase");

  const header = page.getByRole("columnheader", { name: "Fee" });
  await expect(header).toHaveCSS("text-transform", "uppercase");
  await expect(header).toHaveCSS("text-align", "right");

  const fee = page.getByRole("cell", { name: "$28,000" }).first();
  expect(await fee.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(
    /plex/i,
  );
});

test("form errors are linked to their field", async ({ page }) => {
  const fee = page.getByRole("textbox", { name: "Fee", exact: true });
  await expect(fee).toHaveAttribute("aria-invalid", "true");
  await expect(fee).toHaveAccessibleDescription(
    "Enter an amount like 186,000.",
  );
});

test("progress bars change colour at 90% and over 100%", async ({ page }) => {
  await expect(page.getByRole("img", { name: "Normal: 45%" })).toHaveAttribute(
    "data-tone",
    "normal",
  );
  await expect(page.getByRole("img", { name: "Warning: 92%" })).toHaveAttribute(
    "data-tone",
    "warning",
  );
  const over = page.getByRole("img", { name: "Over: 118%" });
  await expect(over).toHaveAttribute("data-tone", "over");

  // Only the over-budget bar has a hatched overrun segment.
  await expect(over.locator('[data-part="over"]')).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Warning: 92%" }).locator('[data-part="over"]'),
  ).toHaveCount(0);
});

test("tabs switch with the mouse and arrow keys", async ({ page }) => {
  const tablist = page.getByRole("tablist", { name: "Project status" });
  await expect(tablist.getByRole("tab", { name: /Active/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText("Active projects panel.")).toBeVisible();

  await tablist.getByRole("tab", { name: /On hold/ }).click();
  await expect(page.getByText("On hold projects panel.")).toBeVisible();

  await page.keyboard.press("ArrowRight");
  await expect(tablist.getByRole("tab", { name: /Closed/ })).toBeFocused();
  await expect(page.getByText("Closed projects panel.")).toBeVisible();
});

test("dialog opens, traps focus and closes with Escape", async ({ page }) => {
  const opener = page.getByRole("button", { name: "Open dialog" });
  await opener.click();

  const dialog = page.getByRole("dialog", { name: "Edit phase" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleDescription(
    "Changes apply to future invoices.",
  );

  // Tabbing many times never leaves the dialog.
  for (let i = 0; i < 8; i++) await page.keyboard.press("Tab");
  expect(
    await dialog.evaluate((el) => el.contains(document.activeElement)),
  ).toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("drawer opens from the right and closes with its X button", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Open drawer" }).click();
  const drawer = page.getByRole("dialog", { name: "New contact" });
  await expect(drawer).toBeVisible();

  const box = await drawer.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport && Math.round(box.x + box.width)).toBe(
    viewport?.width,
  );

  await drawer.getByRole("button", { name: "Close" }).click();
  await expect(drawer).toBeHidden();
});
