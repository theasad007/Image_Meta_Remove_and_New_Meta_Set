import { expect, test, type Page } from "@playwright/test";
import { cleanRow, inspectRow, row, upload } from "./helpers";

/** Failures must stay per-file: the queue keeps working, nothing crashes. */
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  (page as unknown as { __errors: string[] }).__errors = errors;
  await page.goto("/");
});

async function expectNoPageErrors(page: Page) {
  expect((page as unknown as { __errors: string[] }).__errors).toHaveLength(0);
}

test("spoofed extension is exposed at intake and inspectable by bytes", async ({ page }) => {
  await upload(page, ["spoof-jpg-with-png-bytes.jpg"]);
  // Byte-honest row: PNG label plus an explicit mismatch notice.
  await expect(row(page, "spoof-jpg-with-png-bytes.jpg")).toContainText("PNG");
  await expect(row(page, "spoof-jpg-with-png-bytes.jpg")).toContainText("bytes take precedence");
  await inspectRow(page, "spoof-jpg-with-png-bytes.jpg");
  await expect(page.locator('[data-testid="inspector-panel"]')).toContainText("png");
  await expectNoPageErrors(page);
});

test("corrupt and truncated inputs fail safely without output", async ({ page }) => {
  await upload(page, ["jpeg-truncated.jpg", "random-bytes.bin", "empty-file.bin"]);
  await inspectRow(page, "jpeg-truncated.jpg");
  await expect(page.locator('[data-testid="inspector-panel"]')).toBeVisible();
  await inspectRow(page, "random-bytes.bin");
  await expect(page.locator('[data-testid="inspector-panel"]').first()).toContainText(/failed/i);
  // Corrupt JPEG: cleaning must refuse (no download offered).
  await cleanRow(page, "jpeg-truncated.jpg").catch(() => undefined);
  const panel = page.locator('[data-testid="before-after-panel"]');
  if (await panel.isVisible()) {
    await expect(panel).not.toContainText("verified clean");
    await expect(panel.getByRole("button", { name: /download unavailable/i })).toBeVisible();
  }
  // Queue still usable after failures.
  await upload(page, ["jpeg-empty.jpg"]);
  await expect(row(page, "jpeg-empty.jpg")).toBeVisible();
  await expectNoPageErrors(page);
});

test("animated WebP refuses cleaning, keeps queue alive", async ({ page }) => {
  await upload(page, ["webp-animated.webp"]);
  await inspectRow(page, "webp-animated.webp");
  await row(page, "webp-animated.webp").getByRole("button", { name: "Remove metadata" }).click();
  const panel = page.locator('[data-testid="before-after-panel"]');
  await expect(panel).toContainText("unsupported");
  await expect(panel.getByRole("button", { name: /download unavailable/i })).toBeVisible();
  await expectNoPageErrors(page);
});

test("JUMBF JPEG cleans to an explicitly labeled partial", async ({ page }) => {
  await upload(page, ["jpeg-jumbf.jpg"]);
  await cleanRow(page, "jpeg-jumbf.jpg");
  const panel = page.locator('[data-testid="before-after-panel"]');
  await expect(panel).toContainText("partially cleaned");
  await expect(panel).toContainText(/JUMBF|retained/i);
  await expect(panel.getByRole("button", { name: /download cleaned image/i })).toBeVisible();
  await expectNoPageErrors(page);
});
