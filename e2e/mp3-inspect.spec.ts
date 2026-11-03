import { expect, test } from "@playwright/test";
import { row, upload } from "./helpers";

/**
 * Phase 07 E2E — MP3 as a first-class format: byte-honest detection,
 * audio-centric inspection, local playback preview, honest unsupported
 * labeling. Inspection only — cleaning/rewrite land in Phases 09–10.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as unknown as Record<string, unknown>;
    delete target["showSaveFilePicker"];
  });
  await page.goto("/");
});

test("MP3 files are detected, auto-inspected and playable locally", async ({ page }) => {
  await upload(page, ["mp3-id3v2.3.mp3", "jpeg-empty.jpg"]);
  const mp3Row = row(page, "mp3-id3v2.3.mp3");
  // Byte-honest label (MP3, not an image).
  await expect(mp3Row).toContainText("MP3", { timeout: 120000 });
  await expect(mp3Row.getByTestId("row-status").first()).toContainText("Inspected");
  // Local playback affordance is present; nothing is uploaded (the file
  // plays via a blob: URL).
  await expect(mp3Row.locator('[data-testid="audio-preview"], [data-testid="audio-player"]').first()).toBeAttached({ timeout: 30000 });

  // Details modal shows audio-centric sections with honest N/A labeling.
  await mp3Row.getByRole("button", { name: /View details|details for/ }).first().click({ timeout: 60000 });
  await page.locator('[data-testid="inspector-panel"]').waitFor();
  await expect(page.getByTestId("audio-details-body")).toBeVisible();
  await expect(page.getByTestId("audio-stream-facts")).toContainText("44100 Hz");
  await expect(page.getByTestId("audio-stream-facts")).toContainText("Mono");
  await expect(page.getByTestId("audio-id3-section")).toContainText("V2.3 Harbor Noon");
  await expect(page.getByTestId("audio-id3-section")).toContainText("Demo Artist");
  await expect(page.getByTestId("audio-na-note")).toContainText("not checked for MP3");
  await page.keyboard.press("Escape");
});

test("ID3 versions v2.2/v2.4 and an untagged file inspect honestly", async ({ page }) => {
  await upload(page, ["mp3-id3v2.4.mp3", "mp3-untagged.mp3", "mp3-corrupted-size.mp3"]);

  const v24 = row(page, "mp3-id3v2.4.mp3");
  await expect(v24.getByTestId("row-status").first()).toContainText("Inspected", { timeout: 120000 });
  await v24.getByRole("button", { name: /View details|details for/ }).first().click({ timeout: 60000 });
  await expect(page.getByTestId("audio-id3-section")).toContainText("V2.4 Unicode");
  await page.keyboard.press("Escape");

  const untagged = row(page, "mp3-untagged.mp3");
  await expect(untagged.getByTestId("row-status").first()).toContainText("Inspected", { timeout: 120000 });
  await untagged.getByRole("button", { name: /View details|details for/ }).first().click({ timeout: 60000 });
  await expect(page.getByTestId("audio-id3-section")).toContainText("No ID3");
  await page.keyboard.press("Escape");

  // Corrupted tag: refused safely — never mislabeled as healthy audio.
  const corrupt = row(page, "mp3-corrupted-size.mp3");
  await expect(corrupt.getByTestId("row-status").first()).toContainText(/failed|unsupported/i, { timeout: 120000 });
});

test("mixed image + MP3 queue keeps both flows intact", async ({ page }) => {
  await upload(page, ["jpeg-gps-sw.jpg", "mp3-ai-tags.mp3"]);
  // Image rows are selected for image tools; MP3 rows are inspect-only.
  const imageRow = row(page, "jpeg-gps-sw.jpg");
  await expect(imageRow.getByTestId("row-status").first()).toContainText("Inspected", { timeout: 120000 });
  const audioRow = row(page, "mp3-ai-tags.mp3");
  await expect(audioRow.getByTestId("row-status").first()).toContainText("Inspected", { timeout: 120000 });
  // No horizontal overflow from the mixed queue.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
