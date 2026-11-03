import { expect, test } from "@playwright/test";
import { upload } from "./helpers";

/**
 * Focused signup/optional-document regression coverage. This file is run only
 * inside `firebase emulators:exec` with an emulator-configured static build;
 * it is intentionally not part of the production Premium suite.
 */
const RUN = process.env.RUN_EMULATOR_E2E === "1";

test.skip(!RUN, "Needs RUN_EMULATOR_E2E=1 with an emulator-flagged build and local Auth/Firestore emulators.");

async function signIn(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/account/profile");
  await page.getByTestId("auth-signin").click();
  await expect(page.getByTestId("auth-account-connected")).toBeVisible({ timeout: 30000 });
}

test("new user creates its directory/profile and keeps the UID-scoped profile workflow", async ({ page }) => {
  await signIn(page);
  await expect(page.getByTestId("profile-status")).toHaveText("Not saved");
  await page.fill("#profile-field-creator", "New User Creator");
  await page.fill("#profile-field-title", "New User Title");
  await page.getByTestId("profile-save").click();
  await expect(page.getByTestId("profile-status")).toHaveText("Saved", { timeout: 30000 });
  await expect(page.getByTestId("profile-updated")).toContainText("Last updated");
});

test("missing optional entitlement/policy documents use safe defaults and leave free cleaning available", async ({ page }) => {
  await signIn(page);
  await page.goto("/");
  await upload(page, ["jpeg-empty.jpg", "png-empty.png"]);

  await page.getByTestId("open-rewrite-workflow").click();
  await expect(page.getByTestId("batch-rewrite-dialog")).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("batch-rewrite-locked")).toBeVisible({ timeout: 30000 });
  await page.getByTestId("batch-rewrite-close").click();
  await expect(page.getByTestId("batch-rewrite-dialog")).toHaveCount(0);

  await page.getByTestId("batch-clean-all").click();
  await expect(page.getByTestId("queue-announcement").filter({ hasText: /removal finished/i }).first()).toBeVisible({ timeout: 240000 });
});
