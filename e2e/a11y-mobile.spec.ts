import { expect, test } from "@playwright/test";
import { fixture, upload } from "./helpers";

/** Keyboard operability, status announcements, and small-viewport layout. */
test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("keyboard activates the real picker and dropzone announces itself", async ({ page }) => {
  const dropzone = page.locator('[data-testid="upload-dropzone"]');
  await expect(dropzone).toHaveAttribute("role", "button");
  await expect(dropzone).toHaveAttribute("tabindex", "0");
  await dropzone.focus();
  await expect(dropzone).toBeFocused();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  const chooser = await chooserPromise;
  await chooser.setFiles(fixture("jpeg-exif.jpg"));
  await expect(page.locator('[data-testid="queue-item"]')).toHaveCount(1);
  // Live regions exist for queue announcements.
  expect(await page.locator('[role="status"]').count()).toBeGreaterThan(0);
});

test("mobile viewport: no horizontal overflow, actions reachable", async ({ page }) => {
  await upload(page, ["jpeg-exif.jpg"]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByRole("button", { name: "View details" })).toBeVisible({ timeout: 120000 });
  await page.getByRole("button", { name: "View details" }).click();
  await expect(page.locator('[data-testid="inspector-panel"]')).toBeVisible({ timeout: 60000 });
  const overflowAfter = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflowAfter).toBeLessThanOrEqual(1);
});
