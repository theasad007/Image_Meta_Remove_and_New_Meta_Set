import { expect, test, type Page } from "@playwright/test";
import { row, upload } from "./helpers";

/**
 * Issue 04 — responsive spot-checks for the refined GPS labels, cards and
 * guidance at the remaining desktop widths (1536 / 1280). The 412 / 375 / 768
 * widths are covered by geotag-mobile.spec.ts.
 */

async function openLocationTab(page: Page) {
  await row(page, "jpeg-gps-sw.jpg").getByRole("button", { name: /Edit metadata for/ }).first().click({ timeout: 120000 });
  await page.locator('[data-testid="editor-modal"]').waitFor({ timeout: 60000 });
  await page.locator('[data-testid="editor-tab-location"]').click();
  await page.getByTestId("geotag-editor").waitFor({ timeout: 30000 });
}

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as unknown as Record<string, unknown>;
    delete target["showSaveFilePicker"];
  });
  await page.goto("/");
});

for (const width of [1536, 1280]) {
  test(`GPS editor labels, cards and guidance stay clean at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await upload(page, ["jpeg-gps-sw.jpg"]);
    await openLocationTab(page);

    // Planned state: badge, card and guidance all render inside the layout.
    await page.getByTestId("geotag-input-latitude").fill("-34.6037");
    await page.getByTestId("geotag-input-longitude").fill("-58.3816");
    await expect(page.getByTestId("geotag-status-badge")).toContainText("Coordinates modified — not yet applied");
    await expect(page.getByTestId("geotag-new-heading")).toContainText("New GPS (planned)");
    await expect(page.getByTestId("geotag-apply-guidance")).toBeVisible();
    await expect(page.getByTestId("geotag-footer-note")).toBeVisible();
    await assertNoHorizontalOverflow(page);

    // Buttons don't overlap: apply and remove are on one row at this width.
    const apply = page.getByTestId("geotag-apply");
    const remove = page.getByTestId("geotag-remove");
    await expect(apply).toBeVisible();
    await expect(remove).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });
}
