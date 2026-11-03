import { expect, test, type Page } from "@playwright/test";
import { row, upload } from "./helpers";

/**
 * Screen 06 on phones: single-column layout with a compact preview,
 * reachable tabs, form fields full width and a usable sticky footer.
 */
const MOBILE_PROJECT = "mobile";
const EDITOR = '[data-testid="editor-modal"]';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as unknown as Record<string, unknown>;
    delete target["showSaveFilePicker"];
  });
  await page.goto("/");
});

async function assertEditorMobile(page: Page, width: number, foldName: string) {
  await page.setViewportSize({ width, height: 812 });
  await page.locator('[data-testid="queue-item"]').first().waitFor();
  await row(page, "jpeg-xmp-iptc.jpg").getByRole("button", { name: /Edit metadata for/ }).first().click({ timeout: 120000 });
  const editor = page.locator(EDITOR);
  await expect(editor).toBeVisible({ timeout: 60000 });

  const overflow = async () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(1);

  // Compact preview on the phone fold.
  const previewFrame = page.locator('[data-testid="editor-preview"]');
  await expect(previewFrame).toBeVisible();
  const previewHeight = await previewFrame.evaluate((el) => el.clientHeight);
  expect(previewHeight).toBeGreaterThan(0);
  expect(previewHeight).toBeLessThanOrEqual(300);

  // Tabs reachable: accessible names and scroll within their own strip.
  const tablist = page.locator('[data-testid="editor-tabs"]');
  await expect(tablist).toBeVisible();
  for (const tabId of ["advanced", "preset"]) {
    await expect(page.locator(`[data-testid="editor-tab-${tabId}"]`)).toBeVisible();
  }
  const tabScrolls = await tablist.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(tabScrolls).toBe(true);

  // Form fields full width and reachable with touch targets.
  const titleInput = page.getByTestId("editor-input-title");
  await titleInput.fill("Mobile Guest Title");
  const titleBox = await titleInput.boundingBox();
  expect(titleBox?.width).toBeGreaterThan(width - 90);

  // Preview changes works, then Apply stays reachable via the footer.
  await page.getByTestId("editor-preview-toggle").click();
  await expect(page.locator('[data-testid="editor-preview-writes"]')).toContainText("Mobile Guest Title");
  await page.getByTestId("editor-preview-toggle").click();
  const footer = page.locator('[data-testid="editor-footer"]');
  await expect(footer).toBeVisible();
  await expect(page.getByTestId("editor-cancel")).toBeVisible();

  await page.screenshot({ path: `e2e/artifacts/screen-06/${foldName}`, animations: "disabled" });

  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  expect(await overflow()).toBeLessThanOrEqual(1);
}

test("edit metadata modal stays usable at 375px and 412px", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== MOBILE_PROJECT, "Mobile editor checks run on the phone project.");
  await upload(page, ["jpeg-xmp-iptc.jpg"]);
  await assertEditorMobile(page, 375, "06-mobile-375.png");
  await assertEditorMobile(page, 412, "06-mobile-412.png");

  // Keyboard + focus: editor close button reachable, focus restored to row.
  await row(page, "jpeg-xmp-iptc.jpg").getByRole("button", { name: /Edit metadata for/ }).first().click({ timeout: 120000 });
  await expect(page.locator(EDITOR)).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId("editor-cancel")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(EDITOR)).toHaveCount(0);
  await expect(row(page, "jpeg-xmp-iptc.jpg").getByRole("button", { name: /Edit metadata for/ }).first()).toBeFocused();
});
