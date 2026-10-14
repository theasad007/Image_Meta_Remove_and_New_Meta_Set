import { expect, test, type Page } from "@playwright/test";
import ExifReader from "exifreader";
import { unzipSync } from "fflate";
import fs from "node:fs";
import path from "node:path";
import { fixture, row } from "./helpers";

/**
 * Phase 4 bulk journeys against production static export:
 * Clean All → per-file truth → ZIP → real extraction → re-inspection.
 * No auth, no uploads; every archive is opened, never just downloaded.
 */
test.beforeEach(async ({ page }) => {
  // Headless Chrome exposes showSaveFilePicker, whose native dialog can
  // never complete under automation and would hang the download. Force the
  // Blob-fallback path here; the File System streaming sink itself is
  // covered by unit tests with a mock writable (zip-builder.test.ts).
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w["showSaveFilePicker"];
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  (page as unknown as { __errors: string[] }).__errors = errors;
  await page.goto("/");
});

function tmpFiles(names: string[]): string[] {
  const dir = path.join(__dirname, "artifacts", `bulk-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  fs.mkdirSync(dir, { recursive: true });
  return names.map((name, index) => {
    const source = fs.readFileSync(fixture(name));
    const target = path.join(dir, `${String(index).padStart(4, "0")}-${name}`);
    fs.writeFileSync(target, source);
    return target;
  });
}

async function cleanAllAndWait(page: Page, total: number) {
  await page.locator('[data-testid="batch-clean-all"]').click();
  await expect(page.locator('[data-testid="batch-progress"]')).toContainText(
    new RegExp(`${total} of ${total} files processed`),
    { timeout: 180000 },
  );
}

async function downloadZipEntries(page: Page): Promise<Map<string, Uint8Array>> {
  const downloadPromise = page.waitForEvent("download");
  await page.locator('[data-testid="download-zip"]').click();
  const download = await downloadPromise;
  const outPath = path.join(__dirname, "artifacts", `bulk-${Date.now()}.zip`);
  await download.saveAs(outPath);
  const bytes = fs.readFileSync(outPath);
  const extracted = unzipSync(new Uint8Array(bytes));
  const map = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(extracted)) {
    map.set(name, data as Uint8Array);
  }
  return map;
}

async function expectCleanEntries(entries: Map<string, Uint8Array>, formats: string[]) {
  for (const [name, data] of entries) {
    expect(name.startsWith("images/")).toBe(true);
    expect(name).not.toContain("..");
    const copy = new Uint8Array(data);
    const tags = await ExifReader.load(copy.buffer, { expanded: true, async: true });
    const groups = tags as Record<string, unknown>;
    expect(Object.keys((groups["exif"] as Record<string, unknown>) ?? {}), `${name} exif`).toHaveLength(0);
    expect(Object.keys((groups["xmp"] as Record<string, unknown>) ?? {}), `${name} xmp`).toHaveLength(0);
  }
  expect(entries.size).toBe(formats.length);
}

test("50 mixed images: Clean All → ZIP → extract → re-inspect", async ({ page }) => {
  const formats = ["jpeg-exif.jpg", "png-text-exif.png", "webp-exif-xmp.webp", "avif-exif-xmp.avif", "heic-exif-gps.heic"];
  const paths = tmpFiles(Array.from({ length: 50 }, (_, i) => formats[i % formats.length] as string));
  await page.locator('[data-testid="file-input"]').setInputFiles(paths);
  await expect(page.locator('[data-testid="queue-item"]')).toHaveCount(50);
  await cleanAllAndWait(page, 50);
  const progress = await page.locator('[data-testid="batch-progress"]').textContent();
  expect(progress).toMatch(/50 verified/);
  const entries = await downloadZipEntries(page);
  await expectCleanEntries(entries, paths);
  const names = [...entries.keys()];
  expect(names.some((n) => n.endsWith(".heic"))).toBe(true);
  expect(names.some((n) => n.endsWith(".avif"))).toBe(true);
  await expect(page.locator('[data-testid="zip-ready"]')).toContainText("50 files");
  expect((page as unknown as { __errors: string[] }).__errors).toHaveLength(0);
});

test("partial opt-in: excluded by default, included when checked", async ({ page }) => {
  const paths = tmpFiles(["jpeg-jumbf.jpg", "jpeg-exif.jpg"]);
  await page.locator('[data-testid="file-input"]').setInputFiles(paths);
  await page.locator('[data-testid="batch-clean-all"]').click();
  await expect(page.locator('[data-testid="batch-progress"]')).toContainText(/2 of 2 files processed/, { timeout: 120000 });
  // Default: only the verified file is eligible.
  await expect(page.locator('[data-testid="download-zip"]')).toContainText("(1)");
  // Opt in: both files eligible, partial status still visible in its row.
  await page.locator('[data-testid="zip-include-partials"]').check();
  await expect(page.locator('[data-testid="download-zip"]')).toContainText("(2)");
  await expect(row(page, "jpeg-jumbf.jpg")).toContainText("partially cleaned");
  const entries = await downloadZipEntries(page);
  expect(entries.size).toBe(2);
  expect((page as unknown as { __errors: string[] }).__errors).toHaveLength(0);
});

test("failures never enter the ZIP; retry keeps proven outputs", async ({ page }) => {
  // Keep every fixture image-eligible: unknown binary files intentionally
  // stay review-only and are no longer offered to the cleaning pipeline.
  const paths = tmpFiles(["jpeg-exif.jpg", "jpeg-truncated.jpg", "webp-animated.webp"]);
  await page.locator('[data-testid="file-input"]').setInputFiles(paths);
  await page.locator('[data-testid="batch-clean-all"]').click();
  await expect(page.locator('[data-testid="batch-progress"]')).toContainText(/3 of 3 files processed/, { timeout: 120000 });
  await expect(page.locator('[data-testid="download-zip"]')).toContainText("(1)");
  // Retry the failure: still failed, proven output untouched, no duplicates.
  await page.locator('[data-testid="batch-retry"]').click();
  await expect(page.locator('[data-testid="batch-progress"]')).toContainText(/1 of 1 files processed/, { timeout: 120000 });
  const entries = await downloadZipEntries(page);
  expect(entries.size).toBe(1);
  expect((page as unknown as { __errors: string[] }).__errors).toHaveLength(0);
});

test("duplicate basenames collapse to deterministic unique archive paths", async ({ page }) => {
  const dir = path.join(__dirname, "artifacts", `dup-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  const source = fs.readFileSync(fixture("jpeg-exif.jpg"));
  const sub1 = path.join(dir, "a");
  const sub2 = path.join(dir, "b");
  fs.mkdirSync(sub1, { recursive: true });
  fs.mkdirSync(sub2, { recursive: true });
  fs.writeFileSync(path.join(sub1, "photo.jpg"), source);
  fs.writeFileSync(path.join(sub2, "PHOTO.JPG"), source);
  await page.locator('[data-testid="file-input"]').setInputFiles([path.join(sub1, "photo.jpg"), path.join(sub2, "PHOTO.JPG")]);
  await page.locator('[data-testid="batch-clean-all"]').click();
  await expect(page.locator('[data-testid="batch-progress"]')).toContainText(/2 of 2 files processed/, { timeout: 120000 });
  const entries = await downloadZipEntries(page);
  expect(entries.size).toBe(2);
  const names = [...entries.keys()].sort();
  expect(names[0]).not.toBe(names[1]);
  for (const name of names) {
    expect(name.startsWith("images/")).toBe(true);
    expect(name).not.toContain("..");
  }
  expect((page as unknown as { __errors: string[] }).__errors).toHaveLength(0);
});

test("repeated ZIP generation is stable", async ({ page }) => {
  const paths = tmpFiles(["png-text-exif.png", "webp-exif-xmp.webp"]);
  await page.locator('[data-testid="file-input"]').setInputFiles(paths);
  await page.locator('[data-testid="batch-clean-all"]').click();
  await expect(page.locator('[data-testid="batch-progress"]')).toContainText(/2 of 2 files processed/, { timeout: 120000 });
  const first = await downloadZipEntries(page);
  const second = await downloadZipEntries(page);
  expect([...first.keys()].sort()).toEqual([...second.keys()].sort());
  for (const [name, data] of first) {
    expect(Buffer.compare(Buffer.from(data), Buffer.from(second.get(name) as Uint8Array))).toBe(0);
  }
  expect((page as unknown as { __errors: string[] }).__errors).toHaveLength(0);
});

test("cancel batch mid-run keeps finished work, stops the rest", async ({ page }) => {
  // Pad files so the batch reliably outlasts the cancel click (timing-safe).
  const dir = path.join(__dirname, "artifacts", `cancel-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  const formats = ["jpeg-exif.jpg", "png-text-exif.png", "webp-exif-xmp.webp", "avif-exif-xmp.avif", "heic-exif-gps.heic"];
  const paths: string[] = [];
  for (let i = 0; i < 30; i += 1) {
    const name = formats[i % formats.length] as string;
    const source = fs.readFileSync(fixture(name));
    const target = path.join(dir, `cancel-${String(i).padStart(2, "0")}-${name}`);
    fs.writeFileSync(target, Buffer.concat([source, Buffer.alloc(1024 * 1024)]));
    paths.push(target);
  }
  await page.locator('[data-testid="file-input"]').setInputFiles(paths);
  await page.locator('[data-testid="batch-clean-all"]').click();
  await page.locator('[data-testid="batch-cancel"]').click();
  // Progress must freeze (no advance, no reset) after cancel.
  const reads: Array<string | null> = [];
  for (let i = 0; i < 4; i += 1) {
    await page.waitForTimeout(500);
    reads.push(await page.locator('[data-testid="batch-progress"]').textContent());
  }
  expect(new Set(reads).size).toBe(1);
  const frozen = reads[0] as string;
  expect(frozen).toMatch(/(\d+) of 30 files processed/);
  const done = Number(frozen.match(/(\d+) of 30/)?.[1] ?? "30");
  expect(done).toBeLessThan(30);
  // Retry/finish the remainder via a fresh Clean All.
  await page.locator('[data-testid="batch-clean-all"]').click();
  await expect(page.locator('[data-testid="batch-progress"]')).toContainText(/30 of 30 files processed/, { timeout: 180000 });
  await expect(page.locator('[data-testid="download-zip"]')).toContainText("(30)");
  expect((page as unknown as { __errors: string[] }).__errors).toHaveLength(0);
});
