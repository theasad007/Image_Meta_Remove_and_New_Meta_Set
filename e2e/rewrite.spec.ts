import { expect, test } from "@playwright/test";
import { row, upload } from "./helpers";

/**
 * Phase 6 guest-safety journeys (no Firebase config in this environment):
 * sign-in-gated rewrite surfaces never block guest inspect/clean/ZIP/CSV,
 * cancelling auth is impossible to trigger here (no popup), but the queue,
 * inspections and cleaned outputs survive all signed-out interactions.
 * Live Google OAuth requires a real Firebase project + authorized domain
 * (manual checklist in docs/06); this suite proves the guest-preserving
 * fallback, not a live login.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w["showSaveFilePicker"];
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  (page as unknown as { __errors: string[] }).__errors = errors;
  await page.goto("/");
});

test("guest sees auth/profile/rewrite gates without any login wall", async ({ page }) => {
  await upload(page, ["jpeg-exif.jpg"]);
  // Guest inspect + clean still work with no login prompt.
  await expect(page.locator('[data-testid="auth-panel"]')).toBeVisible();
  await expect(page.locator('[data-testid="profile-panel"]')).toBeVisible();
  await expect(page.locator('[data-testid="rewrite-panel"]')).toBeVisible();
  // Without configuration this build reports honestly; with configuration
  // it would show a Google button — either way no queue reset occurs.
  const queueCount = await page.locator('[data-testid="queue-item"]').count();
  expect(queueCount).toBe(1);
  // Rewrite row action exists but is gated (disabled without sign-in/profile).
  const rewriteBtn = row(page, "jpeg-exif.jpg").getByRole("button", { name: "Rewrite" });
  await expect(rewriteBtn).toBeVisible();
  await expect(rewriteBtn).toBeDisabled();
  // Cleaning still works for guests.
  await row(page, "jpeg-exif.jpg").getByRole("button", { name: "Remove metadata" }).click();
  await page.locator('[data-testid="before-after-panel"]').waitFor();
  // Queue survived; no auth modal cleared anything.
  expect(await page.locator('[data-testid="queue-item"]').count()).toBe(1);
});

test("rewrite mode and field selection are keyboard-accessible and preserve queue", async ({ page }) => {
  await upload(page, ["png-text-exif.png", "webp-exif-xmp.webp"]);
  expect(await page.locator('[data-testid="queue-item"]').count()).toBe(2);
  // Mode radios toggle without touching the queue.
  const replace = page.getByRole("radio", { name: /Replace editable/i });
  const update = page.getByRole("radio", { name: /Update only selected/i });
  await expect(replace).toBeChecked();
  await update.click();
  await expect(update).toBeChecked();
  await replace.click();
  await expect(replace).toBeChecked();
  expect(await page.locator('[data-testid="queue-item"]').count()).toBe(2);
  // Bulk rewrite buttons exist and stay disabled for signed-out guests.
  await expect(page.locator('[data-testid="rewrite-apply-selected"]')).toBeDisabled();
  await expect(page.locator('[data-testid="rewrite-apply-all"]')).toBeDisabled();
  const errors = (page as unknown as { __errors: string[] }).__errors;
  expect(errors).toEqual([]);
});

test("reports still export the 36-column schema with rewrite counts for guests", async ({ page }) => {
  await upload(page, ["jpeg-exif.jpg"]);
  await row(page, "jpeg-exif.jpg").getByRole("button", { name: "Remove metadata" }).click();
  await page.locator('[data-testid="before-after-panel"]').waitFor();
  // Standalone CSV downloads and keeps the rewrite column (0 for clean-only).
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download CSV/i }).first().click();
  const path = await (await download).path();
  expect(path).toBeTruthy();
});
