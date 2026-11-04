import { expect, test } from "@playwright/test";

const DOC_SLUGS = [
  "quick-start", "supported-formats", "inspect-metadata", "ai-evidence",
  "clean-metadata", "bulk-cleaning", "rewrite-metadata", "gps-location",
  "downloads-reports", "account-profile", "projects-premium", "mp3-audio",
  "privacy-security", "troubleshooting", "faq", "changelog",
];

test("Docs navigation, search, article routes, screenshots, and canonical metadata work", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Docs" }).click();
  await expect(page).toHaveURL(/\/docs\/$/);
  await expect(page.getByRole("heading", { name: "Private Metadata Cleaner docs", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "All guides" })).toBeVisible();

  const search = page.getByTestId("docs-search").first();
  await search.focus();
  const focusStyle = await search.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineWidth: style.outlineWidth, outlineOffset: style.outlineOffset, boxShadow: style.boxShadow };
  });
  expect(focusStyle).toEqual({ outlineWidth: "1px", outlineOffset: "1px", boxShadow: "none" });
  await search.fill("Nominatim");
  await expect(page.getByRole("navigation", { name: "Documentation pages" }).getByRole("link", { name: "GPS and location metadata" })).toBeVisible();
  await expect(page.getByTestId("docs-search-status").first()).toContainText("matching guides");
  await page.getByRole("navigation", { name: "Documentation pages" }).getByRole("link", { name: "GPS and location metadata" }).click();
  await expect(page.getByRole("heading", { name: "GPS and location metadata", level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Docs", exact: true })).toBeVisible();
  await expect(page.locator('a[href="#edit-gps"]')).toBeVisible();

  const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
  expect(canonical).toBe("https://metacleaner.techpeakssolutions.com/docs/gps-location/");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /coordinates|location/i);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /index/);
  const screenshot = page.getByAltText(/Location GPS editor/);
  await expect(screenshot).toBeVisible();
  await expect.poll(() => screenshot.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
});

test("all guide pages render and documentation links point to generated routes", async ({ page }) => {
  const validPaths = new Set(["/docs/", ...DOC_SLUGS.map((slug) => `/docs/${slug}/`)]);
  for (const slug of DOC_SLUGS) {
    await page.goto(`/docs/${slug}/`);
    await expect(page.locator("article h1")).toHaveCount(1);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://metacleaner.techpeakssolutions.com/docs/${slug}/`);
    const hrefs = await page.locator('a[href^="/docs/"]').evaluateAll((links) => links.map((link) => new URL((link as HTMLAnchorElement).href).pathname));
    for (const href of hrefs) expect(validPaths.has(href), `${slug} links to generated route ${href}`).toBe(true);
  }
});

test("account and admin pages are not indexable", async ({ page }) => {
  await page.goto("/account/profile/");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await page.goto("/admin/");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});
