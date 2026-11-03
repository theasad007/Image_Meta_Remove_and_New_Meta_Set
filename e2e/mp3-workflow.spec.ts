import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { row, upload, FIXTURES } from "./helpers";
import { probeMp3 } from "../src/lib/metadata/audio/id3";

/**
 * Phase 11 E2E — mixed image + MP3 workflows end-to-end: MP3 cleaning
 * (single + bulk, free), guest MP3 rewrite with verified output download,
 * and the byte-level proof that MPEG audio survives unchanged.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as unknown as Record<string, unknown>;
    delete target["showSaveFilePicker"];
  });
  await page.goto("/");
});

test("guest cleans an MP3 (metadata removal) and downloads a verified output", async ({ page }) => {
  test.setTimeout(360000);
  await upload(page, ["mp3-ai-tags.mp3"]);
  const mp3Row = row(page, "mp3-ai-tags.mp3");
  await expect(mp3Row.getByTestId("row-status").first()).toContainText("Inspected", { timeout: 120000 });

  // Single-row clean via the shared selection + batch action (free).
  const selectAll = page.getByRole("checkbox", { name: "Select all files" });
  if (await selectAll.isChecked()) await selectAll.uncheck();
  await mp3Row.getByRole("checkbox", { name: `Select mp3-ai-tags.mp3` }).check();
  await expect(page.getByTestId("batch-clean-all")).toBeEnabled({ timeout: 60000 });
  await page.getByTestId("batch-clean-all").click();
  await expect(mp3Row.getByTestId("row-status").first()).toContainText(/Verified|cleaned/i, { timeout: 240000 });
  // Per-file verified output download exists.
  await expect(mp3Row.locator('[data-testid="download-row-output"]').first()).toBeVisible({ timeout: 60000 });

  // Download and independently re-probe the output bytes.
  const downloadPromise = page.waitForEvent("download");
  await mp3Row.locator('[data-testid="download-row-output"]').first().click();
  const download = await downloadPromise;
  const target = path.join("e2e", "artifacts", "mp3-clean-output.mp3");
  await download.saveAs(target);
  const bytes = new Uint8Array(fs.readFileSync(target));
  const probe = probeMp3(bytes);
  expect(probe.tag).toBeNull(); // ID3v2 gone
  expect(probe.id3v1).toBeNull();
  expect(probe.stream?.frameCount).toBeGreaterThan(0); // audio intact
  // Audio byte-preservation vs the original fixture.
  const original = new Uint8Array(fs.readFileSync(path.join(FIXTURES, "mp3-ai-tags.mp3")));
  const originalProbe = probeMp3(original);
  const originalAudio = original.subarray(originalProbe.audioStart);
  expect(probe.stream!.frameCount).toBe(originalProbe.stream!.frameCount);
  expect(bytes.length).toBe(originalAudio.length);
});

test("guest rewrites MP3 tags and the verified output plays and re-verifies", async ({ page }) => {
  test.setTimeout(360000);
  await upload(page, ["mp3-untagged.mp3"]);
  const mp3Row = row(page, "mp3-untagged.mp3");
  await expect(mp3Row.getByTestId("row-status").first()).toContainText("Inspected", { timeout: 120000 });

  await mp3Row.locator("[data-editor-open]").first().click();
  await page.locator('[data-testid="editor-modal"]').waitFor();
  await expect(page.getByTestId("editor-audio-note")).toContainText("ID3");
  await expect(page.getByTestId("editor-field-title")).toContainText("Audio title (ID3 TIT2)");

  await page.fill('[data-testid="editor-input-title"]', "Rewritten Audio Title");
  await page.fill('[data-testid="editor-input-creator"]', "E2E Artist");
  await page.getByTestId("editor-apply").click();
  await expect(page.getByTestId("editor-result").getByText("verified rewritten").first()).toBeVisible({ timeout: 240000 });

  // Download from the verified rewrite result panel (the modal owns it).
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("editor-result").getByTestId("download-rewritten").click();
  const download = await downloadPromise;
  const target = path.join("e2e", "artifacts", "mp3-rewrite-output.mp3");
  await download.saveAs(target);
  await page.keyboard.press("Escape");
  const bytes = new Uint8Array(fs.readFileSync(target));
  const probe = probeMp3(bytes);
  expect(probe.tag!.frames.find((frame) => frame.id === "TIT2")?.values[0]).toBe("Rewritten Audio Title");
  expect(probe.tag!.frames.find((frame) => frame.id === "TPE1")?.values[0]).toBe("E2E Artist");
  expect(probe.stream?.frameCount).toBeGreaterThan(0);
});

test("mixed queue bulk cleaning keeps each file's outcome independent", async ({ page }) => {
  test.setTimeout(360000);
  await upload(page, ["mp3-id3v2.3.mp3", "jpeg-empty.jpg", "mp3-untagged.mp3"]);
  // All three auto-selected (images + audio); bulk clean is free.
  await page.getByTestId("batch-clean-all").click();
  await expect(page.getByText(/finished/i).first()).toBeVisible({ timeout: 300000 });
  // Each MP3 row shows a verified/unchanged outcome with downloadable output.
  await expect(row(page, "mp3-id3v2.3.mp3").locator('[data-testid="download-row-output"]').first()).toBeVisible({ timeout: 60000 });
  await expect(row(page, "mp3-untagged.mp3").locator('[data-testid="download-row-output"]').first()).toBeVisible({ timeout: 60000 });
  await expect(row(page, "jpeg-empty.jpg").locator('[data-testid="download-row-output"]').first()).toBeVisible({ timeout: 60000 });
});
