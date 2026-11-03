import { describe, expect, it } from "vitest";
import type { ImageInspectionResult, InspectionCategoryResult } from "../../types/inspection";
import { categoriesForTabs, detailCountsOf } from "./details-tabs";

function category(name: string, status: InspectionCategoryResult["status"], tags: number): InspectionCategoryResult {
  return {
    category: name,
    status,
    tags: Array.from({ length: tags }, (_, index) => ({
      group: name,
      key: `key-${index}`,
      displayedValue: `value-${index}`,
    })),
    warnings: [],
  };
}

function result(overrides?: Partial<ImageInspectionResult>): ImageInspectionResult {
  return {
    fileId: "f1",
    fileName: "f1.jpg",
    bytes: 10,
    outcome: "completed",
    categories: [],
    aiIndicators: [],
    warnings: [],
    inspectedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("categoriesForTabs", () => {
  it("buckets families by the row-chip prefix rule and keeps other groups technical", () => {
    const inspection = result({
      categories: [
        category("EXIF", "detected", 3),
        category("GPS", "not_detected", 0),
        category("XMP", "detected", 8),
        category("IPTC", "detected", 5),
        category("C2PA / Content Credentials (JUMBF)", "detected", 9),
        category("JPEG details (technical)", "detected", 2),
        category("PNG text", "detected", 4),
      ],
    });
    const buckets = categoriesForTabs(inspection);
    expect(buckets.exif.map((item) => item.category)).toEqual(["EXIF"]);
    expect(buckets.gps.map((item) => item.status)).toEqual(["not_detected"]);
    expect(buckets.xmp).toHaveLength(1);
    expect(buckets.iptc).toHaveLength(1);
    expect(buckets.c2pa).toHaveLength(1);
    expect(buckets.technical.map((item) => item.category)).toEqual(["JPEG details (technical)", "PNG text"]);
  });

  it("keeps repeated family sections (e.g. multi-segment containers) inside their tab", () => {
    const inspection = result({
      categories: [category("EXIF", "detected", 1), category("EXIF (extended)", "detected", 2)],
    });
    const buckets = categoriesForTabs(inspection);
    expect(buckets.exif).toHaveLength(2);
    expect(buckets.technical).toHaveLength(0);
  });

  it("treats unknown media (no category names) as empty buckets, never AI evidence", () => {
    const buckets = categoriesForTabs(result());
    expect(Object.values(buckets).every((entries) => entries.length === 0)).toBe(true);
  });
});

describe("detailCountsOf", () => {
  it("counts only detected groups and derives standard/total sums", () => {
    const inspection = result({
      categories: [
        category("EXIF", "detected", 12),
        category("GPS", "detected", 1),
        category("XMP", "detected", 8),
        category("IPTC", "detected", 5),
        category("C2PA / Content Credentials (JUMBF)", "not_detected", 0),
        category("JPEG details (technical)", "detected", 45),
        category("APP markers", "failed", 0),
      ],
      aiIndicators: [
        { label: "a", evidenceGroup: "EXIF", evidenceKey: "Software", matchedValue: "x", confidence: "explicit", explanation: "" },
        { label: "b", evidenceGroup: "XMP", evidenceKey: "CreatorTool", matchedValue: "y", confidence: "possible", explanation: "" },
      ],
    });
    const counts = detailCountsOf(inspection);
    expect(counts.exif).toBe(12);
    expect(counts.gps).toBe(1);
    expect(counts.xmp).toBe(8);
    expect(counts.iptc).toBe(5);
    expect(counts.c2pa).toBe(0);
    expect(counts.technical).toBe(45);
    expect(counts.standard).toBe(26);
    expect(counts.total).toBe(71);
    expect(counts.ai).toBe(2);
    expect(counts.hasUnreadGroups).toBe(true);
  });

  it("reports zero unread groups when the inspection completed cleanly", () => {
    const counts = detailCountsOf(result({
      categories: [category("EXIF", "detected", 2), category("GPS", "not_detected", 0)],
    }));
    expect(counts.hasUnreadGroups).toBe(false);
  });
});
