import { expect, test, type Page } from "@playwright/test";
import { closeDetailsModal, detailsDialog, detailsPanel, openDetailsTab, row, upload } from "./helpers";

/**
 * Screen 05 — Image details dialog: real evidence, honest states,
 * queue navigation and a11y against the production static export.
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

/** The dialog always renders one panel per tab in the wrapped grid. */
const TAB_SCAN_COUNT = 8;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as unknown as Record<string, unknown>;
    delete target["showSaveFilePicker"];
  });
  await page.goto("/");
});

async function openDetailsFor(page: Page, name: string) {
  await row(page, name).getByRole("button", { name: "View details" }).click({ timeout: 120000 });
  await detailsDialog(page).waitFor({ timeout: 60000 });
  await expect(page.getByTestId("details-title")).toContainText(name);
}

test("rich inspection results are shown with actual field names and values", async ({ page }) => {
  await upload(page, ["jpeg-xmp-iptc.jpg"]);
  await openDetailsFor(page, "jpeg-xmp-iptc.jpg");

  // Honest lifecycle chips; no inline copy of the dialog exists.
  await expect(page.locator('[data-testid="details-status-chips"]')).toContainText("Inspection completed");
  await expect(page.locator('[data-testid="queue-item-details"]')).toHaveCount(0);

  // Overview default: summary cards derive from the real result.
  const cards = page.locator('[data-testid="details-overview-cards"]');
  await expect(cards).toContainText("AI indicators");
  await expect(cards).toContainText("Standard metadata");
  await expect(cards.locator('[data-testid="details-card-ai"]')).toContainText("Not found");
  await expect(cards.locator('[data-testid="details-card-c2pa"]')).toContainText("No manifest");
  await expect(cards.locator('[data-testid="details-card-standard"]')).toContainText("EXIF, XMP, IPTC, GPS");
  await expect(cards.locator('[data-testid="details-card-format"]')).toContainText("JPEG");

  await page.screenshot({ path: "e2e/artifacts/screen-05/01-overview-rich-metadata.png", animations: "disabled" });

  // EXIF tab exposes real field keys and values, not only totals.
  await openDetailsTab(page, "exif");
  const exifPanel = page.locator('[data-testid="details-panel-exif"]:not([hidden])');
  await expect(exifPanel).toContainText("TestCam");
  expect(await exifPanel.locator("dl dt").count()).toBeGreaterThan(3);

  // XMP/IPTC/GPS tabs keep their own field lists; deliverable captures are
  // taken per tab with deterministic active-tab assertions first.
  await openDetailsTab(page, "xmp");
  const xmpPanel = page.locator('[data-testid="details-panel-xmp"]:not([hidden])');
  await expect(xmpPanel).toContainText("Synthetic test photo of a harbor at noon");
  await expect(page.locator('[data-testid="details-tab-xmp"]')).toHaveAttribute("aria-selected", "true");

  await openDetailsTab(page, "iptc");
  const iptcPanel = page.locator('[data-testid="details-panel-iptc"]:not([hidden])');
  await expect(iptcPanel).toContainText("Harbor Noon");
  await expect(iptcPanel.locator("dl dt").first()).toBeVisible();
  // Synchronization proof: only IPTC is selected, only ITS panel is shown,
  // and no GPS/exif field leaks into the visible IPTC panel.
  await expect(page.locator('[data-testid="details-tab-iptc"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-testid="details-tab-gps"]')).toHaveAttribute("aria-selected", "false");
  await expect(page.locator('[data-testid="details-panel-gps"]')).toHaveAttribute("hidden", "");
  await expect(iptcPanel).not.toContainText("Latitude");
  await page.screenshot({ path: "e2e/artifacts/screen-05/03a-iptc-tab.png", animations: "disabled" });

  await openDetailsTab(page, "gps");
  const gpsPanel = page.locator('[data-testid="details-panel-gps"]:not([hidden])');
  // Real coordinates from the file — shown as text, never geocoded.
  await expect(gpsPanel).toContainText("Latitude");
  await expect(gpsPanel).toContainText("no place names are derived");
  await expect(page.locator('[data-testid="details-tab-gps"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-testid="details-tab-iptc"]')).toHaveAttribute("aria-selected", "false");
  await expect(page.locator('[data-testid="details-panel-iptc"]')).toHaveAttribute("hidden", "");
  await expect(gpsPanel).not.toContainText("Harbor Noon");
  await page.screenshot({ path: "e2e/artifacts/screen-05/03b-gps-tab.png", animations: "disabled" });

  // Long values render as text inside the internally scrolling dialog;
  // the page itself never grows horizontally.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);

  await closeDetailsModal(page);
});

test("AI and C2PA-bearing fixture shows qualified evidence and validator truth", async ({ page }) => {
  await upload(page, ["signed-c2pa.jpg"]);
  await openDetailsFor(page, "signed-c2pa.jpg");

  const panel = detailsPanel(page);
  await openDetailsTab(page, "ai");
  await expect(panel).toContainText("trainedAlgorithmicMedia");
  await expect(page.locator('[data-testid="details-tab-ai"]')).toContainText("2");
  await page.screenshot({ path: "e2e/artifacts/screen-05/02a-ai-evidence.png", animations: "disabled" });

  await openDetailsTab(page, "c2pa");
  // Sorting axes stay visibly labeled: presence, cryptographic state,
  // signer, failures — with the unchanged validator output below.
  await expect(page.locator('[data-testid="details-c2pa-legend"]')).toContainText("How to read these C2PA results");
  await expect(page.locator('[data-testid="details-c2pa-legend"]')).toContainText("cryptographic");
  const sections = page.locator('[data-testid="details-c2pa-sections"]');
  await expect(sections).toContainText("Manifest Store");
  await expect(sections).toContainText("Validation State");
  await expect(sections).toContainText("Valid");
  await expect(sections).toContainText("reported 1 failure");
  await expect(sections).toContainText("signingCredential.untrusted");
  await expect(sections).toContainText("Do not treat the claim as trusted");
  await expect(sections).toContainText("AI Metadata Remover P0 proof signer");
  await expect(sections).not.toContainText("claimSignature.mismatch");
  await page.screenshot({ path: "e2e/artifacts/screen-05/02b-c2pa-details.png", animations: "disabled" });

  await closeDetailsModal(page);
});

test("every tab shows only its own category immediately after activation", async ({ page }) => {
  await upload(page, ["jpeg-xmp-iptc.jpg", "jpeg-openai.jpg"]);
  await openDetailsFor(page, "jpeg-xmp-iptc.jpg");

  const cases = [
    {
      tab: "overview",
      must: ["Metadata overview", "Standard metadata"],
      absent: ["Latitude", "Harbor Noon"],
    },
    {
      tab: "ai",
      must: ["No AI-associated metadata indicators found", "Metadata indicators are not proof of AI creation"],
      absent: ["Latitude", "TestCam"],
    },
    {
      tab: "c2pa",
      must: ["not detected", "No embedded C2PA Manifest Store identifier was found"],
      absent: ["TestCam", "Harbor Noon"],
    },
    {
      tab: "exif",
      must: ["TestCam"],
      absent: ["Harbor Noon"],
    },
    {
      tab: "xmp",
      must: ["Synthetic test photo of a harbor at noon", "Phase Two Test Creator"],
      absent: ["TestCam", "Latitude"],
    },
    {
      tab: "iptc",
      must: ["Harbor Noon"],
      absent: ["TestCam", "Latitude"],
    },
    {
      tab: "gps",
      must: ["Latitude", "Longitude", "Altitude"],
      absent: ["TestCam", "Harbor Noon"],
    },
    {
      tab: "technical",
      must: ["Container, geometry and color-profile details"],
      absent: ["Latitude", "Harbor Noon"],
    },
  ] as const;

  for (const expectation of cases) {
    await openDetailsTab(page, expectation.tab);
    const visiblePanel = page.locator(`[data-testid="details-panel-${expectation.tab}"]:not([hidden])`);
    for (const token of expectation.must) {
      await expect(visiblePanel, `${expectation.tab} must show its own category (${token})`).toContainText(token);
    }
    // The Overview deliberately nests drill-down findings (collapsed by
    // default), so its cross-family check scopes to the summary cards row;
    // family tabs must not carry any other family's fields at all.
    const absentTarget = expectation.tab === "overview"
      ? page.locator('[data-testid="details-overview-cards"]')
      : visiblePanel;
    for (const token of expectation.absent) {
      await expect(absentTarget, `${expectation.tab} must not show another category (${token})`).not.toContainText(token);
    }
    await expect(page.locator(`[data-testid="details-tab-${expectation.tab}"]`)).toHaveAttribute("aria-selected", "true");
    // Only the activated panel is visible; the previous one is hidden again.
    const hiddenPanels = page.locator('[role="tabpanel"][hidden=""]');
    expect(await hiddenPanels.count()).toBe(TAB_SCAN_COUNT - 1);
  }

  // Qualified AI evidence surfaces on a file that actually carries them.
  await closeDetailsModal(page);
  await openDetailsFor(page, "jpeg-openai.jpg");
  await openDetailsTab(page, "ai");
  await expect(page.locator('[data-testid="details-panel-ai"]:not([hidden])')).toContainText(
    'Generator signature "openai" in CreatorTool',
  );
  await expect(page.locator('[data-testid="details-panel-ai"]:not([hidden])')).toContainText("OpenAI GPT-Image");

  await closeDetailsModal(page);
});

test("dialog navigation across a 10-file queue never mixes file evidence", async ({ page }) => {
  await upload(page, TEN_FILES);
  await expect(page.locator('[data-testid="queue-item"]')).toHaveCount(10);
  await openDetailsFor(page, "jpeg-exif.jpg");

  await expect(page.locator('[data-testid="details-nav"]')).toContainText("1/10");
  await page.getByTestId("details-next").click();
  await expect(page.getByTestId("details-title")).toContainText("jpeg-openai.jpg");

  // Switched file resets to the Overview tab with that file's honest counts.
  await expect(page.locator('[data-testid="details-nav"]')).toContainText("2/10");
  const activeTabOnNav = page.locator('[data-testid="details-tab-overview"]');
  await expect(activeTabOnNav).toHaveAttribute("aria-selected", "true");

  // One awaited click per step keeps each navigation observable.
  const forwardFiles = ["jpeg-gps-sw.jpg", "jpeg-xmp-iptc.jpg", "jpeg-icc.jpg", "png-c2pa-forged-cabx.png", "signed-c2pa.jpg"];
  for (const name of forwardFiles) {
    await page.getByTestId("details-next").click();
    await expect(page.getByTestId("details-title")).toContainText(name);
  }
  const badge = page.locator('[data-testid="details-tab-c2pa"] span.tabular-nums');
  await expect(badge).toHaveText(/^[0-9]+$/);

  await openDetailsTab(page, "c2pa");
  await expect(detailsPanel(page)).toContainText("AI Metadata Remover P0 proof signer");

  // Step back: the previous file must not keep the signed file's evidence.
  const backwardFiles = ["png-c2pa-forged-cabx.png", "jpeg-icc.jpg", "jpeg-xmp-iptc.jpg", "jpeg-gps-sw.jpg", "jpeg-openai.jpg", "jpeg-exif.jpg"];
  for (const name of backwardFiles) {
    await page.getByTestId("details-prev").click();
    await expect(page.getByTestId("details-title")).toContainText(name);
  }
  await expect(detailsPanel(page).getByText("AI Metadata Remover P0 proof signer")).toHaveCount(0);
  await expect(page.locator('[data-testid="details-prev"]')).toBeDisabled();
  await openDetailsTab(page, "c2pa");
  await expect(page.locator('[data-testid="details-tab-c2pa"] span.tabular-nums')).toHaveCount(0);

  await closeDetailsModal(page);
});

test("no verified cleaned download before cleaning; original vs verified output after", async ({ page }) => {
  await upload(page, ["signed-c2pa.jpg"]);
  await openDetailsFor(page, "signed-c2pa.jpg");

  // Header offers no download until a verified output exists…
  await expect(page.locator('[data-testid="details-modal"] [data-testid="details-download"]')).toHaveCount(0);
  // …and cleaning starts through the SAME verified per-file pipeline.
  await page.getByTestId("details-remove").click();
  await expect(page.locator('[data-testid="details-status-chips"]')).toContainText("Cleaned · verified", { timeout: 120000 });

  // Original findings (before) are labeled separately from the
  // re-inspected verified output; counts are never passed off as "left".
  const verified = page.locator('[data-testid="details-verified-output"]');
  await expect(verified).toBeVisible();
  await expect(page.locator('[data-testid="details-original-caption"]')).toContainText("Original findings · before cleaning");
  await expect(verified).toContainText("reported 1 failure");
  await expect(verified).toContainText("not detected");

  // Only now does the dialog offer the verified cleaned copy.
  const download = page.locator('[data-testid="details-modal"] [data-testid="details-download"]');
  await expect(download).toContainText("cleaned");
  await expect(verified.locator('[data-testid="download-cleaned"]')).toBeVisible();

  await page.screenshot({ path: "e2e/artifacts/screen-05/05-after-clean-before-after.png" });
  await closeDetailsModal(page);
  // The row surface keeps its own verified-output flow (desktop + mobile layers).
  await expect(row(page, "signed-c2pa.jpg").locator('[data-testid="download-row-output"]').first()).toBeVisible();
});

test("closes by Escape and backdrop, restores focus, keeps geometry", async ({ page }) => {
  await upload(page, ["png-text-exif.png"]);
  await openDetailsFor(page, "png-text-exif.png");

  // Honest empty state: this fixture has no GPS coordinates.
  await openDetailsTab(page, "gps");
  await expect(page.locator('[data-testid="details-panel-gps"]')).toContainText("Inspected — nothing in this group.");
  await openDetailsTab(page, "overview");

  const opener = row(page, "png-text-exif.png").getByRole("button", { name: /View details|Hide details|Inspect metadata/ }).first();
  const overflow = async () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBe(0);

  // Escape closes and restores focus to the initiating row action.
  await page.keyboard.press("Escape");
  await expect(detailsDialog(page)).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(await overflow()).toBe(0);

  // Reopen → header X close.
  await openDetailsFor(page, "png-text-exif.png");
  await page.getByTestId("details-close").click();
  await expect(detailsDialog(page)).toHaveCount(0);
  await expect(opener).toBeFocused();

  // Reopen → backdrop click at the overlay edge closes too.
  await openDetailsFor(page, "png-text-exif.png");
  await page.mouse.click(12, 320);
  await expect(detailsDialog(page)).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("keyboard tabs and focus trap behave per WAI-ARIA", async ({ page }) => {
  await upload(page, ["jpeg-xmp-iptc.jpg"]);
  await openDetailsFor(page, "jpeg-xmp-iptc.jpg");

  const overviewTab = page.locator('[data-testid="details-tab-overview"]');
  await expect(overviewTab).toHaveAttribute("aria-selected", "true");

  // Arrow keys move and activate the roving focus.
  await overviewTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('[data-testid="details-tab-ai"]')).toHaveAttribute("aria-selected", "true");
  expect(await page.locator('[data-testid="details-tab-ai"]').evaluate((el: HTMLElement) => el === document.activeElement)).toBe(true);
  await page.keyboard.press("Home");
  await expect(overviewTab).toHaveAttribute("aria-selected", "true");
  await expect(overviewTab).toBeFocused();

  // Tab cycles into dialog content and never escapes the dialog.
  const dialog = detailsDialog(page);
  await page.keyboard.press("Tab");
  const lastFocus = await page.evaluate(() => document.activeElement);
  expect(lastFocus).not.toBeNull();
  const inside = await page.evaluate(() => {
    const dialogEl = document.querySelector('[data-testid="details-modal"]');
    return dialogEl?.contains(document.activeElement) ?? false;
  });
  expect(inside).toBe(true);

  // Escape still closes from inside deeper focus.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("desktop tab navigation: every category reachable, active tab fully visible", async ({ page }) => {
  await upload(page, ["jpeg-xmp-iptc.jpg"]);
  await openDetailsFor(page, "jpeg-xmp-iptc.jpg");

  const tablist = page.locator('[data-testid="details-tabs"]');
  await expect(tablist).toBeVisible();

  // Keyboard: End jumps straight to Technical (last tab) and activates it.
  const overviewTab = page.locator('[data-testid="details-tab-overview"]');
  await overviewTab.focus();
  await page.keyboard.press("End");
  await expect(page.locator('[data-testid="details-tab-technical"]')).toHaveAttribute("aria-selected", "true");

  // The active tab is fully inside the strip's own scroll viewport —
  // activation always scrolls it into view (never permanently clipped).
  const visibility = await page.evaluate(() => {
    const strip = document.querySelector('[data-testid="details-tabs"]');
    const active = strip?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!strip || !active) return null;
    const stripRect = strip.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    return {
      inside: activeRect.left >= stripRect.left - 1 && activeRect.right <= stripRect.right + 1,
      /** Desktop width: all eight tabs fit without any strip scrolling. */
      noOverflow: strip.scrollWidth <= strip.clientWidth,
      activeWidth: activeRect.width,
    };
  });
  expect(visibility).not.toBeNull();
  expect(visibility?.inside).toBe(true);
  expect(visibility?.noOverflow).toBe(true);
  expect(visibility?.activeWidth).toBeGreaterThan(30);

  await page.screenshot({ path: "e2e/artifacts/screen-05/06-desktop-tab-navigation.png", animations: "disabled" });

  // Pointer clicks reach every tab (even the edge ones, via strip scrolling).
  for (const tab of ["ai", "c2pa", "exif", "xmp", "iptc", "gps", "technical", "overview"]) {
    await page.locator(`[data-testid="details-tab-${tab}"]`).click();
    await expect(page.locator(`[data-testid="details-tab-${tab}"]`)).toHaveAttribute("aria-selected", "true");
  }

  await closeDetailsModal(page);
});

test("duplicate React keys never surface while switching tabs and files", async ({ page }) => {
  const keyProblems: string[] = [];
  page.on("console", (message) => {
    if (/deduplicate|same key|Encountered two children/i.test(message.text())) keyProblems.push(message.text());
  });
  await upload(page, TEN_FILES);
  await openDetailsFor(page, "signed-c2pa.jpg");
  for (const tabId of ["ai", "c2pa", "exif", "xmp", "iptc", "gps", "technical", "overview"]) {
    await openDetailsTab(page, tabId);
  }
  await page.getByTestId("details-next").click();
  await expect(page.getByTestId("details-title")).toContainText("signed-c2pa.png");
  await openDetailsTab(page, "c2pa");
  await openDetailsTab(page, "overview");
  expect(keyProblems).toEqual([]);
});
