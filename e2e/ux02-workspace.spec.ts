import { expect, test } from "@playwright/test";
import { closeDetailsModal, detailsPanel, row, rowOutput, upload } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as unknown as Record<string, unknown>;
    delete target["showSaveFilePicker"];
  });
  await page.goto("/");
});

test("two tools share one queue, keep evidence in the row, and expose direct verified download", async ({ page }) => {
  await upload(page, ["jpeg-openai.jpg"]);

  const item = row(page, "jpeg-openai.jpg");
  await expect(page.locator('[data-testid="queue-toolbar"]')).toBeVisible();
  await expect(page.locator('[data-testid="tool-ai_metadata"]')).toHaveAttribute("aria-selected", "true");
  await page.locator('[data-testid="tool-metadata_geotag"]').click();
  await expect(page.locator('[data-testid="tool-metadata_geotag"]')).toHaveAttribute("aria-selected", "true");
  await expect(item).toContainText("EXIF");

  // Screen 05: View details opens the image-details dialog (no inline copy).
  await expect(item.getByRole("button", { name: "View details" })).toBeVisible({ timeout: 120000 });
  await item.getByRole("button", { name: "View details" }).click();
  await expect(detailsPanel(page)).toBeVisible();
  await expect(page.locator('[data-testid="details-title"]')).toContainText("jpeg-openai.jpg");
  await expect(page.locator('[data-testid="details-preview"]')).toBeVisible();
  await expect(page.locator('[data-testid="queue-item-details"]')).toHaveCount(0);

  // Closing restores the initiating row action before other row buttons are used.
  await closeDetailsModal(page);

  // Screen 06: the row Edit button opens the single-image editor for that
  // file; cancelling keeps the queue and file untouched.
  await item.getByRole("button", { name: /Edit metadata/i }).click();
  const editor = page.locator('[data-testid="editor-modal"]');
  await expect(editor).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId("editor-title")).toContainText("Edit Metadata");
  await expect(page.getByTestId("editor-file-meta")).toContainText("jpeg-openai.jpg");
  await page.getByTestId("editor-cancel").click();
  await expect(editor).toHaveCount(0);
  await expect(page.locator('[data-testid="queue-item"]')).toHaveCount(1);

  const aiRemoval = page.locator('[data-testid="remove-ai-metadata"]');
  await expect(aiRemoval).toBeEnabled({ timeout: 120000 });
  await aiRemoval.click();
  await expect(item.locator('[data-testid="before-after-panel"]')).toBeVisible();
  await expect(item.locator('[data-testid="before-after-panel"]')).toContainText("AI-focused scope");

  const download = page.waitForEvent("download");
  await rowOutput(page, "jpeg-openai.jpg").click();
  await expect((await download).suggestedFilename()).toContain("-clean.");

  await item.getByRole("button", { name: "Hide details" }).click();
  await expect(item.locator('[data-testid="queue-item-details"]')).toHaveCount(0);
});

test("rewrite bridge points to the account profile without duplicating its editor", async ({ page }) => {
  await upload(page, ["jpeg-exif.jpg"]);
  const rewrite = page.getByRole("button", { name: /Remove & Rewrite/i });
  await expect(rewrite).toBeEnabled({ timeout: 120000 });
  await rewrite.click();

  await expect(page.locator("p").filter({ hasText: /Sign in on your profile page/i })).toBeVisible();
  await expect(page.locator('[data-testid="auth-panel"]')).toHaveCount(0);
  await page.goto("/account/profile");
  await expect(page.locator('[data-testid="auth-panel"]')).toBeVisible();
  await expect(page.locator('[data-testid="profile-panel"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="rewrite-panel"]')).toHaveCount(0);
});
