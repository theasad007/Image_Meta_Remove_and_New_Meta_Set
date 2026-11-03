import { expect, type Page } from "@playwright/test";
import path from "node:path";

export const FIXTURES = path.join(__dirname, "..", "src", "test-fixtures");
export const fixture = (name: string) => path.join(FIXTURES, name);

export async function upload(page: Page, names: string[]) {
  await page.locator('[data-testid="file-input"]').setInputFiles(names.map(fixture));
  for (const name of names) {
    await page.locator('[data-testid="queue-item"]', { hasText: name }).first().waitFor();
  }
}

export function row(page: Page, name: string) {
  return page.locator('[data-testid="queue-item"]', { hasText: name }).first();
}

export async function inspectRow(page: Page, name: string) {
  const item = row(page, name);
  const view = item.getByRole("button", { name: "View details" });
  const inspect = item.getByRole("button", { name: "Inspect metadata" });
  await view.or(inspect).first().waitFor({ timeout: 120000 });
  await closeDetailsModal(page);
  if (await view.isVisible()) {
    // Screen 05: View details opens the image-details dialog.
    await view.click();
    await page.locator('[data-testid="details-modal"]').waitFor({ timeout: 60000 });
  } else {
    // Row without a committed result: manual inspection auto-expands the
    // inline post-process surface (Screen 04 behavior).
    await inspect.click();
  }
  await page.locator('[data-testid="inspector-panel"]').first().waitFor();
}

/* ---------------------------------------------------------------------------
 * Screen 05 — image details dialog helpers.
 * ------------------------------------------------------------------------- */

/** The Screen 05 dialog root (portaled to document.body). */
export function detailsDialog(page: Page) {
  return page.locator('[data-testid="details-modal"]');
}

/** The detailed inspection region inside the Screen 05 dialog. */
export function detailsPanel(page: Page) {
  return page.locator('[data-testid="details-modal"] [data-testid="inspector-panel"]');
}

/** Switch the dialog to a metadata tab by its id (overview, c2pa, exif…). */
export async function openDetailsTab(page: Page, tabId: string) {
  await page.locator(`[data-testid="details-tab-${tabId}"]`).click();
}

/** Closes the dialog when open; no-op otherwise. */
export async function closeDetailsModal(page: Page) {
  if ((await detailsDialog(page).count()) === 0) return;
  await page.getByTestId("details-close").click();
  await detailsDialog(page).waitFor({ state: "detached", timeout: 30000 });
}

export async function cleanRow(page: Page, name: string) {
  const selectAll = page.getByRole("checkbox", { name: "Select all files" });
  if (await selectAll.isChecked()) await selectAll.uncheck();
  await row(page, name).getByRole("checkbox", { name: `Select ${name}` }).check();
  const clean = page.locator('[data-testid="batch-clean-all"]');
  await expect(clean).toBeEnabled({ timeout: 120000 });
  await clean.click();
  await page.locator('[data-testid="before-after-panel"]').waitFor();
}

/* ---------------------------------------------------------------------------
 * Screen 04 (after-upload workspace) locator helpers.
 *
 * Queue rows render a desktop table layout AND a compact mobile card from
 * the same data, so row-scoped locators can resolve twice under strict
 * mode. These helpers scope to the intended surface; the assertions below
 * are re-uses of the existing checks, not longer versions of them.
 * ------------------------------------------------------------------------- */

/** The row's verified-output button (desktop grid + mobile card render one each). */
export function rowOutput(page: Page, name: string) {
  return row(page, name).locator('[data-testid="download-row-output"]').first();
}

/** The row's preview image (desktop + mobile thumbnails render one each). */
export function rowImage(page: Page, name: string) {
  return row(page, name).locator("img").first();
}

/** Detached-row removal launched from the row's red X button (visible copy only — the row renders desktop + mobile layers). */
export async function removeRow(page: Page, name: string) {
  await row(page, name).locator('[data-testid="queue-remove"]').locator("visible=true").click();
}

/** The Audit reports options live behind a closed "Report options" disclosure. */
export async function openReportOptions(page: Page) {
  const details = page.locator('[data-testid="report-options"]');
  if ((await details.getAttribute("open")) === null) {
    await page.locator('[data-testid="report-options-toggle"]').click();
  }
}
