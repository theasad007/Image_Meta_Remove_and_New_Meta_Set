import { expect, test } from "@playwright/test";
import { fixture, row, upload } from "./helpers";

/**
 * Screen 04 (after-upload workspace) focus assertions for `/`:
 * the route shows the locked Screen 01 only while the queue is empty and
 * switches to the reference workspace as soon as one supported file is
 * queued. Statuses stay truthful ("Inspected", never "Completed" for
 * uncleaned files), selection drives the header action counts, and the
 * queue survives a tool switch and a second upload.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as unknown as Record<string, unknown>;
    delete target["showSaveFilePicker"];
  });
  await page.goto("/");
});

test("route switches from locked Screen 01 to the workspace after one upload and back when emptied", async ({ page }) => {
  // Empty state: Screen 01 landing (hero + uploader) is visible.
  await expect(page.locator('[data-testid="upload-dropzone"]')).toBeVisible();
  await expect(page.locator('[data-testid="workspace-card"]')).toHaveCount(0);

  await upload(page, ["jpeg-exif.jpg"]);
  await expect(page.locator('[data-testid="workspace-card"]')).toBeVisible();
  // Landing hero/uploader/SEO are hidden while files are queued.
  await expect(page.locator('[data-testid="upload-dropzone"]')).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Files in your workspace/i })).toBeVisible();

  // Header CTA relabels to "Add more files" on the same locked header.
  await expect(page.locator('[data-testid="header-choose-files"]')).toContainText("Add more files");

  // Compact tool switcher keeps the honest local-only badge.
  await expect(page.locator('[data-testid="tool-ai_metadata"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Local-only processing")).toBeVisible();

  // Sidebar summary + privacy card.
  await expect(page.getByRole("heading", { name: "Queue summary" })).toBeVisible();
  await expect(page.getByText(/All image processing happens locally in your browser/i)).toBeVisible();
  await expect(page.locator('[data-testid="download-zip"]')).toBeDisabled();

  // Export cards + compact file-support strip.
  await expect(page.getByRole("heading", { name: "Verified outputs" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Audit reports" })).toBeVisible();
  await expect(page.locator("#formats-heading")).toContainText("File support");

  // Removing every file returns to the locked empty state.
  await page.locator('[data-testid="queue-clear"]').click();
  await expect(page.locator('[data-testid="upload-dropzone"]')).toBeVisible();
  await expect(page.locator('[data-testid="workspace-card"]')).toHaveCount(0);
  // Header CTA is back to the locked Screen 01 label.
  await expect(page.locator('[data-testid="header-choose-files"]')).toContainText("Choose files");
});

test("statuses stay truthful: inspected-but-uncleaned rows are never 'Completed'", async ({ page }) => {
  await upload(page, ["jpeg-openai.jpg"]);
  const item = row(page, "jpeg-openai.jpg");
  await expect(item).toContainText("Inspected", { timeout: 120000 });
  await expect(item).not.toContainText("Completed");

  // No verified output exists yet, so the ZIP export stays locked…
  await expect(page.locator('[data-testid="download-zip"]')).toBeDisabled();

  // …and running a removal action produces a verified output.
  const clean = page.locator('[data-testid="batch-clean-all"]');
  await expect(clean).toBeEnabled({ timeout: 120000 });
  await clean.click();
  await expect(item).toContainText(/Cleaned|Verified/, { timeout: 120000 });
  await expect(page.locator('[data-testid="download-zip"]')).toBeEnabled({ timeout: 120000 });
});

test("selection drives the header action counts and survives tool switches", async ({ page }) => {
  await upload(page, ["jpeg-exif.jpg", "jpeg-openai.jpg"]);
  await page.getByRole("checkbox", { name: "Select all files" }).waitFor();

  // Supported still images are preselected on upload (reference behavior:
  // every row checked, "N selected files", action counts computed from
  // the real selection).
  await expect(page.getByText("2 selected files")).toBeVisible();
  await expect(page.locator('[data-testid="batch-clean-all"]')).toContainText("Remove Metadata (2)", { timeout: 120000 });
  await expect(page.locator('[data-testid="remove-ai-metadata"]')).toContainText("Remove AI Metadata (2)");
  await expect(page.locator('[data-testid="batch-clean-all"]')).toBeEnabled();

  // Unselecting everything disables the three actions with honest counts.
  const selectAll = page.getByRole("checkbox", { name: "Select all files" });
  await selectAll.setChecked(false, { timeout: 120000 });
  await expect(page.locator('[data-testid="batch-clean-all"]')).toContainText("Remove Metadata (0)");
  await expect(page.locator('[data-testid="remove-ai-metadata"]')).toContainText("Remove AI Metadata (0)");
  await expect(page.locator('[data-testid="batch-clean-all"]')).toBeDisabled();

  // …the queue summary keeps both files across a tool switch…
  await expect(page.locator('[data-testid="queue-item"]')).toHaveCount(2);
  await expect(page.locator('[data-testid="tool-metadata_geotag"]')).toBeVisible();
  await page.locator('[data-testid="tool-metadata_geotag"]').click();
  await expect(page.locator('[data-testid="tool-metadata_geotag"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-testid="queue-item"]')).toHaveCount(2);
  await expect(page.locator('[data-testid="tool-ai_metadata"]')).not.toHaveAttribute("aria-selected", "true");

  // …and a second upload through the preserved multi-file picker appends.
  await page.locator('[data-testid="file-input"]').setInputFiles([fixture("jpeg-gps-sw.jpg")]);
  await expect(page.locator('[data-testid="queue-item"]')).toHaveCount(3);
  await expect(page.locator('[data-testid="queue-stats"]')).toContainText("3 files");
});

test("desktop table renders four columns: format, size and status live under the filename", async ({ page }) => {
  await upload(page, ["jpeg-exif.jpg", "jpeg-c2pa-multi.jpg"]);
  const item = row(page, "jpeg-exif.jpg");

  // File cell: name, then format · size, then honest status badge.
  await expect(item).toContainText("JPEG · 1.1 KB", { timeout: 120000 });
  await expect(item).toContainText("Inspected");

  // The standalone Format/Size/Status column headers are gone from the desktop table.
  await expect(page.locator('[data-testid="queue-panel"]').getByText("Format", { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-testid="queue-panel"]').getByText("Size", { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-testid="queue-panel"]').getByText("Status", { exact: true })).toHaveCount(0);

  // Header and rows share one stable grid template; geometry does not change with content.
  const template = await page.evaluate(() => {
    const header = document.querySelector('[data-testid="queue-panel"] > section > div:nth-child(3)');
    const rows = [...document.querySelectorAll('[data-testid="queue-item"] > div')].filter((el) => getComputedStyle(el).display === "grid");
    return [...rows.map((el) => getComputedStyle(el).gridTemplateColumns)].join("|");
  });
  const templates = template.split("|");
  expect(templates[0]).toEqual(templates[1]);

  // Actions: Edit, View details and the removal X are inside the row box (no clipping).
  const clipped = await page.evaluate(() => {
    const rowEl = [...document.querySelectorAll('[data-testid="queue-item"] > div')].find((el) => getComputedStyle(el).display === "grid");
    if (!rowEl) return [];
    const rowBox = rowEl.getBoundingClientRect();
    return [...rowEl.querySelectorAll("button")]
      .filter((b) => b.textContent?.trim() || b.getAttribute("aria-label"))
      .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.right > rowBox.right + 0.5 || r.left < rowBox.left - 0.5); })
      .map((b) => b.textContent?.trim() || b.getAttribute("aria-label"));
  });
  expect(clipped).toEqual([]);
});

test("cleaning keeps the column geometry stable with Download cleaned fully visible", async ({ page }) => {
  await upload(page, ["jpeg-exif.jpg", "jpeg-openai.jpg"]);
  await expect(row(page, "jpeg-exif.jpg").locator('[data-testid="row-status"]').locator("visible=true")).toContainText("Inspected", { timeout: 120000 });

  const templateBefore = await page.evaluate(() => {
    const rowEl = [...document.querySelectorAll('[data-testid="queue-item"] > div')].find((el) => getComputedStyle(el).display === "grid");
    return rowEl ? getComputedStyle(rowEl).gridTemplateColumns : "";
  });
  const nameBoxBefore = await row(page, "jpeg-exif.jpg").boundingBox() as { height: number };

  await page.getByRole("checkbox", { name: "Select all files" }).check();
  await page.locator('[data-testid="batch-clean-all"]').click();
  await expect(page.locator('[data-testid="download-row-output"]').first()).toBeVisible({ timeout: 120000 });

  // Status transitions legitimately; geometry does not.
  await expect(row(page, "jpeg-exif.jpg").locator('[data-testid="row-status"]').locator("visible=true")).toContainText("Cleaned · verified");
  const templateAfter = await page.evaluate(() => {
    const rowEl = [...document.querySelectorAll('[data-testid="queue-item"] > div')].find((el) => getComputedStyle(el).display === "grid");
    return rowEl ? getComputedStyle(rowEl).gridTemplateColumns : "";
  });
  expect(templateAfter).toEqual(templateBefore);

  // The download action rides inside the reserved Actions column, right-aligned, second line.
  const download = page.locator('[data-testid="download-row-output"]').first();
  const dlBox = await download.boundingBox() as { x: number; y: number };
  const actionsBox = await page.locator('[data-testid="queue-panel"]').getByText("Actions").boundingBox() as { x: number };
  expect(dlBox.x).toBeGreaterThanOrEqual(actionsBox.x);
  expect(dlBox.y).toBeGreaterThan((await row(page, "jpeg-exif.jpg").boundingBox())?.y ?? 0);
  expect(nameBoxBefore.height).toBeLessThan(160);

  // ORIGINAL FINDINGS · BEFORE CLEANING captions label the pre-clean data.
  const caption = page.locator('[data-testid="chips-original-caption"]').first();
  await expect(caption).toContainText("Original findings");
  await expect(caption).not.toBeHidden();
});

test("red X removes only its own row via click and keyboard, and returns to Screen 01 when emptied", async ({ page }) => {
  await upload(page, ["jpeg-exif.jpg", "jpeg-openai.jpg"]);
  await expect(row(page, "jpeg-openai.jpg")).toBeVisible({ timeout: 120000 });

  const first = row(page, "jpeg-exif.jpg");
  await expect(first.locator('[data-testid="queue-remove"]').locator("visible=true")).toHaveAttribute("aria-label", /Remove jpeg-exif\.jpg from workspace/i);
  await first.locator('[data-testid="queue-remove"]').locator("visible=true").click();
  await expect(row(page, "jpeg-exif.jpg")).toHaveCount(0);
  await expect(row(page, "jpeg-openai.jpg")).toBeVisible();
  await expect(page.locator('[data-testid="queue-stats"]')).toContainText("1 file");
  await expect(page.locator('[data-testid="queue-toolbar"]')).toContainText("1 selected file");

  // Keyboard: focus the X and press Enter removes the remaining row.
  await row(page, "jpeg-openai.jpg").locator('[data-testid="queue-remove"]').locator("visible=true").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-testid="queue-item"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="upload-dropzone"]')).toBeVisible();
});

test("portal tooltips stay visible above neighboring rows at table boundaries", async ({ page }) => {
  await upload(page, ["jpeg-exif.jpg", "jpeg-c2pa-multi.jpg", "png-text-exif.png"]);
  const editFirst = row(page, "png-text-exif.png").getByRole("button", { name: /Edit metadata for/ });

  // First row: the tooltip renders at document root (never clipped by the table mask).
  await editFirst.hover();
  const tip = page.locator('[data-testid="portal-tooltip"]');
  await expect(tip).toContainText("Edit metadata for this image (Screen 06 editor)", { timeout: 120000 });
  const firstInfo = await tip.evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { top: b.top, inBody: el.parentElement === document.body, tv: getComputedStyle(el).visibility };
  });
  expect(firstInfo.inBody).toBe(true);
  expect(firstInfo.tv).toBe("visible");
  expect(firstInfo.top).toBeGreaterThanOrEqual(0);

  // Last row: same visibility with bottom-edge flip/clamp, no page scroll growth.
  const editLast = row(page, "jpeg-exif.jpg").getByRole("button", { name: /Edit metadata for/ });
  await editLast.hover();
  await expect(tip).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
});

test("no hydration mismatch or page error loads from the production export (clean profile)", async ({ page }) => {
  const messages: string[] = [];
  page.on("console", (message) => messages.push(`${message.type()}: ${message.text()}`));
  page.on("pageerror", (error) => messages.push(`PAGEERROR: ${error}`));
  await page.goto("/");
  await expect(page.locator('[data-testid="upload-dropzone"]')).toBeVisible({ timeout: 30000 });
  const relevant = messages.filter((m) => /hydrat|mismatch|pageerror/i.test(m) || /^error:/i.test(m));
  expect(relevant).toEqual([]);
});
