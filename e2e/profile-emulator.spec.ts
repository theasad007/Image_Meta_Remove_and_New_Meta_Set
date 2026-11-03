import { expect, test } from "@playwright/test";
import { row, upload } from "./helpers";

/**
 * Screen 07 E2E — authenticated + Firestore flows against the REAL local
 * emulators (never stubs, never the production project).
 *
 * Run only when ALL of these hold:
 *   1. the static export was built with NEXT_PUBLIC_FIREBASE_EMULATOR=1
 *      (build-time inlined flag),
 *   2. `RUN_EMULATOR_E2E=1` is set while
 *      `npx firebase-tools emulators:exec --only auth,firestore`
 *      wraps this suite (FIREBASE_AUTH + Firestore emulators on 9099/8080).
 *
 * Otherwise the suite skips explicitly — it never fakes a signed-in state.
 */

const RUN = process.env.RUN_EMULATOR_E2E === "1";
const SCREENSHOT_DIR = "e2e/artifacts/screen-07";
const EDITOR = '[data-testid="editor-modal"]';

test.skip(!RUN, "Needs RUN_EMULATOR_E2E=1 with an emulator-flagged build and firebase emulators active.");

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  (page as unknown as { __errors: string[] }).__errors = errors;
  await page.goto("/account/profile");
});

/** Emulator sign-in via the app's real "Continue with Google" button. */
async function signIn(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Continue with Google" }).click();
  const account = page.locator('[data-testid="auth-account"]');
  await expect(account).toBeVisible({ timeout: 30000 });
  return account;
}

/** Full-page captures must not inherit scroll/focus state (sticky header
 *  stitch artifacts, focused skip-link pill). The app styles html with
 *  scroll-behavior:smooth, so the scroll itself must be instant. */
async function resetViewport(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    (document.activeElement as HTMLElement | null)?.blur?.();
  });
  await page.waitForTimeout(120);
}

test("signs in, shows an empty profile, saves and reloads the saved values", async ({ page }) => {
  await signIn(page);

  // Signed-in desktop state with a genuinely empty profile.
  await expect(page.locator('[data-testid="profile-status"]')).toHaveText("Not saved");
  await expect(page.locator('[data-testid="profile-preview"]')).toContainText("Not set");
  await resetViewport(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/02-profile-signed-in-desktop.png`, fullPage: true });

  // Fill real values.
  await page.fill("#profile-field-company", "Muse Publishing House");
  await page.fill("#profile-field-creator", "A. Photographer");
  await page.fill("#profile-field-copyright", "© 2026 A. Photographer. All rights reserved.");
  await page.fill("#profile-field-rightsOwner", "A. Photographer");
  await page.fill("#profile-field-website", "https://photographer.example.com");
  await page.fill("#profile-field-contact", "studio@photographer.example.com");
  await page.fill("#profile-field-title", "Harbor at noon");
  await page.fill("#profile-field-description", "A harbor scene captured at midday.");
  const keywords = page.locator("#profile-field-keywords");
  await keywords.fill("photography, landscape");
  await keywords.press("Enter");
  await keywords.fill("nature, travel,");
  await keywords.press("Enter");
  await expect(page.locator('[data-testid="profile-keyword-chip"]')).toHaveCount(4);

  // Draft states are honest before saving.
  await expect(page.locator('[data-testid="profile-status"]')).toHaveText("Unsaved changes");
  await expect(page.locator('[data-testid="profile-preview-source"]')).toContainText("Previewing unsaved changes");
  await expect(page.locator('[data-testid="profile-preview-row-creator"]')).toContainText("A. Photographer");
  await resetViewport(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/03-profile-form-filled.png`, fullPage: true });
  await page.locator('[data-testid="profile-preview"]').screenshot({ path: `${SCREENSHOT_DIR}/05-profile-live-preview.png` });

  // Save: Firestore-confirmed status with an authoritative timestamp.
  await page.locator('[data-testid="profile-save"]').click();
  await expect(page.locator('[data-testid="profile-status"]')).toHaveText("Saved", { timeout: 30000 });
  await expect(page.locator('[data-testid="profile-updated"]')).toContainText("Last updated");
  await expect(page.locator('[data-testid="profile-preview-source"]')).toContainText("Saved profile preview");
  await resetViewport(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/04-profile-saved-success.png`, fullPage: true });

  // Reload: Firestore is the source of truth, not browser memory.
  await page.reload();
  await resetViewport(page);
  await expect(page.locator('[data-testid="profile-status"]')).toHaveText("Saved", { timeout: 30000 });
  await expect(page.locator("#profile-field-creator")).toHaveValue("A. Photographer");
  await expect(page.locator('[data-testid="profile-keyword-chip"]')).toHaveCount(4);

  // Rewrite preferences section from the reference navigation.
  await page.locator('[data-testid="profile-nav-preferences"]').click();
  await expect(page.locator('[data-testid="rewrite-panel"]')).toBeVisible();
  await page.locator('[data-testid="rewrite-panel"]').screenshot({ path: `${SCREENSHOT_DIR}/06-profile-rewrite-preferences.png` });

  // Connected account section.
  await page.locator('[data-testid="profile-nav-account"]').click();
  await expect(page.locator('[data-testid="auth-account-connected"]')).toBeVisible();
  await page.locator('#connected-account').screenshot({ path: `${SCREENSHOT_DIR}/07-profile-connected-account.png` });

  expect((page as unknown as { __errors: string[] }).__errors).toEqual([]);
});

test("surfaces per-field validation errors and refuses to save invalid values", async ({ page }) => {
  await signIn(page);
  await expect(page.locator('[data-testid="profile-status"]')).toHaveText("Saved", { timeout: 30000 });

  await page.fill("#profile-field-website", "ftp://photographer.example.com");
  await expect(page.locator('[data-testid="profile-error-website"]', { hasText: /http/ })).toBeVisible();

  // A single keyword above the 60-character ceiling is rejected by the chip editor.
  await page.fill("#profile-field-keywords", "x".repeat(70));
  await page.locator("#profile-field-keywords").press("Enter");
  await expect(page.locator('[data-testid="profile-keyword-alert"]')).toContainText(/60 characters or fewer/);

  // The save is refused while the errors are present; the draft survives.
  await expect(page.locator('[data-testid="profile-status"]')).toHaveText("Unsaved changes");
  await page.locator('[data-testid="profile-save"]').click();
  await expect(page.locator('[data-testid="profile-save-error"]')).toContainText(/Fix the highlighted field errors/);
  await resetViewport(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/10-profile-validation-errors.png`, fullPage: true });
  expect((page as unknown as { __errors: string[] }).__errors).toEqual([]);
});

test("Screen 06 reads the real Firestore profile as its saved-profile source", async ({ page }) => {
  await signIn(page);
  await expect(page.locator('[data-testid="profile-status"]')).toHaveText("Saved", { timeout: 30000 });

  await page.goto("/");
  await upload(page, ["jpeg-exif.jpg"]);
  await row(page, "jpeg-exif.jpg").getByRole("button", { name: /Edit metadata for/ }).first().click({ timeout: 120000 });
  await expect(page.locator(EDITOR)).toBeVisible();
  await page.locator('[data-testid="editor-tab-preset"]').click();

  // The saved profile source is usable and shows the real saved values.
  const source = page.locator('[data-testid="editor-source"]');
  await expect(source).toBeVisible();
  const profileRadio = source.locator('input[type="radio"]').nth(1);
  await expect(profileRadio).toBeEnabled();
  await profileRadio.check();
  await expect(page.locator('[data-testid="editor-profile-preview"]')).toContainText("A. Photographer");
  await expect(page.locator('[data-testid="editor-profile-preview"]')).toContainText("Muse Publishing House");
  await page.locator('[data-testid="editor-panel-preset"]').screenshot({ path: `${SCREENSHOT_DIR}/12-screen06-saved-profile-integration.png` });

  // Guest isolation: the custom source remains available and independent.
  await source.locator('input[type="radio"]').nth(0).check();
  await expect(page.locator('[data-testid="editor-source"]')).toContainText("Custom values for this image");
});

test("delete saved profile uses a confirmation dialog and clears the account copy", async ({ page }) => {
  await signIn(page);
  await expect(page.locator('[data-testid="profile-status"]')).toHaveText("Saved", { timeout: 30000 });

  await page.locator('[data-testid="profile-delete"]').click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Delete your saved metadata profile?");
  await expect(dialog).toContainText("Images already downloaded will not change.");
  await page.screenshot({ path: `${SCREENSHOT_DIR}/11-profile-delete-confirmation.png` });

  // Escape cancels first.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-testid="profile-status"]')).toHaveText("Saved");

  // Confirm deletes only this user's Firestore document.
  await page.locator('[data-testid="profile-delete"]').click();
  await page.locator('[data-testid="profile-confirm-action"]').click();
  await expect(page.locator('[data-testid="profile-status"]')).toHaveText("Not saved", { timeout: 30000 });
  await expect(page.locator("#profile-field-creator")).toHaveValue("");
  await expect(page.locator('[data-testid="profile-delete"]')).toBeDisabled();

  // A reload reads Firestore: genuinely empty, never a stale draft.
  await page.reload();
  await expect(page.locator('[data-testid="auth-account"]')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-testid="profile-status"]')).toHaveText("Not saved", { timeout: 30000 });
  expect((page as unknown as { __errors: string[] }).__errors).toEqual([]);
});
