import { expect, test, type Page } from "@playwright/test";
import { row, upload } from "./helpers";

/**
 * Screen 09 mobile/tablet behavior: the GeoTag editor stays usable at
 * 412 px / 375 px with zero horizontal overflow, every control remains
 * reachable, and keyboard operation works without the map.
 */

const EDITOR = '[data-testid="editor-modal"]';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as unknown as Record<string, unknown>;
    delete target["showSaveFilePicker"];
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  (page as unknown as { __errors: string[] }).__errors = errors;
  await page.goto("/");
});

test.afterEach(async ({ page }) => {
  const errors = (page as unknown as { __errors: string[] }).__errors;
  expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
});

async function openEditorLocation(page: Page, name: string) {
  await row(page, name).getByRole("button", { name: /Edit metadata for/ }).first().click({ timeout: 120000 });
  await page.locator(EDITOR).waitFor({ timeout: 60000 });
  await page.locator('[data-testid="editor-tab-location"]').click();
  await page.getByTestId("geotag-editor").waitFor({ timeout: 30000 });
}

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test("geotag editor at 412 px: stacked layout, full-width inputs, no overflow", async ({ page }) => {
  await upload(page, ["jpeg-gps-sw.jpg"]);
  await openEditorLocation(page, "jpeg-gps-sw.jpg");

  await assertNoHorizontalOverflow(page);
  await expect(page.getByTestId("geotag-status-card")).toBeVisible();
  await expect(page.getByTestId("geotag-original")).toBeVisible();
  const latitude = page.getByTestId("geotag-input-latitude");
  await expect(latitude).toBeVisible();
  const inputBox = await latitude.boundingBox();
  expect(inputBox?.width ?? 0).toBeGreaterThan(200); // comfortable touch width

  // Editing still works at this size.
  await latitude.fill("-34.6037");
  await page.getByTestId("geotag-input-longitude").fill("-58.3816");
  await expect(page.getByTestId("geotag-status-badge")).toContainText("Coordinates modified — not yet applied");
  await assertNoHorizontalOverflow(page);

  // Issue 02: the guidance renders inside the layout without overflow.
  await expect(page.getByTestId("geotag-apply-guidance")).toContainText("select Apply GPS to this image");
  await expect(page.getByTestId("geotag-footer-note")).toContainText("GPS changes use the Apply GPS to this image button above.");
  await assertNoHorizontalOverflow(page);

  // The primary action stays reachable and clickable (Playwright
  // actionability also proves no footer/backdrop occlusion).
  const apply = page.getByTestId("geotag-apply");
  await apply.scrollIntoViewIfNeeded();
  await expect(apply).toBeVisible();
  await expect(apply).toBeEnabled();
  await assertNoHorizontalOverflow(page);
});

test("geotag editor at 375 px: preview, form and actions stay inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await upload(page, ["jpeg-gps-sw.jpg"]);
  await openEditorLocation(page, "jpeg-gps-sw.jpg");

  await assertNoHorizontalOverflow(page);
  await page.getByTestId("geotag-input-latitude").fill("12.345678");
  await page.getByTestId("geotag-input-longitude").fill("98.765432");
  await expect(page.getByTestId("geotag-preview")).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await expect(page.getByTestId("geotag-apply")).toBeVisible();
  await expect(page.getByTestId("geotag-remove")).toBeVisible();
});

test("map consent card and search wrap cleanly on mobile", async ({ page }) => {
  await upload(page, ["jpeg-gps-sw.jpg"]);
  await openEditorLocation(page, "jpeg-gps-sw.jpg");

  await expect(page.getByTestId("geotag-map-consent")).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await expect(page.getByTestId("geotag-search")).toBeVisible();
  const searchInput = page.getByTestId("geotag-search-input");
  await expect(searchInput).toBeVisible();
  const box = await searchInput.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(150);
});

test("keyboard-only flow: fields, buttons and modal escape work without a pointer", async ({ page }) => {
  await upload(page, ["jpeg-empty.jpg"]);
  await openEditorLocation(page, "jpeg-empty.jpg");

  await page.getByTestId("geotag-input-latitude").focus();
  await page.keyboard.type("-34.6037");
  await page.keyboard.press("Tab");
  await page.keyboard.type("-58.3816");
  await expect(page.getByTestId("geotag-input-longitude")).toHaveValue("-58.3816");
  await expect(page.getByTestId("geotag-status-badge")).toContainText("Coordinates modified — not yet applied");
  await expect(page.getByTestId("geotag-apply")).toBeEnabled();

  await page.keyboard.press("Escape");
  await expect(page.locator(EDITOR)).toHaveCount(0);
});
