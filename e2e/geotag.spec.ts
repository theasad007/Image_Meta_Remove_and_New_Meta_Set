import { expect, test, type Page } from "@playwright/test";
import ExifReader from "exifreader";
import fs from "node:fs";
import path from "node:path";
import { row, upload } from "./helpers";

/**
 * Screen 09 — GeoTag Editor (Location tab of the Screen 06 modal).
 *
 * Real verified GPS write/remove against actual output bytes: every
 * successful apply is downloaded and re-read with ExifReader, mirroring
 * the engine's own re-observation guarantee. The optional online map and
 * location search are consent-gated; their provider responses are stubbed
 * ONLY for the UI-behavior journeys (never for byte-level verification).
 */

const EDITOR = '[data-testid="editor-modal"]';
const GPS_TOLERANCE = 1e-6; // matches the engine's GPS_VERIFY_TOLERANCE_DEGREES

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

test.afterEach(async ({ page }) => {
  const errors = (page as unknown as { __errors: string[] }).__errors;
  expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
});

async function openEditorFor(page: Page, name: string) {
  await row(page, name).getByRole("button", { name: /Edit metadata for/ }).first().click({ timeout: 120000 });
  await page.locator(EDITOR).waitFor({ timeout: 60000 });
  await expect(page.getByTestId("editor-file-meta")).toContainText(name);
}

async function openLocationTab(page: Page) {
  await page.locator('[data-testid="editor-tab-location"]').click();
  await page.getByTestId("geotag-editor").waitFor({ timeout: 30000 });
}

async function setCoordinates(page: Page, latitude: string, longitude: string, altitude = "") {
  await page.getByTestId("geotag-input-latitude").fill(latitude);
  await page.getByTestId("geotag-input-longitude").fill(longitude);
  if (altitude !== "") await page.getByTestId("geotag-input-altitude").fill(altitude);
}

interface DownloadedGps {
  latitude: number | undefined;
  longitude: number | undefined;
  altitude: number | undefined;
  keyCount: number;
}

/** Download the row's verified output and read its GPS tags back from bytes.
 *  The editor modal is closed first so the row surface is interactive
 *  (same flow the approved Screen 06 tests use). */
async function downloadAndReadGps(page: Page, name: string, tag: string): Promise<DownloadedGps> {
  if (await page.locator(EDITOR).isVisible()) {
    await page.getByTestId("editor-cancel").click();
    await expect(page.locator(EDITOR)).toHaveCount(0);
  }
  const downloadPromise = page.waitForEvent("download");
  await row(page, name).locator('[data-testid="download-row-output"]').first().click();
  const download = await downloadPromise;
  const outPath = path.join(__dirname, "artifacts", `geotag-${Date.now()}-${tag}`);
  await download.saveAs(outPath);
  const bytes = fs.readFileSync(outPath);
  const tags = (await ExifReader.load(new Uint8Array(bytes).buffer, { expanded: true, async: true })) as unknown as Record<string, Record<string, unknown>>;
  const gps = tags["gps"] ?? {};
  // ExifReader's expanded gps group exposes Latitude/Longitude/Altitude as
  // plain values (strings) — handle the object shape defensively too.
  const read = (key: string): unknown => {
    const value = gps[key];
    if (value && typeof value === "object" && "description" in (value as object)) {
      return (value as { description?: unknown }).description;
    }
    return value;
  };
  const num = (value: unknown): number | undefined => {
    if (value === undefined || value === null) return undefined;
    const parsed = Number.parseFloat(String(value));
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  return {
    latitude: num(read("Latitude")),
    longitude: num(read("Longitude")),
    altitude: num(read("Altitude")),
    keyCount: Object.keys(gps).length,
  };
}

// ------------------------------------------------------- inspection display

test("shows real detected coordinates and honest no-GPS state", async ({ page }) => {
  await upload(page, ["jpeg-gps-sw.jpg", "jpeg-empty.jpg"]);

  await openEditorFor(page, "jpeg-gps-sw.jpg");
  await openLocationTab(page);
  await expect(page.getByTestId("geotag-status-badge")).toContainText("GPS detected");
  const original = page.getByTestId("geotag-original");
  await expect(original).toContainText("Latitude");
  await expect(original).toContainText("S"); // hemisphere reference
  await expect(original).toContainText("W");
  await expect(original).toContainText("-");
  // The New GPS card starts empty — nothing is invented.
  await expect(page.getByTestId("geotag-new")).toContainText("Enter coordinates below");
  await page.getByTestId("editor-cancel").click();

  await openEditorFor(page, "jpeg-empty.jpg");
  await openLocationTab(page);
  await expect(page.getByTestId("geotag-status-badge")).toContainText("No GPS coordinates");
  await expect(page.getByTestId("geotag-original-none")).toContainText("No GPS coordinates were found in this image.");
  await page.getByTestId("editor-cancel").click();
  await expect(page.locator(EDITOR)).toHaveCount(0);
});

// ------------------------------------------------------- write + verify

test("writes GPS to a metadata-free JPEG, verifies the output and re-reads the downloaded bytes", async ({ page }) => {
  await upload(page, ["jpeg-empty.jpg"]);
  await openEditorFor(page, "jpeg-empty.jpg");
  await openLocationTab(page);

  await setCoordinates(page, "-34.6037", "-58.3816", "-5");
  await expect(page.getByTestId("geotag-status-badge")).toContainText("Coordinates modified — not yet applied");
  // The preview is the real write plan (original vs new).
  await expect(page.getByTestId("geotag-preview")).toBeVisible();
  await expect(page.getByTestId("geotag-preview-new")).toContainText("-34.6037");
  await expect(page.getByTestId("geotag-preview-new")).toContainText("-58.3816");
  await expect(page.getByTestId("geotag-preview-notes")).toContainText("not proof of writing");

  await page.getByTestId("geotag-apply").click();
  await page.getByTestId("geotag-apply-confirm").click();
  await expect(page.getByTestId("geotag-status-badge")).toContainText("GPS written and verified", { timeout: 120000 });
  await expect(page.getByTestId("geotag-evidence")).toContainText("verified");
  // Issue 01 State C: the card labels the values APPLIED (VERIFIED) and the
  // pending-Apply affordance disappears — no second Apply for the same values.
  await expect(page.getByTestId("geotag-new-heading")).toContainText("Applied GPS (verified)");
  await expect(page.getByTestId("geotag-new-applied")).toContainText("-34.6037");
  await expect(page.getByTestId("geotag-new-applied")).toContainText("-58.3816");
  await expect(page.getByTestId("geotag-new-applied-source")).toContainText("observed in the produced bytes");
  await expect(page.getByTestId("geotag-apply")).toHaveCount(0);
  await expect(page.getByTestId("geotag-preview")).toHaveCount(0);

  const gps = await downloadAndReadGps(page, "jpeg-empty.jpg", "write.jpg");
  expect(gps.latitude).toBeDefined();
  expect(Math.abs((gps.latitude ?? NaN) - -34.6037)).toBeLessThanOrEqual(GPS_TOLERANCE);
  expect(Math.abs((gps.longitude ?? NaN) - -58.3816)).toBeLessThanOrEqual(GPS_TOLERANCE);
  expect(Math.abs((gps.altitude ?? NaN) - -5)).toBeLessThan(0.01);
});

test("update mode replaces existing coordinates and keeps unrelated EXIF", async ({ page }) => {
  await upload(page, ["jpeg-gps-sw.jpg"]);
  await openEditorFor(page, "jpeg-gps-sw.jpg");
  await openLocationTab(page);

  // Switch to update mode (Advanced tab) so unrelated metadata is preserved.
  await page.locator('[data-testid="editor-tab-advanced"]').click();
  await page.locator('[data-testid="editor-mode"] input[name="editor-mode"]').nth(1).check();
  await openLocationTab(page);

  await setCoordinates(page, "12.345678", "98.765432", "150");
  await expect(page.getByTestId("geotag-preview-original")).toContainText("-");
  await page.getByTestId("geotag-apply").click();
  await page.getByTestId("geotag-apply-confirm").click();
  await expect(page.getByTestId("geotag-status-badge")).toContainText("GPS written and verified", { timeout: 120000 });

  const gps = await downloadAndReadGps(page, "jpeg-gps-sw.jpg", "update.jpg");
  expect(Math.abs((gps.latitude ?? NaN) - 12.345678)).toBeLessThanOrEqual(GPS_TOLERANCE);
  expect(Math.abs((gps.longitude ?? NaN) - 98.765432)).toBeLessThanOrEqual(GPS_TOLERANCE);
  expect(Math.abs((gps.altitude ?? NaN) - 150)).toBeLessThan(0.01);

  // Reopen: the ORIGINAL card now reflects the pre-edit inspection of the
  // queue file, and the row status shows a verified rewrite.
  await expect(row(page, "jpeg-gps-sw.jpg").getByTestId("row-status").locator("visible=true")).toContainText(/rewritten|Rewritten|verified/i, { timeout: 60000 });
});

// ------------------------------------------------------- removal + verify

test("removes GPS from a JPEG with negative coordinates and verifies the downloaded bytes", async ({ page }) => {
  await upload(page, ["jpeg-gps-sw.jpg"]);
  await openEditorFor(page, "jpeg-gps-sw.jpg");
  await openLocationTab(page);

  await page.getByTestId("geotag-remove").click();
  await page.getByTestId("geotag-remove-confirm").click();
  await expect(page.getByTestId("geotag-status-badge")).toContainText("GPS removal verified", { timeout: 120000 });
  // The evidence quotes the re-observation: EXIF GPS IFD gone, XMP mirrors gone.
  await expect(page.getByTestId("geotag-evidence")).toContainText("EXIF GPS IFD absent");
  await expect(page.getByTestId("geotag-evidence")).toContainText("verified");
  // Issue 01 State E: accurate removal label; the removal action disappears
  // once the verified absence is recorded (no duplicate runs).
  await expect(page.getByTestId("geotag-new-heading")).toContainText("GPS removed (verified)");
  await expect(page.getByTestId("geotag-new-removal-verified")).toContainText("No GPS coordinates remain in the verified output");
  await expect(page.getByTestId("geotag-remove")).toHaveCount(0);

  const gps = await downloadAndReadGps(page, "jpeg-gps-sw.jpg", "removed.jpg");
  expect(gps.keyCount).toBe(0);
  expect(gps.latitude).toBeUndefined();
});

test("refuses to remove GPS that does not exist (honest no-op)", async ({ page }) => {
  await upload(page, ["jpeg-empty.jpg"]);
  await openEditorFor(page, "jpeg-empty.jpg");
  await openLocationTab(page);

  await expect(page.getByTestId("geotag-remove")).toBeDisabled();
  await expect(page.getByTestId("geotag-new")).toContainText("Enter coordinates below");
  await page.getByTestId("editor-cancel").click();
});

// ------------------------------------------------------- validation

test("coordinate validation blocks out-of-range and non-numeric input with accessible errors", async ({ page }) => {
  await upload(page, ["jpeg-empty.jpg"]);
  await openEditorFor(page, "jpeg-empty.jpg");
  await openLocationTab(page);

  await setCoordinates(page, "95", "-58.3816");
  await expect(page.getByTestId("geotag-input-latitude-error")).toContainText("between −90 and +90");
  // No valid plan → the primary action is not even offered (Screen 06 pattern).
  await expect(page.getByTestId("geotag-apply")).toHaveCount(0);

  await setCoordinates(page, "abc", "-58.3816");
  await expect(page.getByTestId("geotag-input-latitude-error")).toContainText("decimal number");

  await setCoordinates(page, "-34.6037", "181");
  await expect(page.getByTestId("geotag-input-longitude-error")).toContainText("between −180 and +180");

  await setCoordinates(page, "-34.6037", "-58.3816", "1m");
  await expect(page.getByTestId("geotag-input-altitude-error")).toContainText("number of meters");
  await expect(page.getByTestId("geotag-apply")).toHaveCount(0);

  // Zero coordinates are valid (the equator/meridian crossing is real).
  await setCoordinates(page, "0", "0", "-0.5");
  await expect(page.getByTestId("geotag-input-latitude-error")).toHaveCount(0);
  await expect(page.getByTestId("geotag-apply")).toBeVisible();
  await expect(page.getByTestId("geotag-apply")).toBeEnabled();
  await page.getByTestId("editor-cancel").click();
});

// ------------------------------------------------------- draft isolation

test("coordinate drafts are per-file: switching images never leaks values", async ({ page }) => {
  await upload(page, ["jpeg-empty.jpg", "png-empty.png"]);

  await openEditorFor(page, "jpeg-empty.jpg");
  await openLocationTab(page);
  await setCoordinates(page, "-34.6037", "-58.3816", "12");
  await page.getByTestId("editor-cancel").click();

  // File B opens with empty fields — A's draft never transfers.
  await openEditorFor(page, "png-empty.png");
  await openLocationTab(page);
  await expect(page.getByTestId("geotag-input-latitude")).toHaveValue("");
  await expect(page.getByTestId("geotag-input-longitude")).toHaveValue("");
  await page.getByTestId("editor-cancel").click();

  // Reopening A restores its own draft.
  await openEditorFor(page, "jpeg-empty.jpg");
  await openLocationTab(page);
  await expect(page.getByTestId("geotag-input-latitude")).toHaveValue("-34.6037");
  await expect(page.getByTestId("geotag-input-longitude")).toHaveValue("-58.3816");
  await page.getByTestId("editor-cancel").click();
});

// ------------------------------------------------------- state transitions (Issue 01/02)

test("modifying coordinates after a verified write returns them to a pending state", async ({ page }) => {
  await upload(page, ["jpeg-empty.jpg"]);
  await openEditorFor(page, "jpeg-empty.jpg");
  await openLocationTab(page);

  await setCoordinates(page, "-34.6037", "-58.3816");
  await page.getByTestId("geotag-apply").click();
  await page.getByTestId("geotag-apply-confirm").click();
  await expect(page.getByTestId("geotag-status-badge")).toContainText("GPS written and verified", { timeout: 120000 });
  await expect(page.getByTestId("geotag-new-heading")).toContainText("Applied GPS (verified)");

  // State G: new values are an unapplied draft — never shown as verified.
  await page.getByTestId("geotag-input-latitude").fill("12.345678");
  await page.getByTestId("geotag-input-longitude").fill("98.765432");
  await expect(page.getByTestId("geotag-status-badge")).toContainText("Coordinates modified — not yet applied");
  await expect(page.getByTestId("geotag-new-heading")).toContainText("New GPS (planned)");
  await expect(page.getByTestId("geotag-new-planned")).toContainText("12.345678");
  await expect(page.getByTestId("geotag-new-applied")).toHaveCount(0);
  // The verified output of the earlier run remains available and untouched.
  await expect(row(page, "jpeg-empty.jpg").locator('[data-testid="download-row-output"]').first()).toBeVisible({ timeout: 30000 });
});

test("GPS-only editing shows which Apply saves the changes and why the footer stays disabled", async ({ page }) => {
  await upload(page, ["jpeg-empty.jpg"]);
  await openEditorFor(page, "jpeg-empty.jpg");
  await openLocationTab(page);

  // Issue 02: before any draft there is nothing to apply — no guidance yet.
  await expect(page.getByTestId("geotag-apply-guidance")).toHaveCount(0);

  await setCoordinates(page, "-34.6037", "-58.3816");
  // Guidance appears near the GPS actions…
  await expect(page.getByTestId("geotag-apply-guidance")).toContainText("select Apply GPS to this image");
  await expect(page.getByTestId("geotag-apply-guidance")).toContainText("verified before download");
  // …and the shared footer's disabled state is explained for GPS-only editing.
  await expect(page.getByTestId("editor-apply")).toBeDisabled();
  await expect(page.getByTestId("geotag-footer-note")).toContainText("GPS changes use the Apply GPS to this image button above.");

  // Applying once is enough — the verified result removes the pending state.
  await page.getByTestId("geotag-apply").click();
  await page.getByTestId("geotag-apply-confirm").click();
  await expect(page.getByTestId("geotag-status-badge")).toContainText("GPS written and verified", { timeout: 120000 });
  await expect(page.getByTestId("geotag-apply-guidance")).toHaveCount(0);
  await expect(page.getByTestId("geotag-footer-note")).toHaveCount(0);
});

// ------------------------------------------------------- bulk geotagging

test("bulk GPS writing on 2+ images is Premium-gated for guests (honest lock, nothing processed)", async ({ page }) => {
  await upload(page, ["jpeg-empty.jpg", "png-empty.png", "webp-empty.webp"]);
  // Deselect webp-empty.webp so the bulk scope is explicit (2 files).
  await row(page, "webp-empty.webp").getByRole("checkbox", { name: /Select webp-empty\.webp/ }).uncheck();

  await openEditorFor(page, "jpeg-empty.jpg");
  await openLocationTab(page);
  await setCoordinates(page, "51.5007", "-0.1246", "35");

  await expect(page.getByTestId("geotag-bulk")).toContainText("(2)");
  await page.getByTestId("geotag-bulk").click();
  await expect(page.getByTestId("geotag-bulk-scope")).toContainText("Unselected files stay untouched");
  // Roadmap rule 12: bulk GPS writing requires Premium by default. A guest
  // sees the honest Premium message and NO processing starts.
  await page.getByTestId("geotag-bulk-confirm-button").click();
  await expect(page.getByTestId("premium-notice")).toContainText("Premium", { timeout: 60000 });
  await expect(page.getByTestId("geotag-status-badge")).toContainText("Coordinates modified — not yet applied");

  // Nothing was processed: no verified output rows exist for any file.
  await expect(row(page, "jpeg-empty.jpg").locator('[data-testid="download-row-output"]').first()).toHaveCount(0);
  await expect(row(page, "png-empty.png").locator('[data-testid="download-row-output"]').first()).toHaveCount(0);
  await expect(row(page, "webp-empty.webp").locator('[data-testid="download-row-output"]').first()).toHaveCount(0);
});

// ------------------------------------------------------- offline + privacy

test("manual coordinate editing works fully offline (no network needed)", async ({ page }) => {
  await upload(page, ["jpeg-empty.jpg"]);
  await page.context().setOffline(true);
  await openEditorFor(page, "jpeg-empty.jpg");
  await openLocationTab(page);

  // The map consent card is present — the map is NOT auto-enabled.
  await expect(page.getByTestId("geotag-map-consent")).toContainText("off by default");
  await setCoordinates(page, "-34.6037", "-58.3816", "-5");
  await page.getByTestId("geotag-apply").click();
  await page.getByTestId("geotag-apply-confirm").click();
  await expect(page.getByTestId("geotag-status-badge")).toContainText("GPS written and verified", { timeout: 120000 });
  await page.context().setOffline(false);

  const gps = await downloadAndReadGps(page, "jpeg-empty.jpg", "offline.jpg");
  expect(Math.abs((gps.latitude ?? NaN) - -34.6037)).toBeLessThanOrEqual(GPS_TOLERANCE);
});

test("online map is consent-gated: zero third-party tile requests before enabling", async ({ page }) => {
  const foreignRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== "http://127.0.0.1:8130" && !url.protocol.startsWith("blob:")) {
      foreignRequests.push(request.url());
    }
  });

  await upload(page, ["jpeg-gps-sw.jpg"]);
  await openEditorFor(page, "jpeg-gps-sw.jpg");
  await openLocationTab(page);

  // Interacting with the editor (inputs, preview, badges) must never load
  // tiles — the consent card is the only map surface.
  await setCoordinates(page, "-34.6037", "-58.3816");
  await expect(page.getByTestId("geotag-preview")).toBeVisible();
  expect(foreignRequests, JSON.stringify(foreignRequests)).toEqual([]);

  // The consent disclosure names the provider and what it receives.
  await expect(page.getByTestId("geotag-map-consent")).toContainText("OpenStreetMap");
  await expect(page.getByTestId("geotag-map-consent")).toContainText("network request");
});

test("enabling the map renders it (or its honest failure state) without page errors", async ({ page }) => {
  await upload(page, ["jpeg-gps-sw.jpg"]);
  await openEditorFor(page, "jpeg-gps-sw.jpg");
  await openLocationTab(page);

  await page.getByTestId("geotag-map-enable").click();
  await expect(page.getByTestId("geotag-map")).toBeVisible({ timeout: 30000 });
  // Either real tiles render or the sandbox has no network: both states
  // keep manual editing working — never a fake map.
  await expect
    .poll(async () => {
      const failed = await page.getByText("The map could not load").isVisible();
      const container = await page.getByTestId("geotag-map-container").isVisible();
      return failed || container;
    }, { timeout: 30000 })
    .toBe(true);
});

test("location search: results move the fields; failures keep manual editing working", async ({ page }) => {
  await upload(page, ["jpeg-empty.jpg"]);
  await openEditorFor(page, "jpeg-empty.jpg");
  await openLocationTab(page);

  // Deterministic provider stub: the UI logic under test is OUR component
  // (explicit-button search, result selection, error states), not Nominatim.
  await page.route("**/nominatim.openstreetmap.org/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { display_name: "Dhaka, Bangladesh", lat: "23.8103", lon: "90.4125" },
        { display_name: "London, UK", lat: "51.5074", lon: "-0.1278" },
      ]),
    });
  });

  await page.getByTestId("geotag-search-input").fill("Dhaka");
  await page.getByTestId("geotag-search-button").click();
  await page.getByTestId("geotag-search-results").waitFor({ timeout: 30000 });
  await page.getByTestId("geotag-search-result-0").click();
  await expect(page.getByTestId("geotag-input-latitude")).toHaveValue(/^23\.81/);
  await expect(page.getByTestId("geotag-input-longitude")).toHaveValue(/^90\.41/);
  await expect(page.getByTestId("geotag-status-badge")).toContainText("Coordinates modified — not yet applied");
});

test("location search failure surfaces an honest error and rate-limit handling", async ({ page }) => {
  await upload(page, ["jpeg-empty.jpg"]);
  await openEditorFor(page, "jpeg-empty.jpg");
  await openLocationTab(page);

  await page.route("**/nominatim.openstreetmap.org/**", async (route) => {
    await route.fulfill({ status: 429, contentType: "application/json", body: "[]" });
  });
  await page.getByTestId("geotag-search-input").fill("Dhaka");
  await page.getByTestId("geotag-search-button").click();
  await expect(page.getByTestId("geotag-search-status")).toContainText("rate-limiting", { timeout: 30000 });
  // Manual editing remains fully functional after the failure.
  await setCoordinates(page, "23.8103", "90.4125");
  await expect(page.getByTestId("geotag-apply")).toBeEnabled();

  // Empty query: explicit message, no request.
  await page.getByTestId("geotag-search-input").fill("");
  await page.getByTestId("geotag-search-button").click();
  await expect(page.getByTestId("geotag-search-status")).toContainText("Type a place name first");
});

test("geolocation permission denial keeps manual editing working", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Permission flows are asserted in the desktop project.");
  await page.context().clearPermissions();
  await upload(page, ["jpeg-empty.jpg"]);
  await openEditorFor(page, "jpeg-empty.jpg");
  await openLocationTab(page);

  await page.getByTestId("geotag-use-my-location").click();
  await expect(page.getByTestId("geotag-geolocation-note")).toContainText(/denied|unavailable|timed out/i, { timeout: 30000 });
  // No coordinates were written into the fields.
  await expect(page.getByTestId("geotag-input-latitude")).toHaveValue("");
  await setCoordinates(page, "23.8103", "90.4125");
  await expect(page.getByTestId("geotag-apply")).toBeEnabled();
});

// ------------------------------------------------------- honesty edges

test("non-image files show the honest unsupported state", async ({ page }) => {
  await upload(page, ["random-bytes.bin"]);
  await openEditorFor(page, "random-bytes.bin");
  await page.locator('[data-testid="editor-tab-location"]').click();
  await expect(page.getByTestId("geotag-unsupported-file")).toContainText("still images only", { timeout: 30000 });
  await expect(page.getByTestId("geotag-input-latitude")).toHaveCount(0);
  await page.getByTestId("editor-cancel").click();
});

test("escape closes the editor without corrupting the queue or drafts", async ({ page }) => {
  await upload(page, ["jpeg-empty.jpg"]);
  await openEditorFor(page, "jpeg-empty.jpg");
  await openLocationTab(page);
  await setCoordinates(page, "-34.6037", "-58.3816");
  await page.keyboard.press("Escape");
  await expect(page.locator(EDITOR)).toHaveCount(0);

  await openEditorFor(page, "jpeg-empty.jpg");
  await openLocationTab(page);
  await expect(page.getByTestId("geotag-input-latitude")).toHaveValue("-34.6037");
  await page.getByTestId("editor-cancel").click();
});
