import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fixture } from "./helpers";

/**
 * Scale evidence in a real desktop browser (acceptance §2/§7):
 * 100 and 1,000+ small genuine files with elapsed time and JS heap
 * readings where the browser exposes them. No count cap anywhere.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w["showSaveFilePicker"];
  });
  await page.goto("/");
});

async function heapMB(page: import("@playwright/test").Page): Promise<number | null> {
  const value = await page.evaluate(() => {
    const memory = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory;
    return typeof memory?.usedJSHeapSize === "number" ? memory.usedJSHeapSize : null;
  });
  return value === null ? null : value / 1048576;
}

async function runScaledBatch(page: import("@playwright/test").Page, count: number) {
  const dir = path.join(__dirname, "artifacts", `scale-${count}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  const formats = ["jpeg-exif.jpg", "png-text-exif.png", "webp-exif-xmp.webp", "avif-exif-xmp.avif", "heic-exif-gps.heic"];
  const paths: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const name = formats[i % formats.length] as string;
    const target = path.join(dir, `img-${String(i).padStart(5, "0")}-${name}`);
    fs.copyFileSync(fixture(name), target);
    paths.push(target);
  }
  await page.locator('[data-testid="file-input"]').setInputFiles(paths);
  await expect(page.locator('[data-testid="queue-item"]')).toHaveCount(count, { timeout: 120000 });
  const heapBefore = await heapMB(page);
  const started = Date.now();
  await page.locator('[data-testid="batch-clean-all"]').click();
  await expect(page.locator('[data-testid="batch-progress"]')).toContainText(
    new RegExp(`${count} of ${count} files processed`),
    { timeout: 600000 },
  );
  const elapsedMs = Date.now() - started;
  const heapAfter = await heapMB(page);
  const progress = await page.locator('[data-testid="batch-progress"]').textContent();
  process.stderr.write(`browser-scale/${count}: ${elapsedMs}ms heapBefore=${heapBefore?.toFixed(1) ?? "n/a"}MB heapAfter=${heapAfter?.toFixed(1) ?? "n/a"}MB :: ${progress}\n`);
  return { elapsedMs, heapBefore, heapAfter, progress: progress ?? "" };
}

test("100 mixed images in-browser with timing + heap", async ({ page }) => {
  const { progress } = await runScaledBatch(page, 100);
  expect(progress).toMatch(/100 verified/);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  expect(errors).toHaveLength(0);
});

test("1000+ small images in-browser with timing + heap", async ({ page }) => {
  test.setTimeout(600000);
  const { progress } = await runScaledBatch(page, 1000);
  expect(progress).toMatch(/1000 verified/);
});
