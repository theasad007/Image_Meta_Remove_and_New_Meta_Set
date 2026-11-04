import { expect, test } from "@playwright/test";

test("documentation navigation, search, and tables fit mobile without page overflow", async ({ page }) => {
  await page.goto("/docs/");
  const navDisclosure = page.getByTestId("docs-mobile-navigation");
  await expect(navDisclosure).toBeVisible();
  await navDisclosure.locator("summary").click();
  const search = page.getByTestId("docs-search").last();
  await search.fill("GPS");
  await expect(navDisclosure.getByRole("link", { name: "GPS and location metadata" })).toBeVisible();
  await navDisclosure.getByRole("link", { name: "GPS and location metadata" }).click();
  await expect(page.getByRole("heading", { name: "GPS and location metadata", level: 1 })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
  await page.goto("/docs/supported-formats/");
  await expect(page.locator("article table").first()).toBeVisible();
});

test("Docs navigation and format tables fit the tablet breakpoint", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/docs/supported-formats/");
  await expect(page.getByTestId("docs-mobile-navigation")).toBeVisible();
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
  await page.locator('header summary[aria-label="Open navigation"]').click();
  await expect(page.locator("header details").getByRole("link", { name: "Docs", exact: true })).toBeVisible();
});
