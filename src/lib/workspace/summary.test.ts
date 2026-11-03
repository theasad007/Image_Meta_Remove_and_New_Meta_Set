import { describe, expect, it } from "vitest";
import type { ImageInspectionResult } from "../../types/inspection";
import {
  aggregateQueue,
  chipsFor,
  dimensionsOf,
  fileCountsOf,
} from "./summary";

function entry(id: string, size: number) {
  return {
    item: {
      id,
      name: `${id}.jpg`,
      sanitizedName: `${id}.jpg`,
      sizeBytes: size,
      detected: {
        mediaKind: "image",
        extension: "jpg",
        mimeHint: "image/jpeg",
        label: "JPEG",
        supportedForQueue: true,
        detectionMethod: "binary-sniff",
        binaryVerified: true,
        isEmpty: false,
        note: "",
      },
      status: "ready",
      addedAt: 0,
    } as never,
    source: { size } as File,
  } as never;
}

function resultOf(
  id: string,
  overrides: Partial<ImageInspectionResult> = {},
): ImageInspectionResult {
  return {
    fileId: id,
    fileName: `${id}.jpg`,
    bytes: 100,
    outcome: "completed",
    categories: [],
    aiIndicators: [],
    warnings: [],
    inspectedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("fileCountsOf", () => {
  it("counts tags per detected category and AI indicators, never other statuses", () => {
    const result = resultOf("a", {
      aiIndicators: [
        { label: "OpenAI", evidenceGroup: "XMP", evidenceKey: "CreatorTool", matchedValue: "DALL·E", confidence: "explicit", explanation: "" },
      ],
      categories: [
        { category: "EXIF", status: "detected", tags: [
          { group: "EXIF", key: "Software", displayedValue: "TestCam" },
          { group: "EXIF", key: "Model", displayedValue: "Model X" },
        ], warnings: [] },
        { category: "GPS", status: "detected", tags: [
          { group: "GPS", key: "Latitude", displayedValue: "1" },
        ], warnings: [] },
        { category: "XMP", status: "not_detected", tags: [], warnings: [] },
        { category: "C2PA / Content Credentials", status: "detected", tags: [
          { group: "C2PA / Content Credentials", key: "Manifest Store", displayedValue: "Present" },
        ], warnings: [] },
      ],
    });
    const counts = fileCountsOf(result);
    expect(counts).toEqual({ ai: 1, c2pa: 1, exif: 2, gps: 1, xmp: 0, iptc: 0 });
  });
});

describe("aggregateQueue", () => {
  it("sums only files with real inspection results and tracks pending context", () => {
    const inspected = resultOf("a", {
      aiIndicators: [
        { label: "AI", evidenceGroup: "EXIF", evidenceKey: "Software", matchedValue: "x", confidence: "explicit", explanation: "" },
        { label: "AI", evidenceGroup: "XMP", evidenceKey: "CreatorTool", matchedValue: "y", confidence: "possible", explanation: "" },
      ],
      categories: [
        { category: "EXIF", status: "detected", tags: [
          { group: "EXIF", key: "a", displayedValue: "1" },
          { group: "EXIF", key: "b", displayedValue: "2" },
        ], warnings: [] },
        { category: "GPS", status: "detected", tags: [
          { group: "GPS", key: "Latitude", displayedValue: "1" },
          { group: "GPS", key: "Longitude", displayedValue: "2" },
        ], warnings: [] },
        { category: "XMP", status: "detected", tags: [{ group: "XMP", key: "c", displayedValue: "3" }], warnings: [] },
        { category: "C2PA / Content Credentials", status: "detected", tags: [], warnings: [] },
      ],
    });
    const blocked = resultOf("b", {
      outcome: "unsupported",
      categories: [{ category: "Video metadata", status: "not_inspected", tags: [], warnings: [] }],
    });
    const totals = aggregateQueue(
      [entry("a", 1000), entry("b", 500), entry("c", 300)],
      { a: inspected, b: blocked },
    );
    expect(totals.files).toBe(3);
    expect(totals.bytes).toBe(1800);
    expect(totals.inspectedFiles).toBe(2);
    expect(totals.pendingFiles).toBe(1);
    expect(totals.inspectionBlockedFiles).toBe(1);
    expect(totals.aiIndicators).toBe(2);
    expect(totals.exifTags).toBe(2);
    expect(totals.gpsLocations).toBe(1);
    expect(totals.gpsTags).toBe(2);
    expect(totals.xmpTags).toBe(1);
    expect(totals.iptcTags).toBe(0);
    expect(totals.c2paManifests).toBe(1);
  });

  it("counts one manifest per file even when several C2PA tags exist", () => {
    const twoManifestTags = resultOf("a", {
      categories: [
        { category: "C2PA / Content Credentials", status: "detected", tags: [
          { group: "C2PA / Content Credentials", key: "Manifest Store", displayedValue: "Present" },
          { group: "C2PA / Content Credentials", key: "Signer", displayedValue: "x" },
        ], warnings: [] },
      ],
    });
    const totals = aggregateQueue([entry("a", 10)], { a: twoManifestTags });
    expect(totals.c2paManifests).toBe(1);
  });
});

describe("chipsFor", () => {
  it("orders chips per tool and shows only detected XMP/IPTC", () => {
    const withAi = resultOf("a", {
      aiIndicators: [
        { label: "OpenAI", evidenceGroup: "XMP", evidenceKey: "CreatorTool", matchedValue: "DALL·E", confidence: "explicit", explanation: "" },
      ],
      categories: [
        { category: "EXIF", status: "detected", tags: [], warnings: [] },
        { category: "GPS", status: "not_detected", tags: [], warnings: [] },
        { category: "XMP", status: "detected", tags: [{ group: "XMP", key: "a", displayedValue: "1" }], warnings: [] },
        { category: "C2PA / Content Credentials", status: "not_inspected", tags: [], warnings: ["C2PA not run"] },
      ],
    });
    const chipsAi = chipsFor(withAi, "ai_metadata").map((chip) => `${chip.key}${chip.value === null ? "—" : chip.value}`);
    expect(chipsAi).toEqual(["ai1", "c2pa—", "exif0", "gps0", "xmp1"]);
    const chipsGeo = chipsFor(withAi, "metadata_geotag").map((chip) => `${chip.key}${chip.value === null ? "—" : chip.value}`);
    expect(chipsGeo).toEqual(["exif0", "gps0", "ai1", "c2pa—", "xmp1"]);
  });

  it("treats inspected zero as 0 and errors as unresolved, never as zero", () => {
    const zero = chipsFor(resultOf("a", {
      categories: [
        { category: "EXIF", status: "not_detected", tags: [], warnings: [] },
        { category: "C2PA / Content Credentials", status: "failed", tags: [], warnings: [] },
      ],
    }), "ai_metadata");
    expect(zero.find((chip) => chip.key === "exif")?.value).toBe(0);
    const c2pa = zero.find((chip) => chip.key === "c2pa");
    expect(c2pa?.value).toBeNull();
    expect(c2pa?.title).toMatch(/failed/i);
  });
});

describe("dimensionsOf", () => {
  it("reads width/height from technical container groups only", () => {
    const withDims = resultOf("a", {
      categories: [
        { category: "JPEG details (technical)", status: "detected", tags: [
          { group: "JPEG details", key: "Image Width", displayedValue: "4032" },
          { group: "JPEG details", key: "Image Height", displayedValue: "3034" },
        ], warnings: [] },
      ],
    });
    expect(dimensionsOf(withDims)).toBe("4032 × 3034");
    const without = resultOf("b", { categories: [{ category: "EXIF", status: "detected", tags: [], warnings: [] }] });
    expect(dimensionsOf(without)).toBeNull();
  });
});
