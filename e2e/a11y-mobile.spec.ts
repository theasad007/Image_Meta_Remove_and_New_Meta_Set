import { expect, test } from "@playwright/test";
import { closeDetailsModal, fixture, upload } from "./helpers";

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
  // Screen 05: the image-details dialog is full-height on phone and its
  // inspection tabs scroll within their own container only.
  const dialog = page.locator('[data-testid="details-modal"]');
  await expect(dialog).toBeVisible({ timeout: 60000 });
  await expect(page.locator('[data-testid="details-preview"]')).toBeVisible();
  const tablist = page.locator('[data-testid="details-tabs"]');
  await expect(tablist).toBeVisible();
  const overflowAfter = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflowAfter).toBeLessThanOrEqual(1);
  await closeDetailsModal(page);
  const overflowClosed = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflowClosed).toBeLessThanOrEqual(1);
});

test("mobile navigation exposes workspace, profile, support and privacy links", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Compact navigation is only visible at the mobile breakpoint.");
  const menu = page.locator('summary[aria-label="Open navigation"]');
  await expect(menu).toBeVisible();
  await menu.click();
  const links = page.locator('details > div').last();
  await expect(links.getByRole("link", { name: "Workspace" })).toBeVisible();
  await expect(links.getByRole("link", { name: "Profile" })).toBeVisible();
  await expect(links.getByRole("link", { name: "File support" })).toBeVisible();
  await expect(links.getByRole("link", { name: "Privacy" })).toBeVisible();

  await links.getByRole("link", { name: "Profile" }).click();
  await expect(page).toHaveURL(/\/account\/profile\/?$/);
  await expect(page.getByRole("heading", { name: "Your metadata profile" })).toBeVisible();
  const profileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(profileOverflow).toBeLessThanOrEqual(1);
});
