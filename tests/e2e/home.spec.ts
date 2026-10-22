import { expect, test } from "@playwright/test";

test("home page shows ArchiTrac in the brand font", async ({ page }) => {
  await page.goto("/");

  const heading = page.getByRole("heading", { level: 1, name: "ArchiTrac" });
  await expect(heading).toBeVisible();

  // The heading's font stack starts with Barlow…
  const fontFamily = await heading.evaluate(
    (el) => getComputedStyle(el).fontFamily,
  );
  expect(fontFamily).toMatch(/barlow/i);

  // …and the browser actually loaded the Barlow font file.
  const barlowLoaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].some(
      (f) => /barlow/i.test(f.family) && f.status === "loaded",
    );
  });
  expect(barlowLoaded).toBe(true);
});
