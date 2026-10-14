import { describe, expect, it } from "vitest";
import { buildReportSnapshot } from "./snapshot";
import { DEFAULT_REPORT_OPTIONS } from "../../types/reporting";
import { minimalCleaning, minimalEntry, minimalInspection } from "./testkit";

function snapshotFor(parts: {
  entries?: ReturnType<typeof minimalEntry>[];
  inspections?: Record<string, ReturnType<typeof minimalInspection>>;
  cleanings?: Record<string, ReturnType<typeof minimalCleaning>>;
  zip?: { fileId: string; archivePath: string }[];
  generatedAt?: string;
}) {
  const entries = parts.entries ?? [];
  const inspections: Record<string, ReturnType<typeof minimalInspection>> = {};
  const cleanings: Record<string, ReturnType<typeof minimalCleaning>> = {};
  for (const entry of entries) {
    const inspection = parts.inspections?.[entry.item.id];
    if (inspection) inspections[entry.item.id] = inspection;
    const cleaning = parts.cleanings?.[entry.item.id];
    if (cleaning) cleanings[entry.item.id] = cleaning;
  }
  return buildReportSnapshot({
    entries: entries.map((e) => e),
    inspections,
    cleanings,
    zipMapping: parts.zip ?? [],
    options: DEFAULT_REPORT_OPTIONS,
    scopeId: "test-scope",
    generatedAt: parts.generatedAt ?? "2026-10-13T00:00:00.000Z",
  });
}

describe("buildReportSnapshot", () => {
  it("covers every input exactly once in queue order, including unprocessed files", () => {
    const a = minimalEntry("a.jpg");
    const b = minimalEntry("b.png");
    const snapshot = snapshotFor({ entries: [a, b] });
    expect(snapshot.records).toHaveLength(2);
    expect(snapshot.records.map((r) => r.fileName)).toEqual(["a.jpg", "b.png"]);
    expect(snapshot.records.map((r) => r.index)).toEqual([1, 2]);
    expect(snapshot.records[0]?.overallStatus).toBe("not_processed");
    expect(snapshot.records[0]?.archiveIncluded).toBe(false);
    expect(snapshot.records[0]?.archiveExclusionReason).toMatch(/never inspected/i);
    expect(snapshot.totals.files).toBe(2);
    expect(snapshot.totals.notProcessed).toBe(2);
  });
  it("maps every real status without inventing outcomes", () => {
    const files = ["v.jpg", "u.jpg", "p.jpg", "f.jpg", "s.jpg", "n.jpg", "c.jpg"].map((n) => minimalEntry(n));
    const ids = files.map((f) => f.item.id);
    const snapshot = snapshotFor({
      entries: files,
      inspections: Object.fromEntries(ids.map((id) => [id, minimalInspection({ fileId: id })])),
      cleanings: {
        [ids[0] as string]: minimalCleaning({ fileId: ids[0] as string, status: "verified_clean" }),
        [ids[1] as string]: minimalCleaning({ fileId: ids[1] as string, status: "unchanged_no_target_tags" }),
        [ids[2] as string]: minimalCleaning({ fileId: ids[2] as string, status: "partially_cleaned" }),
        [ids[3] as string]: minimalCleaning({ fileId: ids[3] as string, status: "failed", errors: ["boom"], output: undefined, outputBytes: undefined, outputName: undefined }),
        [ids[4] as string]: minimalCleaning({ fileId: ids[4] as string, status: "unsupported", errors: ["nope"], output: undefined, outputBytes: undefined, outputName: undefined }),
        [ids[5] as string]: minimalCleaning({ fileId: ids[5] as string, status: "not_verified", output: undefined, outputBytes: undefined, outputName: undefined }),
        [ids[6] as string]: minimalCleaning({ fileId: ids[6] as string, status: "cancelled", output: undefined, outputBytes: undefined, outputName: undefined }),
      },
      zip: [{ fileId: ids[0] as string, archivePath: "images/v-clean.jpg" }],
    });
    const statuses = snapshot.records.map((r) => r.overallStatus);
    expect(statuses).toEqual(["verified_clean", "unchanged_no_target_tags", "partially_cleaned", "failed", "unsupported", "not_verified", "cancelled"]);
    expect(snapshot.totals).toMatchObject({ files: 7, verifiedClean: 1, unchanged: 1, partial: 1, failed: 2, unsupported: 1, cancelled: 1, notProcessed: 0 });
    expect(snapshot.records[0]?.archiveIncluded).toBe(true);
    expect(snapshot.records[2]?.archiveExclusionReason).toMatch(/opt-in/i);
    expect(snapshot.records[3]?.archiveExclusionReason).toMatch(/failed/i);
    // Rewrites are always zero/not-applicable in Phase 5.
    for (const record of snapshot.records) {
      expect(record.verifiedRewrittenCount).toBe(0);
    }
  });
  it("preserves genuine (0,0) GPS and calls out assumed refs", () => {
    const entry = minimalEntry("zero.heic");
    const inspection = minimalInspection({
      fileId: entry.item.id,
      categories: [{
        category: "GPS", status: "detected",
        tags: [
          { group: "GPS", key: "Latitude", displayedValue: "0" },
          { group: "GPS", key: "Longitude", displayedValue: "0" },
          { group: "GPS", key: "LatitudeRef", displayedValue: "N" },
          { group: "GPS", key: "LongitudeRef", displayedValue: "E" },
        ],
        warnings: ["GPS reference tags absent in file; N/E/above-sea-level assumed per writer convention (matches ExifTool display)."],
      }],
    });
    const snapshot = snapshotFor({
      entries: [entry],
      inspections: { [entry.item.id]: inspection },
      cleanings: { [entry.item.id]: minimalCleaning({ fileId: entry.item.id }) },
    });
    // Summary mode withholds coordinates but keeps detection + warning.
    expect(snapshot.records[0]?.gpsBefore).toBe("detected(location withheld)");
    const gps = snapshot.records[0]?.categoriesBefore.find((c) => c.category === "GPS");
    expect(gps?.warnings.join(" ")).toMatch(/assumed/i);
    const exposed = buildReportSnapshot({
      entries: [entry],
      inspections: { [entry.item.id]: inspection },
      cleanings: { [entry.item.id]: minimalCleaning({ fileId: entry.item.id }) },
      zipMapping: [],
      options: { ...DEFAULT_REPORT_OPTIONS, includeOriginalValues: true },
      scopeId: "gps-opt-in",
      generatedAt: "2026-10-13T00:00:00.000Z",
    });
    expect(exposed.records[0]?.gpsBefore).toBe("detected(0,0)");
  });
  it("keeps C2PA not_inspected and never invents timestamps", () => {
    const entry = minimalEntry("x.jpg");
    const snapshot = snapshotFor({
      entries: [entry],
      inspections: { [entry.item.id]: minimalInspection({ fileId: entry.item.id }) },
      cleanings: { [entry.item.id]: minimalCleaning({ fileId: entry.item.id }) },
    });
    expect(snapshot.records[0]?.c2paState).toBe("not_inspected");
    expect(snapshot.records[0]?.startedAt).toBe("");
    expect(snapshot.records[0]?.durationMs).toBe("");
  });
  it("sums bytes and archive membership honestly", () => {
    const a = minimalEntry("a.jpg", 1000);
    const b = minimalEntry("b.jpg", 2000);
    const snapshot = snapshotFor({
      entries: [a, b],
      inspections: {
        [a.item.id]: minimalInspection({ fileId: a.item.id }),
        [b.item.id]: minimalInspection({ fileId: b.item.id }),
      },
      cleanings: {
        [a.item.id]: minimalCleaning({ fileId: a.item.id, outputBytes: 800, outputName: "a-clean.jpg" }),
        [b.item.id]: minimalCleaning({ fileId: b.item.id, status: "failed", errors: ["x"], output: undefined, outputBytes: undefined, outputName: undefined }),
      },
      zip: [{ fileId: a.item.id, archivePath: "images/a-clean.jpg" }],
    });
    expect(snapshot.totals.bytesIn).toBe(3000);
    expect(snapshot.totals.bytesOut).toBe(800);
    expect(snapshot.totals.archiveIncluded).toBe(1);
    expect(snapshot.totals.archiveExcluded).toBe(1);
  });
});
