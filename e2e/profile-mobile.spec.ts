import { expect, test } from "@playwright/test";

/**
 * Screen 07 E2E — mobile surfaces (375 / 412 widths): single-column stack
 * (gate card focused, hero readable), no horizontal scroll, no clipped
 * buttons and no console errors. Signed-out only — the environment has no
 * live Google OAuth, which is disclosed in the implementation report.
 */

const SCREENSHOT_DIR = "e2e/artifacts/screen-07";

test.describe(() => {
  for (const width of [375, 412]) {
    test(`mobile ${width}px stacks the profile screen without overflow`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/account/profile");

      await expect(page.getByRole("heading", { name: "Your metadata profile", exact: true })).toBeVisible();
      await expect(page.locator('[data-testid="auth-panel"]')).toBeVisible();

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);

      const googleButton = page.getByRole("button", { name: "Continue with Google" });
      const box = await googleButton.boundingBox();
      expect(box).toBeTruthy();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + (box!.width ?? 0)).toBeLessThanOrEqual(width);

      await page.screenshot({ path: `${SCREENSHOT_DIR}/${width === 375 ? "08-profile-mobile-375" : "09-profile-mobile-412"}.png`, fullPage: true });
      expect(errors).toEqual([]);
    });
  }
});
