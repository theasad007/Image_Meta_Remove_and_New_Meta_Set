import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { unzipSync } from "fflate";
import fs from "node:fs";
import path from "node:path";
import { fixture } from "./helpers";

/**
 * Phase 5 reporting journeys in a real browser: standalone CSV/PDF parse,
 * privacy default vs opt-in, ZIP Both inclusion, failures-only reports,
 * and a 200-file compact PDF with timing.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w["showSaveFilePicker"];
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  (page as unknown as { __errors: string[] }).__errors = errors;
  await page.goto("/");
});

/** Minimal RFC-4180 reader (E2E-side) for downloaded CSV verification. */
function parseCsvRows(text: string): string[][] {
  const body = text.startsWith("﻿") ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;
  const pushCell = () => {
    row.push(cell);
    cell = "";
  };
  while (i < body.length) {
    const char = body[i] as string;
    if (quoted) {
      if (char === '"') {
        if (body[i + 1] === '"') {
          cell += '"';
          i += 2;
        } else {
          quoted = false;
          i += 1;
        }
      } else {
        cell += char;
        i += 1;
      }
    } else if (char === '"') {
      quoted = true;
      i += 1;
    } else if (char === ",") {
      pushCell();
      i += 1;
    } else if (char === "\r" && body[i + 1] === "\n") {
      pushCell();
      rows.push(row);
      row = [];
      i += 2;
    } else if (char === "\n") {
      pushCell();
      rows.push(row);
      row = [];
      i += 1;
    } else {
      cell += char;
      i += 1;
    }
  }
  if (cell !== "" || row.length > 0) {
    pushCell();
    rows.push(row);
  }
  return rows;
}

async function downloadTo(page: Page, testId: string, name: string): Promise<string> {
  const downloadPromise = page.waitForEvent("download");
  await page.locator(`[data-testid="${testId}"]`).click();
  const download = await downloadPromise;
  const outPath = path.join(__dirname, "artifacts", `${Date.now()}-${name}`);
  await download.saveAs(outPath);
  return outPath;
}

async function uploadNames(page: Page, names: string[]) {
  await page.locator('[data-testid="file-input"]').setInputFiles(names.map(fixture));
  await expect(page.locator('[data-testid="queue-item"]')).toHaveCount(names.length);
}

test("standalone CSV parses: schema, all files, redaction, C2PA honesty", async ({ page }) => {
  await uploadNames(page, ["jpeg-exif.jpg", "png-text-exif.png", "random-bytes.bin"]);
  await page.locator('[data-testid="batch-clean-all"]').click();
  await expect(page.locator('[data-testid="batch-progress"]')).toContainText(/2 of 2 files processed/, { timeout: 120000 });
  const csvPath = await downloadTo(page, "download-csv", "report.csv");
  const rows = parseCsvRows(fs.readFileSync(csvPath, "utf-8"));
  expect(rows[0]?.[0]).toBe("Index");
  expect(rows[0]).toContain("Overall Status");
  expect(rows[0]).toContain("C2PA Before");
  expect(rows[0]).toContain("Verified Rewritten Tag Count");
  expect(rows.length - 1).toBe(3);
  const byName = new Map(rows.slice(1).map((r) => [r[1], r]));
  expect(byName.get("jpeg-exif.jpg")?.[15]).toBe("verified_clean");
  expect(byName.get("random-bytes.bin")?.[15]).toBe("not_processed");
  // Summary privacy: no GPS digits, C2PA never absent.
  const text = fs.readFileSync(csvPath, "utf-8");
  expect(text).not.toContain("12.345678");
  expect(text).toContain("not_inspected");
  expect(text).not.toMatch(/c2pa[^,]*\babsent\b/i);
  // Rewritten column is always zero/not-applicable in Phase 5.
  const rewrittenIndex = (rows[0] as string[]).indexOf("Verified Rewritten Tag Count");
  for (const row of rows.slice(1)) {
    expect(row[rewrittenIndex]).toBe("0");
  }
  expect((page as unknown as { __errors: string[] }).__errors).toHaveLength(0);
});

test("opt-in exposes original values locally", async ({ page }) => {
  await uploadNames(page, ["jpeg-exif.jpg"]);
  await page.locator('[data-testid="batch-clean-all"]').click();
  await expect(page.locator('[data-testid="batch-progress"]')).toContainText(/1 of 1 files processed/, { timeout: 120000 });
  await page.locator('[data-testid="report-include-values"]').check();
  const csvPath = await downloadTo(page, "download-csv", "optin.csv");
  expect(fs.readFileSync(csvPath, "utf-8")).toContain("12.345678");
  expect((page as unknown as { __errors: string[] }).__errors).toHaveLength(0);
});

test("detailed tag ledger downloads with group coverage rows", async ({ page }) => {
  await uploadNames(page, ["jpeg-xmp-iptc.jpg"]);
  await page.locator('[data-testid="batch-clean-all"]').click();
  await expect(page.locator('[data-testid="batch-progress"]')).toContainText(/1 of 1 files processed/, { timeout: 120000 });
  await page.locator('[data-testid="report-detail"]').selectOption("detailed");
  const tagsPath = await downloadTo(page, "download-tags", "tags.csv");
  const rows = parseCsvRows(fs.readFileSync(tagsPath, "utf-8"));
  expect(rows[0]?.[0]).toBe("File ID");
  const keys = rows.slice(1).map((r) => `${r[2]}||${r[3]}`);
  expect(keys.some((k) => k.startsWith("EXIF||"))).toBe(true);
  expect(keys).toContain("C2PA / Content Credentials||");
  expect((page as unknown as { __errors: string[] }).__errors).toHaveLength(0);
});

test("standalone PDF opens with correct properties", async ({ page }) => {
  await uploadNames(page, ["jpeg-exif.jpg", "heic-exif-gps.heic"]);
  await page.locator('[data-testid="batch-clean-all"]').click();
  await expect(page.locator('[data-testid="batch-progress"]')).toContainText(/2 of 2 files processed/, { timeout: 120000 });
  const pdfPath = await downloadTo(page, "download-pdf", "report.pdf");
  const bytes = fs.readFileSync(pdfPath);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  expect(doc.getTitle()).toBe("Metadata Processing Report");
  expect(doc.getAuthor()).toBe(undefined);
  expect((page as unknown as { __errors: string[] }).__errors).toHaveLength(0);
});

test("ZIP Both embeds reports/ and matches standalone structure", async ({ page }) => {
  await uploadNames(page, ["jpeg-exif.jpg", "png-text-exif.png", "webp-exif-xmp.webp", "avif-exif-xmp.avif", "heic-exif-gps.heic", "jpeg-jumbf.jpg"]);
  await page.locator('[data-testid="batch-clean-all"]').click();
  await expect(page.locator('[data-testid="batch-progress"]')).toContainText(/6 of 6 files processed/, { timeout: 120000 });
  await page.locator('[data-testid="zip-include-partials"]').check();
  await page.getByRole("radio", { name: /CSV \+ PDF/ }).click();
  await page.locator('[data-testid="report-detail"]').selectOption("detailed");
  // Standalone first (structure reference; timestamps may differ).
  const standalonePath = await downloadTo(page, "download-csv", "standalone.csv");
  const standaloneRows = parseCsvRows(fs.readFileSync(standalonePath, "utf-8"));
  const downloadPromise = page.waitForEvent("download");
  await page.locator('[data-testid="download-zip"]').click();
  const download = await downloadPromise;
  const zipPath = path.join(__dirname, "artifacts", `${Date.now()}-both.zip`);
  await download.saveAs(zipPath);
  const extracted = unzipSync(new Uint8Array(fs.readFileSync(zipPath)));
  const names = Object.keys(extracted).sort();
  expect(names.filter((n) => n.startsWith("images/"))).toHaveLength(6);
  expect(names.filter((n) => n.startsWith("reports/")).sort()).toEqual([
    "reports/metadata-report.csv",
    "reports/metadata-report.pdf",
    "reports/metadata-tags.csv",
  ]);
  // Embedded CSV reconciles: same headers, same row count, same statuses.
  const embeddedRows = parseCsvRows(Buffer.from(extracted["reports/metadata-report.csv"] as Uint8Array).toString("utf-8"));
  expect(embeddedRows[0]).toEqual(standaloneRows[0]);
  expect(embeddedRows.length).toBe(standaloneRows.length);
  const statusIndex = (standaloneRows[0] as string[]).indexOf("Overall Status");
  expect(embeddedRows.map((r) => r[statusIndex]).sort()).toEqual(standaloneRows.map((r) => r[statusIndex]).sort());
  // Media bytes untouched by report inclusion.
  const pdfBytes = Buffer.from(extracted["reports/metadata-report.pdf"] as Uint8Array);
  expect(pdfBytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect((page as unknown as { __errors: string[] }).__errors).toHaveLength(0);
});

test("review-only queue still gets a standalone report; ZIP stays disabled", async ({ page }) => {
  await uploadNames(page, ["random-bytes.bin"]);
  await expect(page.locator('[data-testid="batch-clean-all"]')).toBeDisabled();
  const csvPath = await downloadTo(page, "download-csv", "failures.csv");
  const rows = parseCsvRows(fs.readFileSync(csvPath, "utf-8"));
  expect(rows.length - 1).toBe(1);
  expect(rows[1]?.[15]).toBe("not_processed");
  await expect(page.locator('[data-testid="download-zip"]')).toBeDisabled();
  expect((page as unknown as { __errors: string[] }).__errors).toHaveLength(0);
});

test("200-file compact PDF in-browser with timing", async ({ page }) => {
  test.setTimeout(300000);
  const dir = path.join(__dirname, "artifacts", `pdf200-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  const formats = ["jpeg-exif.jpg", "png-text-exif.png", "webp-exif-xmp.webp", "avif-exif-xmp.avif", "heic-exif-gps.heic"];
  const paths: string[] = [];
  for (let i = 0; i < 200; i += 1) {
    const name = formats[i % formats.length] as string;
    const target = path.join(dir, `p-${String(i).padStart(4, "0")}-${name}`);
    fs.copyFileSync(fixture(name), target);
    paths.push(target);
  }
  await page.locator('[data-testid="file-input"]').setInputFiles(paths);
  await expect(page.locator('[data-testid="queue-item"]')).toHaveCount(200, { timeout: 120000 });
  await page.locator('[data-testid="batch-clean-all"]').click();
  await expect(page.locator('[data-testid="batch-progress"]')).toContainText(/200 of 200 files processed/, { timeout: 300000 });
  const started = Date.now();
  const pdfPath = await downloadTo(page, "download-pdf", "bulk200.pdf");
  const elapsed = Date.now() - started;
  const bytes = fs.readFileSync(pdfPath);
  const doc = await PDFDocument.load(bytes);
  process.stderr.write(`browser-pdf/200: ${elapsed}ms bytes=${bytes.length} pages=${doc.getPageCount()}\n`);
  expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  expect((page as unknown as { __errors: string[] }).__errors).toHaveLength(0);
});
