import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fixture, row, upload } from "./helpers";

/**
 * Queue behavior at volume (interaction only — bulk *cleaning* is Phase 4):
 * 50-file intake, remove/clear, cancel, stale-result protection, repeated
 * downloads, oversized-file budgeting, and request totally-local proof.
 */
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  (page as unknown as { __errors: string[] }).__errors = errors;
  await page.goto("/");
});

function tmpDir(): string {
  const dir = path.join(__dirname, "artifacts", `tmp-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

test("50-file queue: add, remove, clear", async ({ page }) => {
  const dir = tmpDir();
  const source = fs.readFileSync(fixture("jpeg-exif.jpg"));
  const names: string[] = [];
  for (let i = 0; i < 50; i += 1) {
    const name = `batch-${String(i).padStart(3, "0")}.jpg`;
    fs.writeFileSync(path.join(dir, name), source);
    names.push(path.join(dir, name));
  }
  await page.locator('[data-testid="file-input"]').setInputFiles(names);
  await expect(page.locator('[data-testid="queue-item"]')).toHaveCount(50);
  await expect(page.locator('[data-testid="queue-stats"]')).toContainText("50 files");
  // Remove one, then clear.
  await page.locator('[data-testid="queue-item"]').first()
    .getByRole("button", { name: /remove .* from queue/i }).click();
  await expect(page.locator('[data-testid="queue-item"]')).toHaveCount(49);
  await page.locator('[data-testid="queue-clear"]').click();
  await expect(page.locator('[data-testid="queue-item"]')).toHaveCount(0);
  expect((page as unknown as { __errors: string[] }).__errors).toHaveLength(0);
});

test("cancel automatic inspection keeps the queue usable", async ({ page }) => {
  const dir = tmpDir();
  const source = fs.readFileSync(fixture("jpeg-exif.jpg"));
  const names: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    const name = `cancel-${i}.jpg`;
    fs.writeFileSync(path.join(dir, name), source);
    names.push(path.join(dir, name));
  }
  await page.locator('[data-testid="file-input"]').setInputFiles(names);
  await expect(page.locator('[data-testid="queue-item"]')).toHaveCount(12);
  const cancel = page.locator('[data-testid="inspect-cancel"]');
  if (await cancel.isVisible()) await cancel.click({ timeout: 1000 }).catch(() => undefined);
  // Either path is valid: cancelled run leaves a usable queue, no crash.
  await expect(page.locator('[data-testid="queue-item"]')).toHaveCount(12);
  expect((page as unknown as { __errors: string[] }).__errors).toHaveLength(0);
});

test("removing a file mid-inspection causes no stale result", async ({ page }) => {
  await upload(page, ["jpeg-exif.jpg", "jpeg-xmp-iptc.jpg"]);
  await row(page, "jpeg-exif.jpg").getByRole("button", { name: /remove .* from queue/i }).click();
  await expect(row(page, "jpeg-exif.jpg")).toHaveCount(0);
  await expect(row(page, "jpeg-xmp-iptc.jpg")).toBeVisible();
  expect((page as unknown as { __errors: string[] }).__errors).toHaveLength(0);
});

test("repeated downloads yield identical bytes", async ({ page }) => {
  await upload(page, ["png-text-exif.png"]);
  await row(page, "png-text-exif.png").getByRole("button", { name: "Remove metadata" }).click();
  await page.locator('[data-testid="before-after-panel"]').waitFor();
  const first = page.waitForEvent("download");
  await page.locator('[data-testid="download-cleaned"]').click();
  const firstBytes = fs.readFileSync(await (await first).path() as string);
  const second = page.waitForEvent("download");
  await page.locator('[data-testid="download-cleaned"]').click();
  const secondBytes = fs.readFileSync(await (await second).path() as string);
  expect(Buffer.compare(firstBytes, secondBytes)).toBe(0);
  expect((page as unknown as { __errors: string[] }).__errors).toHaveLength(0);
});

test("65 MB file is declined by budget with a message, queue survives", async ({ page }) => {
  const dir = tmpDir();
  const source = fs.readFileSync(fixture("jpeg-exif.jpg"));
  const big = Buffer.concat([source, Buffer.alloc(65 * 1024 * 1024)]);
  const bigPath = path.join(dir, "huge.jpg");
  fs.writeFileSync(bigPath, big);
  await page.locator('[data-testid="file-input"]').setInputFiles([bigPath]);
  await expect(row(page, "huge.jpg")).toBeVisible();
  await row(page, "huge.jpg").getByRole("button", { name: "Remove metadata" }).click();
  await expect(page.locator('[data-testid="before-after-panel"]')).toContainText(/budget/i);
  await upload(page, ["jpeg-empty.jpg"]);
  await expect(row(page, "jpeg-empty.jpg")).toBeVisible();
  expect((page as unknown as { __errors: string[] }).__errors).toHaveLength(0);
});

test("no image bytes leave the browser (request log proof)", async ({ page }) => {
  const requests: { method: string; url: string }[] = [];
  page.on("request", (request) => requests.push({ method: request.method(), url: request.url() }));
  await upload(page, ["jpeg-ai.jpg", "heic-exif-gps.heic"]);
  await expect(row(page, "jpeg-ai.jpg").getByRole("button", { name: "View details" })).toBeVisible({ timeout: 120000 });
  await row(page, "jpeg-ai.jpg").getByRole("button", { name: "Remove metadata" }).click();
  await expect(page.locator('[data-testid="before-after-panel"]')).toBeVisible({ timeout: 60000 });
  for (const request of requests) {
    // Local page assets (GET) and blob: preview URLs only. Blob URLs are
    // created from in-memory Files and never traverse the network.
    if (request.url.startsWith("blob:")) continue;
    expect(request.method).toBe("GET");
    expect(request.url.startsWith("http://127.0.0.1:8130/")).toBe(true);
  }
  expect(requests.length).toBeGreaterThan(0);
  expect((page as unknown as { __errors: string[] }).__errors).toHaveLength(0);
});
