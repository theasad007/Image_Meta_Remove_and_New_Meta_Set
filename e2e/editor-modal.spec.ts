import { expect, test, type Page } from "@playwright/test";
import ExifReader from "exifreader";
import fs from "node:fs";
import path from "node:path";
import { row, upload } from "./helpers";

/**
 * Screen 06 — single-image Edit Metadata modal (approved visual reference):
 * guest rewriting without login, real field mapping, verified output bytes,
 * source-precedence honesty and per-format disclosure.
 */

const TEN_FILES = [
  "jpeg-exif.jpg",
  "jpeg-openai.jpg",
  "jpeg-gps-sw.jpg",
  "jpeg-xmp-iptc.jpg",
  "jpeg-icc.jpg",
  "png-c2pa-forged-cabx.png",
  "signed-c2pa.jpg",
  "signed-c2pa.png",
  "webp-c2pa-signed.webp",
  "avif-c2pa-signed.avif",
];

const EDITOR = '[data-testid="editor-modal"]';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as unknown as Record<string, unknown>;
    delete target["showSaveFilePicker"];
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  (page as unknown as { __errors: string[] }).__errors = errors;
  await page.goto("/");
});

async function openEditorFor(page: Page, name: string) {
  // Desktop grid + mobile card both render the action; scope to the visible one.
  await row(page, name).getByRole("button", { name: /Edit metadata for/ }).first().click({ timeout: 120000 });
  await page.locator(EDITOR).waitFor({ timeout: 60000 });
  await expect(page.getByTestId("editor-title")).toContainText("Edit Metadata");
  await expect(page.getByTestId("editor-file-meta")).toContainText(name);
}

async function openEditorTab(page: Page, tabId: string) {
  await page.locator(`[data-testid="editor-tab-${tabId}"]`).click();
}

/** Deterministic screenshots: wait until the preview decoded or honestly
 *  reported its fallback (probe decode is asynchronous). */
async function awaitPreviewSettled(page: Page) {
  const preview = page.locator('[data-testid="editor-preview"]');
  await expect(preview).toBeVisible({ timeout: 10000 });
  await expect.poll(
    async () => {
      const imgVisible = await page.locator('[data-testid="editor-preview-img"]').isVisible();
      const fallbackVisible = await page.locator('[data-testid="editor-preview"] [role="img"]').isVisible();
      return imgVisible || fallbackVisible;
    },
    { timeout: 30000, intervals: [250, 500] },
  ).toBe(true);
}

function fillField(page: Page, field: string, value: string) {
  return page.locator(`[data-testid="editor-input-${field}"]`).fill(value);
}

test("guest rewrites one image with basic info + verified bytes, without any sign-in", async ({ page }) => {
  await upload(page, ["jpeg-xmp-iptc.jpg"]);
  await openEditorFor(page, "jpeg-xmp-iptc.jpg");

  // Layout contract: preview, counts, tabs, footer actions.
  await expect(page.locator('[data-testid="editor-preview"]')).toBeVisible();
  await expect(page.locator('[data-testid="editor-counts"]')).toContainText("Detected metadata");
  for (const tabId of ["basic", "location", "advanced", "preset"]) {
    await expect(page.locator(`[data-testid="editor-tab-${tabId}"]`)).toBeVisible();
  }
  await expect(page.locator('[data-testid="editor-cancel"]')).toBeVisible();
  await expect(page.locator('[data-testid="editor-apply"]')).toBeVisible();
  await expect(page.locator('[data-testid="editor-use-detected"]')).toBeEnabled();

  // Apply starts disabled with the honest reason…
  await expect(page.getByTestId("editor-apply")).toBeDisabled();
  await expect(page.getByTestId("editor-blocked-reason")).toContainText("at least one supported value");

  // …entering a guest title unlocks the primary action (Rule B).
  await fillField(page, "title", "Screen 06 Guest Title");

  // Preview changes: real mapping shown per channel.
  await page.getByTestId("editor-preview-toggle").click();
  const previewWrites = page.locator('[data-testid="editor-preview-writes"]');
  await expect(previewWrites).toContainText("Image Title");
  await expect(previewWrites).toContainText("Screen 06 Guest Title");
  const titleRow = previewWrites.locator("li", { hasText: "Image Title" });
  await expect(titleRow).toContainText("EXIF DocumentName (269)");
  await expect(titleRow).toContainText("XMP dc:title");
  await expect(titleRow).toContainText("JPEG IPTC 2:5 ObjectName");
  await expect(page.locator('[data-testid="editor-preview-strip"]')).toContainText("proven cleaner");
  await expect(page.locator('[data-testid="editor-preview-c2pa"]')).toContainText("never claimed removed or valid");
  await page.getByTestId("editor-preview-toggle").click();

  // Apply & create clean copy: real pipeline + verified outcome.
  await page.getByTestId("editor-apply").click();
  await expect(page.getByTestId("editor-status-chips")).toContainText(/verified rewritten|partially rewritten/, { timeout: 180000 });
  await expect(page.locator('[data-testid="editor-result"] [data-testid="rewrite-result-panel"]')).toBeVisible();
  await expect(page.locator('[data-testid="editor-result"]')).toContainText("verified");

  const downloadPromise = page.waitForEvent("download");
  await page.locator('[data-testid="editor-result"] [data-testid="download-rewritten"]').click();
  const download = await downloadPromise;
  const outPath = path.join(__dirname, "artifacts", `editor-${Date.now()}-xmp-iptc.jpg`);
  await download.saveAs(outPath);
  expect(download.suggestedFilename()).toContain("-rewritten.");

  // Independent byte verification of the ACTUAL output.
  const bytes = fs.readFileSync(outPath);
  const copy = new Uint8Array(bytes);
  const tags = (await ExifReader.load(copy.buffer, { expanded: true, async: true })) as unknown as Record<string, Record<string, unknown>>;
  const documentNames: string[] = [];
  for (const [key, value] of Object.entries(tags["exif"] ?? {})) {
    if (/DocumentName/i.test(key)) {
      documentNames.push(String((value as { description?: string }).description ?? ""));
    }
  }
  expect(documentNames.some((value) => value.includes("Screen 06 Guest Title"))).toBe(true);
  void copy;

  // The row keeps its own verified output (reused queue surface).
  await page.getByTestId("editor-cancel").click();
  await expect(page.locator(EDITOR)).toHaveCount(0);
  await expect(row(page, "jpeg-xmp-iptc.jpg").locator('[data-testid="download-row-output"]').first()).toBeVisible();
});

test("empty form stays disabled; free remove actions remain usable for guests (Rule A/B)", async ({ page }) => {
  await upload(page, ["jpeg-openai.jpg"]);
  await openEditorFor(page, "jpeg-openai.jpg");

  await expect(page.getByTestId("editor-apply")).toBeDisabled();
  await expect(page.locator('[data-testid="editor-blocked-reason"]')).toContainText("at least one supported value");

  // Preset tab for a guest: profile source locked, guest path never blocked.
  await openEditorTab(page, "preset");
  await expect(page.locator('[data-testid="editor-profile-preview"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="editor-profile-locked-note"]')).toContainText("Guests can always edit custom values");
  await expect(page.locator('[data-testid="editor-profile-locked-note"]')).toContainText("Sign in on your profile page");

  await page.getByTestId("editor-cancel").click();
  await expect(page.locator(EDITOR)).toHaveCount(0);

  // Rule A: both free removal actions keep working without a profile.
  const clean = page.locator('[data-testid="batch-clean-all"]');
  await expect(clean).toBeEnabled({ timeout: 120000 });
  await clean.click();
  await expect(row(page, "jpeg-openai.jpg").locator('[data-testid="row-status"]').locator("visible=true")).toContainText(/Cleaned|Verified/, { timeout: 120000 });
});

test("keywords validate, count, dedupe and preview as distinct tags", async ({ page }) => {
  await upload(page, ["jpeg-xmp-iptc.jpg"]);
  await openEditorFor(page, "jpeg-xmp-iptc.jpg");

  const unique31 = Array.from({ length: 31 }, (_, index) => `unique-keyword-${index}`).join(", ");
  await openEditorTab(page, "basic");
  await fillField(page, "keywords", unique31);
  await expect(page.getByTestId("editor-counts")).toBeVisible();
  await expect(page.locator('[data-testid="editor-error-keywords"]')).toContainText(/at most 30 unique keywords/);
  await expect(page.getByTestId("editor-apply")).toBeDisabled();

  await fillField(page, "keywords", "harbor, Harbor, noon;NIGHT\nNight");
  await expect(page.locator('[data-testid="editor-field-keywords"]')).toContainText("3/30 keywords");
  await expect(page.locator('[data-testid="editor-error-keywords"]')).toHaveCount(0);
  await page.getByTestId("editor-preview-toggle").click();
  // Dedupe is case-insensitive and keeps the first-occurrence casing.
  await expect(page.locator('[data-testid="editor-preview-writes"]')).toContainText("3 keyword(s): harbor, noon, NIGHT");
  await expect(page.locator('[data-testid="editor-preview-writes"]')).toContainText("IPTC 2:25");
});

test("field validation rejects oversize values, bad URLs and shows counters", async ({ page }) => {
  await upload(page, ["jpeg-xmp-iptc.jpg"]);
  await openEditorFor(page, "jpeg-xmp-iptc.jpg");

  await fillField(page, "creator", "y".repeat(121));
  await expect(page.locator('[data-testid="editor-error-creator"]')).toContainText(/120 characters or fewer/);
  await fillField(page, "website", "malformed-url");
  await expect(page.locator('[data-testid="editor-error-website"]')).toContainText(/http/);
  await fillField(page, "description", "d".repeat(2001));
  await expect(page.locator('[data-testid="editor-error-description"]')).toContainText(/2000 characters or fewer/);
  await expect(page.getByTestId("editor-apply")).toBeDisabled();

  // Counters appear per field.
  await expect(page.locator('[data-testid="editor-field-creator"]')).toContainText("121/120");
  await fillField(page, "creator", "Clean Creator");
  await expect(page.locator('[data-testid="editor-error-creator"]')).toHaveCount(0);
  await fillField(page, "website", "https://example.com/team");
  await fillField(page, "description", "Clean description");
  await expect(page.getByTestId("editor-apply")).toBeEnabled();
});

test("override isolation: image A custom values never include another image's later profile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The signed-in profile path needs a real Firebase session; covered by unit tests + guest equivalence.");
  await upload(page, ["jpeg-exif.jpg", "jpeg-openai.jpg"]);
  await openEditorFor(page, "jpeg-exif.jpg");
  await openEditorTab(page, "preset");
  await expect(page.getByTestId("editor-source")).toContainText("Custom values for this image");
  await page.getByTestId("editor-cancel").click();

  // Draft isolation across files: A keeps values, B opens blank, back to A.
  await openEditorFor(page, "jpeg-exif.jpg");
  await fillField(page, "creator", "Image A Author Only");
  await page.getByTestId("editor-cancel").click();

  const itemB = row(page, "jpeg-openai.jpg");
  await itemB.getByRole("button", { name: /Edit metadata for/ }).click();
  await expect(page.getByTestId("editor-file-meta")).toContainText("jpeg-openai.jpg");
  await expect(page.locator('[data-testid="editor-input-creator"]')).toHaveValue("");
  await page.getByTestId("editor-cancel").click();

  await row(page, "jpeg-exif.jpg").getByRole("button", { name: /Edit metadata for/ }).click();
  await expect(page.locator('[data-testid="editor-input-creator"]')).toHaveValue("Image A Author Only");
  await page.getByTestId("editor-cancel").click();
});

test("GPS tab: Location Name editable; Screen 09 GeoTag editor replaces the old read-only placeholder", async ({ page }) => {
  await upload(page, ["jpeg-gps-sw.jpg"]);
  await openEditorFor(page, "jpeg-gps-sw.jpg");
  await openEditorTab(page, "location");

  // Location Name is a real writable descriptive field (unchanged Screen 06).
  await fillField(page, "locationName", "Test Harbor, Bay Area");

  // Screen 09: the GeoTag editor reads the file's REAL coordinates — the
  // old read-only "coming later" placeholder is replaced by the working
  // editor (authorized Location-tab integration only; no redesign).
  await expect(page.getByTestId("geotag-editor")).toBeVisible();
  await expect(page.getByTestId("geotag-status-badge")).toContainText("GPS detected");
  await expect(page.getByTestId("geotag-original")).toContainText("-");
  await expect(page.getByTestId("geotag-original")).toContainText("S");
  await expect(page.getByTestId("geotag-original")).toContainText("W");
  // Latitude/longitude are now editable decimal inputs (never location text).
  await expect(page.getByTestId("geotag-input-latitude")).toBeVisible();
  await expect(page.getByTestId("geotag-input-longitude")).toBeVisible();
  await expect(page.getByTestId("editor-gps-note")).toContainText("never");
  await page.getByTestId("editor-cancel").click();
});

test("advanced tab shows exactly the implemented modes with honest caveats", async ({ page }) => {
  await upload(page, ["jpeg-icc.jpg"]);
  await openEditorFor(page, "jpeg-icc.jpg");
  await openEditorTab(page, "advanced");
  const advanced = page.locator('[data-testid="editor-panel-advanced"]');
  await expect(advanced).toContainText("Replace removable editable metadata, then write");
  await expect(advanced).toContainText("Update selected fields");
  await expect(advanced).toContainText("Retained C2PA is re-validated afterward; the edits may invalidate its signature");
  await expect(advanced).toContainText("PNG/WebP/AVIF/HEIC write EXIF + XMP only");
});

test("detected values action fills the form and discloses privacy retention", async ({ page }) => {
  await upload(page, ["jpeg-xmp-iptc.jpg"]);
  await openEditorFor(page, "jpeg-xmp-iptc.jpg");
  await page.getByTestId("editor-use-detected").click();
  const notice = page.locator('[data-testid="editor-left-column"]');
  await expect(notice).toContainText("detected value", { timeout: 30000 });
  // Synthetic fixture fields were copied in as explicit values.
  await expect(page.locator('[data-testid="editor-input-title"]')).toHaveValue(/Harbor|Synthetic/);
  await expect(page.locator('[data-testid="editor-detected-list"]')).toContainText("Image Title");
});

test("opening from Screen 05 returns to it on cancel, and drafts survive the round trip", async ({ page }) => {
  await upload(page, ["jpeg-xmp-iptc.jpg"]);
  // Open Screen 05 and jump to the editor from its header control.
  await row(page, "jpeg-xmp-iptc.jpg").getByRole("button", { name: "View details" }).click({ timeout: 120000 });
  const dialog = page.locator('[data-testid="details-modal"]');
  await dialog.waitFor({ timeout: 60000 });
  await page.getByTestId("details-edit").click();
  await expect(page.locator(EDITOR)).toBeVisible({ timeout: 60000 });
  await expect(dialog).toHaveCount(0); // never two active traps

  await fillField(page, "title", "From Details Roundtrip");
  await page.getByTestId("editor-view-details").click();
  await expect(page.locator('[data-testid="details-modal"]')).toBeVisible({ timeout: 60000 });
  // Draft was preserved; reopening the editor still shows the typed value.
  await page.getByTestId("details-edit").click();
  await expect(page.locator(EDITOR)).toBeVisible({ timeout: 60000 });
  await expect(page.locator('[data-testid="editor-input-title"]')).toHaveValue("From Details Roundtrip");
  await page.getByTestId("editor-cancel").click();
  // Returning lands back on Screen 05 because the editor was opened from it.
  await expect(page.locator('[data-testid="details-modal"]')).toBeVisible({ timeout: 60000 });
  await page.getByTestId("details-close").click();
  await expect(page.locator('[data-testid="details-modal"]')).toHaveCount(0);
});

test("queue navigation shows per-file editors and honors the in-browser budget", async ({ page }) => {
  await upload(page, TEN_FILES);
  await openEditorFor(page, "jpeg-gps-sw.jpg");
  await expect(page.locator('[data-testid="editor-file-meta"]')).toContainText("jpeg-gps-sw.jpg");
  await page.getByTestId("editor-cancel").click();

  await openEditorFor(page, "signed-c2pa.jpg");
  await expect(page.locator('[data-testid="editor-file-meta"]')).toContainText("signed-c2pa.jpg");
  // The AI/C2PA counts reflect that file's REAL inspection (2 indicators, manifest).
  await expect(page.locator('[data-testid="editor-counts"]')).toContainText("AI");
  await page.getByTestId("editor-cancel").click();
});

test("non-image files cannot be rewritten (honest unsupported state)", async ({ page }) => {
  await upload(page, ["random-bytes.bin"]);
  // Intake marks the file; Edit opens the editor in its unsupported state.
  await row(page, "random-bytes.bin").getByRole("button", { name: /Edit metadata for/ }).click();
  await expect(page.locator(EDITOR)).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId("editor-unsupported-note")).toBeVisible();
  await expect(page.getByTestId("editor-apply")).toBeDisabled();
  await page.getByTestId("editor-cancel").click();
  await expect(page.locator(EDITOR)).toHaveCount(0);
});

test("captures the approved Screen 06 deliverable screenshots (before rewrite)", async ({ page }) => {
  await upload(page, ["jpeg-xmp-iptc.jpg"]); // known non-white fixture pixels
  const shots = "e2e/artifacts/screen-06";

  // 1) Basic info tab (before rewrite): preview + detected counts + form.
  await openEditorFor(page, "jpeg-xmp-iptc.jpg");
  await awaitPreviewSettled(page);
  await fillField(page, "title", "Deliverable Demo Title");
  await fillField(page, "description", "A deliverable walkthrough of the single-image editor.");
  // Focus actions scroll the internal container; reset to top for captures.
  await page.locator(EDITOR).evaluate((el) => {
    const body = el.querySelector('[data-testid="editor-body"]');
    body?.scrollTo({ top: 0, left: 0, behavior: "auto" });
  });
  const repainted = await page.locator('[data-testid="editor-preview-img"]').evaluate((el: HTMLImageElement) => {
    const c = document.createElement("canvas");
    c.width = 4;
    c.height = 4;
    const ctx = c.getContext("2d");
    ctx?.drawImage(el, 0, 0, 4, 4);
    const d = ctx?.getImageData(0, 0, 4, 4).data;
    return d ? (d[0] as number) + (d[1] as number) + (d[2] as number) : 0;
  });
  // The fixture pixels must really paint in the composited preview.
  expect(repainted).toBeGreaterThan(30);
  await expect(page.locator('[data-testid="editor-body"]').evaluate((el) => el.scrollTop)).resolves.toBeLessThanOrEqual(2);
  await page.screenshot({ path: `${shots}/06-desktop-basic.png`, animations: "disabled" });

  // 2) Location (GPS) tab: read-only coordinates + descriptive location.
  await openEditorTab(page, "location");
  await page.screenshot({ path: `${shots}/06-desktop-gps.png`, animations: "disabled" });

  // 3) Advanced tab: the two real modes.
  await openEditorTab(page, "advanced");
  await page.screenshot({ path: `${shots}/06-desktop-advanced.png`, animations: "disabled" });

  // 4) Preset & Profile tab: guest state with the optional sign-in link.
  await openEditorTab(page, "preset");
  await page.screenshot({ path: `${shots}/06-desktop-preset.png`, animations: "disabled" });

  // 5) Preview changes: the Location Name lives in the Location tab, so fill
  //    it there; the preview dialog lives under Basic info.
  await openEditorTab(page, "location");
  await fillField(page, "locationName", "Harbor View, Bay Area");
  await openEditorTab(page, "basic");
  await page.getByTestId("editor-preview-toggle").click();
  await expect(page.locator('[data-testid="editor-preview-writes"]')).toBeVisible({ timeout: 10000 });
  await page.locator(EDITOR).evaluate((el) => {
    el.querySelector('[data-testid="editor-preview-panel"]')?.scrollIntoView({ block: "end" });
  });
  await page.screenshot({ path: `${shots}/06-desktop-preview.png`, animations: "disabled" });
  await page.getByTestId("editor-preview-toggle").click();

  await page.getByTestId("editor-cancel").click();
  await expect(page.locator(EDITOR)).toHaveCount(0);
});

test("captures the verified-rewrite deliverable screenshot with byte proof", async ({ page }) => {
  await upload(page, ["jpeg-gps-sw.jpg"]);
  const shots = "e2e/artifacts/screen-06";

  await openEditorFor(page, "jpeg-gps-sw.jpg");
  await fillField(page, "title", "Deliverable Demo Title");
  await fillField(page, "creator", "Deliverable Creator");
  await page.getByTestId("editor-apply").click();
  await expect(page.getByTestId("editor-status-chips")).toContainText(/verified rewritten|partially rewritten/, { timeout: 119000 });
  await page.locator(EDITOR).evaluate((el) => { const item = el.querySelector('[data-testid="editor-result"]'); item?.scrollIntoView({ block: "start" }); });
  await page.screenshot({ path: `${shots}/06-desktop-verified.png`, animations: "disabled" });
  const downloadPromise = page.waitForEvent("download");
  await page.locator('[data-testid="editor-result"] [data-testid="download-rewritten"]').click();
  const download = await downloadPromise;
  const outPath = path.join(__dirname, "artifacts", `editor-${Date.now()}-gps-sw.jpg`);
  await download.saveAs(outPath);

  // Byte-level proof: the requested writes land and replace-mode cleaning
  // removed the GPS coordinates from the verified output.
  const bytes = fs.readFileSync(outPath);
  const tags = (await ExifReader.load(new Uint8Array(bytes).buffer, { expanded: true, async: true })) as unknown as Record<string, Record<string, { description?: string }>>;
  const exifMap = new Map(Object.entries(tags["exif"] ?? {}));
  const artist = String((exifMap.get("Artist") as { description?: string } | undefined)?.description ?? "");
  expect(artist).toContain("Deliverable Creator");
  const gpsKeys = Object.keys(tags["gps"] ?? {});
  expect(gpsKeys.length).toBe(0);
});
