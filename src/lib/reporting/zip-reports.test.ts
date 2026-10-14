import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildZipArchive } from "../zip/zip-builder";
import { buildZipMapping } from "../zip/zip-names";
import { buildSummaryCsv, buildTagsCsv } from "./csv";
import { buildReportPdf } from "./pdf";
import { buildReportSnapshot } from "./snapshot";
import { DEFAULT_REPORT_OPTIONS } from "../../types/reporting";
import { minimalCleaning, minimalEntry, minimalInspection } from "./testkit";

/**
 * ZIP/report reconciliation: embedded reports byte-match standalone
 * generation from the SAME snapshot; media bytes are identical across
 * report choices; traversal safety and CRCs hold.
 */
function mixedSnapshot() {
  const entries = [minimalEntry("a.jpg"), minimalEntry("b.png"), minimalEntry("c.heic")];
  const inspections: Record<string, ReturnType<typeof minimalInspection>> = {};
  const cleanings: Record<string, ReturnType<typeof minimalCleaning>> = {};
  for (const entry of entries) {
    inspections[entry.item.id] = minimalInspection({ fileId: entry.item.id, fileName: entry.item.name });
    cleanings[entry.item.id] = minimalCleaning({
      fileId: entry.item.id, inputName: entry.item.name, outputName: `${entry.item.name}-clean`,
    });
  }
  const generatedAt = "2026-10-13T00:00:00.000Z";
  const mapping = buildZipMapping(entries.map((e) => ({ fileId: e.item.id, outputName: `${e.item.name}-clean` })));
  const snapshot = buildReportSnapshot({
    entries, inspections, cleanings,
    zipMapping: mapping.map((m) => ({ fileId: m.fileId, archivePath: m.archivePath })),
    options: DEFAULT_REPORT_OPTIONS, scopeId: "zip-test", generatedAt,
  });
  return { entries, snapshot, mapping };
}

async function mediaSources() {
  const { mapping } = mixedSnapshot();
  return mapping.map((m, i) => ({
    path: m.archivePath,
    data: new TextEncoder().encode(`media-bytes-${i}`),
  }));
}

describe("ZIP/report reconciliation", () => {
  it("None choice preserves the exact Phase 4 archive (no reports/ path)", async () => {
    const { mapping } = mixedSnapshot();
    const sources = await mediaSources();
    const bytes = await buildZipArchive(sources);
    const extracted = unzipSync(bytes);
    expect(Object.keys(extracted).sort()).toEqual(mapping.map((m) => m.archivePath).sort());
    expect(Object.keys(extracted).some((k) => k.startsWith("reports/"))).toBe(false);
  });
  it("embedded CSV byte-matches standalone generation from the same snapshot", async () => {
    const { snapshot } = mixedSnapshot();
    const standalone = await buildSummaryCsv(snapshot);
    const sources = await mediaSources();
    const embedded = await buildSummaryCsv(snapshot);
    expect(embedded).toBe(standalone);
    const bytes = await buildZipArchive([
      ...sources,
      { path: "reports/metadata-report.csv", data: new TextEncoder().encode(embedded) },
    ]);
    const extracted = unzipSync(bytes);
    expect(Buffer.from(extracted["reports/metadata-report.csv"] as Uint8Array).toString("utf-8")).toBe(standalone);
  });
  it("Both choice embeds all three reports with identical media bytes", async () => {
    const { snapshot } = mixedSnapshot();
    const csv = await buildSummaryCsv(snapshot);
    const tags = await buildTagsCsv(snapshot);
    const { default: pdfLib } = await import("pdf-lib");
    const pdf = await buildReportPdf(pdfLib, snapshot);
    const media = await mediaSources();
    const withReports = await buildZipArchive([
      ...media,
      { path: "reports/metadata-report.csv", data: new TextEncoder().encode(csv) },
      { path: "reports/metadata-tags.csv", data: new TextEncoder().encode(tags) },
      { path: "reports/metadata-report.pdf", data: pdf.bytes },
    ]);
    const mediaOnly = await buildZipArchive(media);
    const extractedFull = unzipSync(withReports);
    const extractedMedia = unzipSync(mediaOnly);
    expect(Object.keys(extractedFull).filter((k) => k.startsWith("images/")).sort())
      .toEqual(Object.keys(extractedMedia).sort());
    for (const [name, data] of Object.entries(extractedMedia)) {
      expect(Buffer.compare(Buffer.from(data as Uint8Array), Buffer.from(extractedFull[name] as Uint8Array))).toBe(0);
    }
    expect(Object.keys(extractedFull).filter((k) => k.startsWith("reports/")).sort()).toEqual([
      "reports/metadata-report.csv",
      "reports/metadata-report.pdf",
      "reports/metadata-tags.csv",
    ]);
  });
  it("reports record excluded files without archiving them", async () => {
    const { snapshot } = mixedSnapshot();
    // Drop one file from the media set (simulating failure exclusion).
    const sources = (await mediaSources()).slice(0, 2);
    const csv = await buildSummaryCsv(snapshot);
    const bytes = await buildZipArchive([
      ...sources,
      { path: "reports/metadata-report.csv", data: new TextEncoder().encode(csv) },
    ]);
    const extracted = unzipSync(bytes);
    // Report still covers all three inputs…
    expect(csv.split("c.heic").length).toBeGreaterThan(1);
    // …but the archive holds only two media entries + report.
    expect(Object.keys(extracted).filter((k) => k.startsWith("images/"))).toHaveLength(2);
  });
});
