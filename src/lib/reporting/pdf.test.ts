import { PDFDocument } from "pdf-lib";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildReportPdf } from "./pdf";
import { buildReportSnapshot } from "./snapshot";
import { DEFAULT_REPORT_OPTIONS } from "../../types/reporting";
import { minimalCleaning, minimalEntry, minimalInspection } from "./testkit";

/**
 * Extract decompressed stream text from raw PDF bytes (test-only): pdf-lib
 * writes Flate-encoded content streams, so plain byte search cannot see
 * text. node:zlib inflates them without any new dependency.
 */
function pdfTextHaystack(bytes: Uint8Array): string {
  const latin = new TextDecoder("latin1").decode(bytes);
  const parts: string[] = [latin];
  // Decompress Flate-encoded content streams (test-only, node:zlib),
  // slicing exact /Length-prefixed bodies so binary coincidences can't
  // truncate the capture.
  const raw = Buffer.from(bytes);
  const text = raw.toString("latin1");
  const headerRe = /\/Length\s+(\d+)[\s\S]*?stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = headerRe.exec(text)) !== null) {
    const length = Number(match[1]);
    if (!Number.isFinite(length) || length <= 0 || length > raw.length) continue;
    const bodyStart = match.index + match[0].length;
    const body = raw.subarray(bodyStart, bodyStart + length);
    try {
      parts.push(inflateSync(body).toString("latin1"));
    } catch {
      // Not a deflated stream — ignore.
    }
  }
  const joined = parts.join("\n");
  // pdf-lib writes text as hex strings <4D6574...>: decode runs of 4+
  // hex digits so assertions read real words, not glyph IDs.
  return joined.replace(/<([0-9A-Fa-f]{4,})>/g, (_whole, hex: string) => {
    let out = "";
    for (let i = 0; i + 1 < hex.length; i += 2) {
      out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    }
    return out;
  });
}

function snapshotFor(count: number, unicode = false) {
  const entries = Array.from({ length: count }, (_, i) =>
    minimalEntry(unicode && i === 0 ? "café 🎉 naïve résumé.png" : `photo-${String(i).padStart(4, "0")}.jpg`),
  );
  const inspections: Record<string, ReturnType<typeof minimalInspection>> = {};
  const cleanings: Record<string, ReturnType<typeof minimalCleaning>> = {};
  for (const entry of entries) {
    inspections[entry.item.id] = minimalInspection({
      fileId: entry.item.id,
      fileName: entry.item.name,
      categories: [
        {
          category: "EXIF", status: "detected",
          tags: [
            { group: "EXIF", key: "Make", displayedValue: unicode && entry.item.name.includes("café") ? "TëstCäm 🎉" : "TestCam" },
            { group: "EXIF", key: "Model", displayedValue: "TestCam Model X" },
          ],
          warnings: [],
        },
        {
          category: "GPS", status: "detected",
          tags: [
            { group: "GPS", key: "Latitude", displayedValue: "12.345678" },
            { group: "GPS", key: "Longitude", displayedValue: "98.765432" },
          ],
          warnings: [],
        },
        { category: "C2PA / Content Credentials", status: "not_inspected", tags: [], warnings: [] },
      ],
      aiIndicators: [{
        label: "Generator signature", evidenceGroup: "XMP", evidenceKey: "CreatorTool",
        matchedValue: "Stable Diffusion", confidence: "explicit", explanation: "test",
      }],
    });
    cleanings[entry.item.id] = minimalCleaning({
      fileId: entry.item.id,
      inputName: entry.item.name,
      outputName: `${entry.item.name}-clean`,
      changes: [
        { group: "EXIF", key: "APP1 Exif segment", action: "removed", verification: "verified" },
        { group: "GPS", key: "GPS coordinates", action: "removed", verification: "verified" },
      ],
    });
  }
  return buildReportSnapshot({
    entries,
    inspections,
    cleanings,
    zipMapping: entries.slice(0, Math.min(2, count)).map((e) => ({
      fileId: e.item.id,
      archivePath: `images/${e.item.name}-clean`,
    })),
    options: DEFAULT_REPORT_OPTIONS,
    scopeId: "pdf-test",
    generatedAt: "2026-10-13T00:00:00.000Z",
  });
}

describe("buildReportPdf", () => {
  it("produces a parseable PDF with cover, per-file coverage and disclaimers", async () => {
    const { default: pdfLib } = await import("pdf-lib");
    const snapshot = snapshotFor(3);
    const result = await buildReportPdf(pdfLib, snapshot);
    expect(result.fileCount).toBe(3);
    // Default detail=summary uses the disclosed compact table.
    expect(result.compactUsed).toBe(true);
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
    const reloaded = await PDFDocument.load(result.bytes);
    expect(reloaded.getPageCount()).toBe(result.pageCount);
    expect(reloaded.getTitle()).toBe("Metadata Processing Report");
    const haystack = pdfTextHaystack(result.bytes);
    expect(haystack).toContain("Metadata Processing Report");
    expect(haystack).toContain("photo-0000");
    expect(haystack).toContain("photo-0002");
    expect(haystack).toContain("not inspected");
    expect(haystack).toContain("compact");
    expect(haystack).toContain("page 1 of");
    // Summary privacy: GPS digits must not appear.
    expect(haystack).not.toContain("12.345678");
    // PDF document properties carry no user metadata.
    expect(reloaded.getAuthor()).toBe(undefined);
    expect(reloaded.getSubject()).toBe(undefined);
  }, 120000);
  it("renders full per-file detail when requested for small batches", async () => {
    const { default: pdfLib } = await import("pdf-lib");
    const entries = [minimalEntry("a.jpg"), minimalEntry("b.jpg")];
    const inspections: Record<string, ReturnType<typeof minimalInspection>> = {};
    const cleanings: Record<string, ReturnType<typeof minimalCleaning>> = {};
    for (const entry of entries) {
      inspections[entry.item.id] = minimalInspection({ fileId: entry.item.id, fileName: entry.item.name });
      cleanings[entry.item.id] = minimalCleaning({ fileId: entry.item.id, inputName: entry.item.name });
    }
    const snapshot = buildReportSnapshot({
      entries, inspections, cleanings, zipMapping: [],
      options: { ...DEFAULT_REPORT_OPTIONS, detail: "detailed" },
      scopeId: "detailed", generatedAt: "2026-10-13T00:00:00.000Z",
    });
    const result = await buildReportPdf(pdfLib, snapshot);
    expect(result.compactUsed).toBe(false);
    const haystack = pdfTextHaystack(result.bytes);
    expect(haystack).toContain("Before");
    expect(haystack).toContain("After");
  }, 120000);
  it("sanitizes Unicode visibly and discloses the count", async () => {
    const { default: pdfLib } = await import("pdf-lib");
    const snapshot = snapshotFor(2, true);
    const result = await buildReportPdf(pdfLib, snapshot);
    expect(result.unrepresentableGlyphs).toBeGreaterThan(0);
    const haystack = pdfTextHaystack(result.bytes);
    expect(haystack).toContain("standard-font");
  }, 120000);
  it("uses disclosed compact mode for 1000 files with every file present", async () => {
    const { default: pdfLib } = await import("pdf-lib");
    const started = Date.now();
    const snapshot = snapshotFor(1000);
    const result = await buildReportPdf(pdfLib, snapshot);
    const elapsed = Date.now() - started;
    process.stderr.write(`pdf/1000: ${elapsed}ms pages=${result.pageCount} bytes=${result.bytes.length}\n`);
    expect(result.compactUsed).toBe(true);
    expect(result.fileCount).toBe(1000);
    const reloaded = await PDFDocument.load(result.bytes);
    expect(reloaded.getPageCount()).toBe(result.pageCount);
    const haystack = pdfTextHaystack(result.bytes);
    expect(haystack).toContain("compact");
    expect(haystack).toContain("photo-0999");
    expect(haystack).toContain("photo-0000");
  }, 300000);
  it("renders failures-only snapshots without claiming success", async () => {
    const { default: pdfLib } = await import("pdf-lib");
    const entry = minimalEntry("broken.jpg");
    const snapshot = buildReportSnapshot({
      entries: [entry],
      inspections: {
        [entry.item.id]: minimalInspection({ fileId: entry.item.id, outcome: "failed", categories: [] }),
      },
      cleanings: {
        [entry.item.id]: minimalCleaning({ fileId: entry.item.id, status: "failed", errors: ["boom"], output: undefined, outputBytes: undefined, outputName: undefined }),
      },
      zipMapping: [],
      options: DEFAULT_REPORT_OPTIONS,
      scopeId: "failures",
      generatedAt: "2026-10-13T00:00:00.000Z",
    });
    const result = await buildReportPdf(pdfLib, snapshot);
    const haystack = pdfTextHaystack(result.bytes);
    expect(haystack).toContain("Failed: 1");
    expect(haystack).not.toContain("Verified in supported scope: 1");
  }, 120000);
  it("supports cancellation mid-build", async () => {
    const { default: pdfLib } = await import("pdf-lib");
    const snapshot = snapshotFor(500);
    let calls = 0;
    await expect(buildReportPdf(pdfLib, snapshot, {
      isCancelled: () => {
        calls += 1;
        return calls > 2;
      },
    })).rejects.toThrow(/cancelled/i);
  }, 120000);
});
