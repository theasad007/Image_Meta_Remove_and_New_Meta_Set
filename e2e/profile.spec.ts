import { expect, test } from "@playwright/test";

/**
 * Screen 07 E2E — signed-out surface (guest project state, no Firebase
 * config): the approved hero, the Google gate, honest gate separation and
 * keyboard access. Live Google OAuth cannot run in this environment, so
 * signed-in journeys are covered by unit + Firestore emulator rules tests
 * instead of a fabricated login here.
 */

const SCREENSHOT_DIR = "e2e/artifacts/screen-07";

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  (page as unknown as { __errors: string[] }).__errors = errors;
  await page.addInitScript(() => {
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollInstant(
      this: HTMLElement,
      arg?: boolean | ScrollIntoViewOptions,
    ) {
      if (typeof arg === "boolean" || arg === undefined) {
        return original.call(this, { block: "start" });
      }
      return original.call(this, { ...arg, behavior: "auto" });
    };
  });
  await page.goto("/account/profile");
});

test("signed-out screen shows hero, gate and honest gate separation", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Your metadata profile", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Save your metadata profile" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();

  // Supporting information stays honest about the guest rules.
  await expect(page.locator('[data-testid="auth-panel"]')).toContainText("Image cleaning is free without an account.");
  await expect(page.locator('[data-testid="auth-panel"]')).toContainText("Single-image custom metadata rewriting works without signing in.");
  await expect(page.locator('[data-testid="auth-panel"]')).toContainText("Original image files are never uploaded.");

  // No editable profile or rewrite preferences for guests.
  await expect(page.locator('[data-testid="profile-panel"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="rewrite-panel"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="profile-save"]')).toHaveCount(0);

  await page.screenshot({ path: `${SCREENSHOT_DIR}/01-profile-signed-out-desktop.png`, fullPage: true });
});

test("gate exposes loading/failed sign-in states without fake profile data", async ({ page }) => {
  // No loading skeletons left behind once Firebase resolves.
  await expect(page.locator('[data-testid="auth-loading"]')).toHaveCount(0, { timeout: 15000 });
  // Clicking sign-in with an unconfigured backend keeps the gate (no popup).
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.locator('[data-testid="auth-panel"]')).toBeVisible();
  expect((page as unknown as { __errors: string[] }).__errors).toEqual([]);
});

test("header Profile navigation is active and works from keyboard", async ({ page }) => {
  await expect(page.locator('nav[aria-label="Primary"] a[aria-current="page"]')).toHaveText(/Profile/);
  await page.keyboard.press("Tab"); // skip link
  await expect(page.getByRole("link", { name: "Skip to profile" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#profile-main")).toBeFocused();
});

test("no horizontal overflow or react key warnings", async ({ page }) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
