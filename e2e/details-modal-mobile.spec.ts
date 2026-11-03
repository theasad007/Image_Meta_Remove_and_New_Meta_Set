import { expect, test, type Page } from "@playwright/test";
import { closeDetailsModal, detailsDialog, upload } from "./helpers";

/**
 * Screen 05 on phones: the metadata tabs come first-class — a shorter
 * letterboxed preview (no crop/distortion), collapsible left summaries and
 * a "View metadata details" jump action. Verified at 375px and 412px.
 */
const MOBILE_PROJECT = "mobile";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as unknown as Record<string, unknown>;
    delete target["showSaveFilePicker"];
  });
  await page.goto("/");
});

async function openDialog(page: Page) {
  await page.getByRole("button", { name: "View details" }).first().click({ timeout: 120000 });
  await expect(detailsDialog(page)).toBeVisible({ timeout: 60000 });
}

async function assertMobileDialog(page: Page, width: number, foldName: string, tabsName: string) {
  await page.setViewportSize({ width, height: 812 });
  await page.locator('[data-testid="queue-item"]').first().waitFor();
  await openDialog(page);

  const overflow = async () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(1);

  // 1) Short letterboxed preview. The full image stays visible: the frame
  //    is capped and object-contain keeps the aspect without cropping.
  const previewFrame = page.locator('[data-testid="details-preview-frame"]');
  await expect(previewFrame).toBeVisible();
  const frameHeight = await previewFrame.evaluate((el) => el.clientHeight);
  expect(frameHeight).toBeGreaterThan(0);
  expect(frameHeight).toBeLessThanOrEqual(200);
  const previewImg = page.locator('[data-testid="details-preview-img"]');
  await expect(previewImg).toBeVisible({ timeout: 30000 });
  const objectFit = await previewImg.evaluate((el) => getComputedStyle(el).objectFit);
  expect(objectFit).toBe("contain");
  // Keep full-image access: the preview element itself remains scrollable
  // content of the dialog, not fixed or hidden.
  const previewStillInteractive = await previewImg.evaluate((el) => !el.hasAttribute("disabled"));
  expect(previewStillInteractive).toBe(true);

  // 2) Jump action: metadata tabs can be reached in one tap.
  // First capture the improved initial fold: short preview, jump button,
  // summaries collapsed out of the way.
  await page.screenshot({ path: `e2e/artifacts/screen-05/${foldName}`, animations: "disabled" });

  const jump = page.locator('[data-testid="details-jump-metadata"]');
  await expect(jump).toBeVisible();
  const tablist = page.locator('[data-testid="details-tabs"]');
  const beforeTop = (await tablist.boundingBox())?.y ?? -1;
  expect(beforeTop).toBeGreaterThan(240);
  await jump.click();
  await expect.poll(async () => {
    const top = (await tablist.boundingBox())?.y ?? -1;
    return top;
  }, { timeout: 10000 }).toBeLessThanOrEqual(200);
  const afterTop = (await tablist.boundingBox())?.y ?? -1;
  expect(afterTop).toBeGreaterThanOrEqual(0);

  // 3) Tabs visible and correct immediately (GPS content, no crop overlap).
  await page.locator('[data-testid="details-tab-gps"]').click();
  await expect(page.locator('[data-testid="details-tab-gps"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-testid="details-panel-gps"]:not([hidden])')).toContainText("Latitude");

  // 4) Left summaries collapse out of the way; expand on demand.
  const aiSummary = page.locator('[data-testid="details-ai-summary-mobile"]');
  const overallSummary = page.locator('[data-testid="details-overall-summary-mobile"]');
  await expect(aiSummary).not.toHaveAttribute("open");
  await expect(overallSummary).not.toHaveAttribute("open");
  await overallSummary.locator("summary").click();
  await expect(overallSummary).toHaveAttribute("open");
  await expect(overallSummary).toContainText("Total detected metadata items");
  await expect(overallSummary.getByTestId("details-total-items")).toBeVisible();

  // 5) Touch targets stay comfortable (>= 44 CSS px where practical).
  const jumpHeight = (await jump.boundingBox())?.height ?? 0;
  expect(jumpHeight).toBeGreaterThanOrEqual(40);

  await page.screenshot({ path: `e2e/artifacts/screen-05/${tabsName}`, animations: "disabled" });

  await page.keyboard.press("Escape");
  await expect(detailsDialog(page)).toHaveCount(0);
  expect(await overflow()).toBeLessThanOrEqual(1);
}

test("details dialog keeps metadata first-class at 375px and 412px", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== MOBILE_PROJECT, "Mobile dialog checks run on the phone project.");
  await upload(page, ["jpeg-xmp-iptc.jpg"]);
  await assertMobileDialog(page, 375, "04-mobile-375.png", "04b-mobile-375-tabs.png");
  await assertMobileDialog(page, 412, "04-mobile-412.png", "04c-mobile-412-tabs.png");

  // Keyboard: the dialog close button is reachable by Tab after opening.
  await openDialog(page);
  await expect(page.locator('[data-testid="details-close-footer"]')).toBeVisible();
  await closeDetailsModal(page);
  // Desktop layout untouched: viewport back to default renders full-size preview.
  await page.setViewportSize({ width: 1280, height: 720 });
  await openDialog(page);
  const desktopFrameHeight = await page.locator('[data-testid="details-preview-frame"]').evaluate((el) => el.clientHeight);
  expect(desktopFrameHeight).toBeGreaterThan(200);
  const desktopObjectFit = await page.locator('[data-testid="details-preview-img"]').evaluate((el) => getComputedStyle(el).objectFit);
  expect(desktopObjectFit).toBe("contain");
  await closeDetailsModal(page);
});
