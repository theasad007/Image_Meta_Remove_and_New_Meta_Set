import { expect, test, type Page } from "@playwright/test";
import ExifReader from "exifreader";
import fs from "node:fs";
import path from "node:path";
import { cleanRow, fixture, inspectRow, row, upload } from "./helpers";

/**
 * Real browser journeys: upload → inspect → remove → before/after →
 * download → independent re-inspection of the downloaded bytes.
 * Every download is re-opened and re-read — UI badges alone prove nothing.
 */
test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

async function downloadCleaned(page: Page, name: string) {
  const downloadPromise = page.waitForEvent("download");
  await page.locator('[data-testid="download-cleaned"]').click();
  const download = await downloadPromise;
  const outPath = path.join(__dirname, "artifacts", `dl-${Date.now()}-${name}`);
  await download.saveAs(outPath);
  return outPath;
}

async function expectNoMetadata(filePath: string, groups: string[]) {
  const buffer = fs.readFileSync(filePath);
  const copy = new Uint8Array(buffer);
  const tags = await ExifReader.load(copy.buffer, { expanded: true, async: true });
  for (const group of groups) {
    expect(
      Object.keys((tags as Record<string, unknown>)[group] as Record<string, unknown> ?? {}),
      `${group} must be absent in ${path.basename(filePath)}`,
    ).toHaveLength(0);
  }
}

test("JPEG journey with independent download verification", async ({ page }) => {
  await upload(page, ["jpeg-xmp-iptc.jpg"]);
  await inspectRow(page, "jpeg-xmp-iptc.jpg");
  const panel = page.locator('[data-testid="inspector-panel"]');
  await expect(panel).toContainText("TestCam");
  await expect(panel).toContainText("Harbor Noon");
  await page.screenshot({ path: "e2e/artifacts/journey-inspector.jpg" });
  await cleanRow(page, "jpeg-xmp-iptc.jpg");
  const result = page.locator('[data-testid="before-after-panel"]');
  await expect(result).toContainText("verified clean");
  await expect(result).toContainText("APP1 Exif segment");
  const saved = await downloadCleaned(page, "xmp-iptc.jpg");
  await expectNoMetadata(saved, ["exif", "xmp", "iptc", "gps"]);
});

test("PNG journey with independent download verification", async ({ page }) => {
  await upload(page, ["png-text-exif.png"]);
  await inspectRow(page, "png-text-exif.png");
  await expect(page.locator('[data-testid="inspector-panel"]')).toContainText("Synthetic PNG Title");
  await cleanRow(page, "png-text-exif.png");
  await expect(page.locator('[data-testid="before-after-panel"]')).toContainText("verified clean");
  const saved = await downloadCleaned(page, "text-exif.png");
  await expectNoMetadata(saved, ["exif", "xmp"]);
});

test("WebP journey with independent download verification", async ({ page }) => {
  await upload(page, ["webp-exif-xmp.webp"]);
  await inspectRow(page, "webp-exif-xmp.webp");
  await cleanRow(page, "webp-exif-xmp.webp");
  await expect(page.locator('[data-testid="before-after-panel"]')).toContainText("verified clean");
  const saved = await downloadCleaned(page, "exif-xmp.webp");
  await expectNoMetadata(saved, ["exif", "xmp"]);
});

test("AVIF journey with independent download verification", async ({ page }) => {
  await upload(page, ["avif-exif-xmp.avif"]);
  await inspectRow(page, "avif-exif-xmp.avif");
  await expect(page.locator('[data-testid="inspector-panel"]')).toContainText("TestCam");
  await cleanRow(page, "avif-exif-xmp.avif");
  await expect(page.locator('[data-testid="before-after-panel"]')).toContainText("verified clean");
  const saved = await downloadCleaned(page, "exif-xmp.avif");
  await expectNoMetadata(saved, ["exif", "xmp"]);
});

test("HEIC journey includes a locally decoded preview", async ({ page }) => {
  await upload(page, ["heic-real-encoder.heic"]);
  const preview = row(page, "heic-real-encoder.heic").locator("img");
  await expect.poll(async () => preview.evaluate((image: HTMLImageElement) => image.naturalWidth), { timeout: 60000 }).toBeGreaterThan(0);
  await expect(row(page, "heic-real-encoder.heic")).not.toContainText("cannot render this image inline");
  await expect(row(page, "heic-real-encoder.heic")).not.toContainText("corrupt");
  await inspectRow(page, "heic-real-encoder.heic");
  await expect(page.locator('[data-testid="inspector-panel"]')).toContainText("RealCam");
  await cleanRow(page, "heic-real-encoder.heic");
  const result = page.locator('[data-testid="before-after-panel"]');
  await expect(result).toContainText("verified clean");
  await page.screenshot({ path: "e2e/artifacts/journey-before-after.png" });
  const saved = await downloadCleaned(page, "real-encoder.heic");
  await expectNoMetadata(saved, ["exif", "xmp"]);
  expect(fixture("heic-real-encoder.heic")).toBeTruthy();
});
