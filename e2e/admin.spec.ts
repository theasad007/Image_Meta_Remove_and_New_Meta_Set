import { expect, test } from "@playwright/test";
import { row, upload } from "./helpers";

/**
 * Phase 6A authorization-gate journeys (unconfigured Firebase in CI):
 * the hero shows the Google CTA (disabled-honest without config), no
 * Admin link leaks to signed-out users, /admin denies without a claim,
 * and every gate preserves the guest queue. Live OAuth + claim promotion
 * require owner configuration (docs/10-admin-setup.md) and are NOT
 * faked here.
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

test("hero shows the Google sign-in CTA and no admin link for guests", async ({ page }) => {
  const cta = page.locator('[data-testid="hero-auth-cta"]');
  await expect(cta).toBeVisible();
  await expect(cta.getByText(/Sign in \/ Sign up with Google/i)).toBeVisible();
  await expect(page.locator('[data-testid="hero-admin-link"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="auth-admin-link"]')).toHaveCount(0);
  const errors = (page as unknown as { __errors: string[] }).__errors;
  expect(errors).toEqual([]);
});

test("guest queue survives auth-gate interactions", async ({ page }) => {
  await upload(page, ["jpeg-exif.jpg"]);
  expect(await page.locator('[data-testid="queue-item"]').count()).toBe(1);
  // Rewrite stays gated for signed-out guests.
  await expect(row(page, "jpeg-exif.jpg").getByRole("button", { name: "Rewrite" })).toBeDisabled();
  expect(await page.locator('[data-testid="queue-item"]').count()).toBe(1);
});

test("visiting /admin without a claim is denied (route guard, no user list)", async ({ page }) => {
  // Static export serves this route as admin.html (Hostinger resolves the
  // extensionless /admin path the same way); both load the same bundle.
  await page.goto("/admin.html");
  await expect(page.locator('[data-testid="admin-denied"]')).toBeVisible();
  await expect(page.locator('[data-testid="admin-user-list"]')).toHaveCount(0);
  const errors = (page as unknown as { __errors: string[] }).__errors;
  expect(errors).toEqual([]);
});
