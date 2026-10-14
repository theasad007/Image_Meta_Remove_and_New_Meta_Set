import type { Page } from "@playwright/test";
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
  if (await view.isVisible()) await view.click();
  else await inspect.click();
  await page.locator('[data-testid="inspector-panel"]').waitFor();
}

export async function cleanRow(page: Page, name: string) {
  await row(page, name).getByRole("button", { name: "Remove metadata" }).click();
  await page.locator('[data-testid="before-after-panel"]').waitFor();
}
