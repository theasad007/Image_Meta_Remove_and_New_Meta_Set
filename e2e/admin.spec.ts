import { expect, test } from "@playwright/test";
import { upload } from "./helpers";

/**
 * Phase 6A authorization-gate journeys (unconfigured Firebase in CI):
 * the homepage shows NO standalone Google sign-in button (removed on
 * request in the Screen-01 final polish; auth lives on the Profile
 * page), no Admin link leaks to signed-out users, /admin denies without
 * a claim, and every gate preserves the guest queue. Live OAuth + claim
 * promotion require owner configuration (docs/10-admin-setup.md) and are
 * NOT faked here.
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

test("hero has no standalone Google sign-in button and no admin link for guests", async ({ page }) => {
  await expect(page.locator('[data-testid="hero-auth-cta"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="hero-admin-link"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="auth-admin-link"]')).toHaveCount(0);
  const errors = (page as unknown as { __errors: string[] }).__errors;
  expect(errors).toEqual([]);
});

test("guest queue survives auth-gate interactions", async ({ page }) => {
  await upload(page, ["jpeg-exif.jpg"]);
  expect(await page.locator('[data-testid="queue-item"]').count()).toBe(1);
  // The toolbar may open the honest sign-in/profile bridge, but does not
  // expose an unimplemented guest rewrite action.
  await expect(page.getByRole("button", { name: /Remove & Rewrite/i })).toBeEnabled({ timeout: 120000 });
  expect(await page.locator('[data-testid="queue-item"]').count()).toBe(1);
});

test("visiting /admin without a claim is denied (route guard, no user list)", async ({ page }) => {
  // Static export uses a trailing-slash directory so direct refreshes work
  // on simple hosts as well as Cloudflare Pages.
  await page.goto("/admin/");
  await expect(page.locator('[data-testid="admin-denied"]')).toBeVisible();
  await expect(page.locator('[data-testid="admin-user-list"]')).toHaveCount(0);
  const errors = (page as unknown as { __errors: string[] }).__errors;
  expect(errors).toEqual([]);
});
