import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { fixture } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("whole dropzone and browse text open the native picker", async ({ page }) => {
  const firstChooser = page.waitForEvent("filechooser");
  await page.locator('[data-testid="upload-dropzone"]').click({ position: { x: 24, y: 24 } });
  await (await firstChooser).setFiles(fixture("jpeg-exif.jpg"));
  await expect(page.locator('[data-testid="queue-item"]')).toHaveCount(1);

  // The input resets after selection, so choosing the same local file again
  // is a real second action rather than a browser no-op.
  const secondChooser = page.waitForEvent("filechooser");
  await page.locator('[data-testid="upload-choose"]').click();
  await (await secondChooser).setFiles(fixture("jpeg-exif.jpg"));
  await expect(page.locator('[data-testid="queue-item"]')).toHaveCount(2);
});

test("dragging an actual file onto the visible surface queues it", async ({ page }) => {
  const bytes = Array.from(fs.readFileSync(fixture("png-text-exif.png")));
  const dataTransfer = await page.evaluateHandle((fileBytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(fileBytes)], "dropped-image.png", { type: "image/png" }));
    return transfer;
  }, bytes);
  const dropzone = page.locator('[data-testid="upload-dropzone"]');
  await dropzone.dispatchEvent("dragenter", { dataTransfer });
  await expect(dropzone).toContainText("Release to add your files");
  await dropzone.dispatchEvent("dragover", { dataTransfer });
  await dropzone.dispatchEvent("drop", { dataTransfer });
  await expect(page.locator('[data-testid="queue-item"]', { hasText: "dropped-image.png" })).toHaveCount(1);
  await expect(page.locator('[data-testid="upload-feedback"]')).toContainText("added to your private queue");
});
