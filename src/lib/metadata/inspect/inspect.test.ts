import fs from "node:fs";
import path from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import { beforeAll, describe, expect, it } from "vitest";
import type { ImageInspectionResult } from "../../../types/inspection";
import { inspectImage } from "./inspect";
import { evaluateIndicator } from "./ai-indicators";

/**
 * Fixture-backed inspector tests with REAL metadata reads (ExifReader on
 * real fixture bytes). No reader mocks anywhere in this file.
 *
 * Node has no FileReader, so the ranged-read File path (`length: 'auto'`)
 * cannot run here — ArrayBuffer inputs exercise identical normalize logic.
 * The File path is covered by manual browser steps (see docs/04).
 */

const FIXTURES = path.join(__dirname, "..", "..", "..", "test-fixtures");
const domParser = new DOMParser();
const results = new Map<string, ImageInspectionResult>();

function bufferOf(name: string): ArrayBuffer {
  const full = fs.readFileSync(path.join(FIXTURES, name));
  return full.buffer.slice(full.byteOffset, full.byteOffset + full.byteLength);
}

async function inspect(name: string): Promise<ImageInspectionResult> {
  const hit = results.get(name);
  if (hit) return hit;
  const result = await inspectImage(name, bufferOf(name), name, { domParser });
  results.set(name, result);
  return result;
}

function categoryOf(result: ImageInspectionResult, category: string) {
  const found = result.categories.find((c) => c.category === category);
  if (!found) throw new Error(`missing category ${category} in ${result.fileName}`);
  return found;
}

function tagValue(result: ImageInspectionResult, category: string, key: string): string | undefined {
  return categoryOf(result, category).tags.find((t) => t.key === key)?.displayedValue;
}

beforeAll(async () => {
  for (const name of [
    "jpeg-exif.jpg", "jpeg-gps-sw.jpg", "jpeg-xmp-iptc.jpg", "jpeg-ai.jpg",
    "jpeg-caption-ai.jpg", "jpeg-openai.jpg", "jpeg-caption-openai.jpg",
    "jpeg-empty.jpg", "png-text-exif.png",
    "webp-exif-xmp.webp", "webp-empty.webp", "avif-exif-xmp.avif",
    "heic-exif-gps.heic", "heic-real-encoder.heic", "spoof-jpg-with-png-bytes.jpg",
    "jpeg-truncated.jpg", "avif-truncated-box.avif",
    "signed-c2pa.jpg", "signed-c2pa.png", "jpeg-c2pa-tampered.jpg",
  ]) {
    await inspect(name);
  }
}, 120000);

describe("JPEG inspection (real EXIF)", () => {
  it("reads exact camera/date/orientation tags", async () => {
    const result = await inspect("jpeg-exif.jpg");
    expect(result.outcome).toBe("completed");
    expect(result.detectedFormat).toBe("jpeg");
    expect(tagValue(result, "EXIF", "Make")).toBe("TestCam");
    expect(tagValue(result, "EXIF", "Model")).toBe("TestCam Model X");
    expect(tagValue(result, "EXIF", "DateTimeOriginal")).toBe("2026:10:01 12:34:56");
    expect(categoryOf(result, "EXIF").status).toBe("detected");
  });
  it("converts GPS N/E with altitude above sea level", async () => {
    const result = await inspect("jpeg-exif.jpg");
    const gps = categoryOf(result, "GPS");
    expect(gps.status).toBe("detected");
    const lat = Number(tagValue(result, "GPS", "Latitude"));
    const lon = Number(tagValue(result, "GPS", "Longitude"));
    expect(lat).toBeCloseTo(12.345678, 4);
    expect(lon).toBeCloseTo(98.765432, 4);
    expect(tagValue(result, "GPS", "LatitudeRef")).toBe("N");
    expect(tagValue(result, "GPS", "Altitude")).toMatch(/150/);
  });
  it("handles S/W hemispheres, rotated orientation and below-sea-level altitude", async () => {
    const result = await inspect("jpeg-gps-sw.jpg");
    expect(Number(tagValue(result, "GPS", "Latitude"))).toBeLessThan(0);
    expect(Number(tagValue(result, "GPS", "Longitude"))).toBeLessThan(0);
    expect(tagValue(result, "GPS", "LatitudeRef")).toBe("S");
    expect(tagValue(result, "GPS", "LongitudeRef")).toBe("W");
    expect(parseFloat(tagValue(result, "GPS", "Altitude") ?? "")).toBeLessThan(0);
    expect(tagValue(result, "EXIF", "Orientation")).toMatch(/90|right/i);
  });
  it("reports XMP and IPTC groups with exact values", async () => {
    const result = await inspect("jpeg-xmp-iptc.jpg");
    expect(categoryOf(result, "XMP").status).toBe("detected");
    expect(categoryOf(result, "IPTC").status).toBe("detected");
    expect(tagValue(result, "IPTC", "Object Name")).toBe("Harbor Noon");
    expect(tagValue(result, "IPTC", "Keywords")).toMatch(/harbor/);
    expect(tagValue(result, "IPTC", "By-line")).toBe("Phase Two Test Creator");
  });
  it("reports genuine absence on a metadata-empty JPEG", async () => {
    const result = await inspect("jpeg-empty.jpg");
    expect(result.outcome).toBe("completed");
    expect(categoryOf(result, "EXIF").status).toBe("not_detected");
    expect(categoryOf(result, "GPS").status).toBe("not_detected");
    expect(categoryOf(result, "XMP").status).toBe("not_detected");
    expect(result.aiIndicators).toHaveLength(0);
  });
});

describe("AI indicators (clues, never verdicts)", () => {
  it("recognizes OpenAI only when it appears in a designated software field", () => {
    const software = evaluateIndicator({ group: "XMP", key: "CreatorTool", value: "OpenAI GPT-Image" });
    expect(software).toHaveLength(1);
    expect(software[0]?.confidence).toBe("explicit");
    expect(evaluateIndicator({ group: "XMP", key: "Description", value: "Made with OpenAI" })).toHaveLength(0);
  });
  it("cites explicit AI provenance fields with evidence", async () => {
    const result = await inspect("jpeg-ai.jpg");
    expect(result.aiIndicators.length).toBeGreaterThanOrEqual(2);
    expect(result.aiIndicators.every((i) => i.confidence === "explicit")).toBe(true);
    expect(result.aiIndicators.map((i) => i.evidenceKey).join(",")).toMatch(/DigitalSourceType|CreatorTool|AIPrompt/i);
    for (const indicator of result.aiIndicators) {
      expect(indicator.matchedValue.length).toBeGreaterThan(0);
      expect(indicator.explanation.length).toBeGreaterThan(0);
    }
  });
  it("ignores the word Ai inside an ordinary caption", async () => {
    const result = await inspect("jpeg-caption-ai.jpg");
    expect(result.aiIndicators).toHaveLength(0);
    expect(tagValue(result, "XMP", "description")).toMatch(/Portrait of Ai/);
  });
  it("flags an explicit OpenAI CreatorTool file fixture (synthetic tag)", async () => {
    // jpeg-openai.jpg is synthetically tagged — not evidence of real OpenAI generation.
    const result = await inspect("jpeg-openai.jpg");
    expect(result.detectedFormat).toBe("jpeg");
    expect(tagValue(result, "XMP", "CreatorTool")).toBe("OpenAI GPT-Image");
    expect(result.aiIndicators).toHaveLength(1);
    expect(result.aiIndicators[0]?.confidence).toBe("explicit");
    expect(`${result.aiIndicators[0]?.label} ${result.aiIndicators[0]?.matchedValue}`).toMatch(/openai/i);
  });
  it("ignores OpenAI mentioned only in an ordinary caption", async () => {
    const result = await inspect("jpeg-caption-openai.jpg");
    expect(result.aiIndicators).toHaveLength(0);
    expect(tagValue(result, "XMP", "description")).toMatch(/reading about OpenAI/);
  });
});

describe("C2PA fixtures under Node (validator unavailable — browser E2E proves detected)", () => {
  it("keeps signed-manifest bytes honest: EXIF readable, C2PA uninspected here", async () => {
    for (const name of ["signed-c2pa.jpg", "signed-c2pa.png", "jpeg-c2pa-tampered.jpg"]) {
      const result = await inspect(name);
      // The completed→partial downgrade for uninspected C2PA lives in the
      // browser-only withC2pa overlay (inspect.ts); under Node the EXIF/XMP
      // result stands on its own while C2PA stays honestly uninspected.
      expect(result.outcome).toBe("completed");
      // Node has no Worker/WASM runtime, so the overlay cannot run here;
      // e2e/c2pa-openai.spec.ts asserts the real detected path in Chromium.
      expect(categoryOf(result, "C2PA / Content Credentials").status).toBe("not_inspected");
    }
    const jpeg = await inspect("signed-c2pa.jpg");
    expect(tagValue(jpeg, "EXIF", "Make")).toBe("TestCam");
  });
});

describe("PNG inspection", () => {
  it("reads real tEXt/iTXt/zTXt text and eXIf EXIF", async () => {
    const result = await inspect("png-text-exif.png");
    expect(result.detectedFormat).toBe("png");
    expect(tagValue(result, "PNG text chunks", "Title")).toBe("Synthetic PNG Title");
    expect(tagValue(result, "PNG text chunks", "Author")).toBe("Phase Two Test Creator");
    expect(tagValue(result, "PNG text chunks", "CompressedNote")).toBe("zTXt-compressed-note");
    expect(tagValue(result, "EXIF", "Orientation")).toMatch(/top-left|normal|1/);
    expect(categoryOf(result, "XMP").status).toBe("detected");
    expect(categoryOf(result, "PNG header (technical)").status).toBe("detected");
  });
});

describe("WebP inspection", () => {
  it("reads EXIF/XMP/GPS and container flags when present", async () => {
    const result = await inspect("webp-exif-xmp.webp");
    expect(result.detectedFormat).toBe("webp");
    expect(tagValue(result, "EXIF", "Make")).toBe("TestCam");
    expect(categoryOf(result, "XMP").status).toBe("detected");
    expect(Number(tagValue(result, "GPS", "Latitude"))).toBeCloseTo(12.345678, 4);
    expect(categoryOf(result, "WebP container (technical)").status).toBe("detected");
  });
  it("distinguishes absent metadata honestly", async () => {
    const result = await inspect("webp-empty.webp");
    expect(result.outcome).toBe("completed");
    expect(categoryOf(result, "EXIF").status).toBe("not_detected");
    expect(categoryOf(result, "XMP").status).toBe("not_detected");
  });
});

describe("AVIF inspection (required core format)", () => {
  it("verifies the true brand and reads embedded EXIF/XMP/GPS", async () => {
    const result = await inspect("avif-exif-xmp.avif");
    expect(result.outcome).toBe("completed");
    expect(result.detectedFormat).toBe("avif");
    expect(result.detectedBrand).toBe("avif");
    expect(tagValue(result, "EXIF", "Make")).toBe("TestCam");
    expect(Number(tagValue(result, "GPS", "Latitude"))).toBeCloseTo(12.345678, 4);
    expect(Number(tagValue(result, "GPS", "Longitude"))).toBeCloseTo(98.765432, 4);
    expect(categoryOf(result, "XMP").status).toBe("detected");
  });
});

describe("HEIC inspection (required core format, preview-independent)", () => {
  it("reads EXIF/GPS/XMP and treats 0,0 coordinates as real data", async () => {
    const result = await inspect("heic-exif-gps.heic");
    expect(result.outcome).toBe("completed");
    expect(result.detectedFormat).toBe("heic");
    expect(result.detectedBrand).toBe("heic");
    expect(tagValue(result, "EXIF", "Make")).toBe("TestPhone");
    const gps = categoryOf(result, "GPS");
    expect(gps.status).toBe("detected");
    expect(Number(tagValue(result, "GPS", "Latitude"))).toBe(0);
    expect(Number(tagValue(result, "GPS", "Longitude"))).toBe(0);
    expect(categoryOf(result, "XMP").status).toBe("detected");
  });
  it("reads a real libheif-encoded still with ExifTool-written metadata", async () => {
    const result = await inspect("heic-real-encoder.heic");
    expect(result.outcome).toBe("completed");
    expect(result.detectedFormat).toBe("heic");
    expect(tagValue(result, "EXIF", "Make")).toBe("RealCam");
    expect(tagValue(result, "EXIF", "Model")).toBe("RealCam HEVC 1");
    expect(Number(tagValue(result, "GPS", "Latitude"))).toBeCloseTo(33.8688, 4);
    expect(Number(tagValue(result, "GPS", "Longitude"))).toBeCloseTo(151.2093, 4);
    // Writer omitted GPS refs: N/E assumed openly, never silently.
    expect(categoryOf(result, "GPS").warnings.join(" ")).toMatch(/reference tags absent/i);
    expect(categoryOf(result, "XMP").status).toBe("detected");
  });
});

describe("mismatch, corruption and budgets", () => {
  it("prefers bytes over the spoofed extension with a warning", async () => {
    const result = await inspect("spoof-jpg-with-png-bytes.jpg");
    expect(result.detectedFormat).toBe("png");
    expect(result.declaredFormat).toBe("jpg");
    expect(result.warnings.join(" ")).toMatch(/bytes take precedence/i);
    expect(result.outcome).toBe("completed");
  });
  it("survives truncation and malformed boxes without throwing", async () => {
    const jpeg = await inspect("jpeg-truncated.jpg");
    expect(["completed", "partial"]).toContain(jpeg.outcome);
    expect(jpeg.warnings.length).toBeGreaterThan(0);
    const avif = await inspect("avif-truncated-box.avif");
    expect(["completed", "partial", "failed"]).toContain(avif.outcome);
    expect(avif.warnings.join(" ")).toMatch(/largesize|structure|failed/i);
  });
  it("fails safely on random bytes and enforces the byte budget", async () => {
    const full = fs.readFileSync(path.join(FIXTURES, "random-bytes.bin"));
    const random = await inspectImage(
      "random", full.buffer.slice(full.byteOffset, full.byteOffset + full.byteLength),
      "random-bytes.bin", { domParser },
    );
    expect(random.outcome).toBe("failed");
    const tiny = await inspectImage("tiny", bufferOf("jpeg-exif.jpg"), "jpeg-exif.jpg", { domParser, maxBytes: 10 });
    expect(tiny.outcome).toBe("failed");
    expect(tiny.warnings.join(" ")).toMatch(/budget/i);
  });
  it("marks truncated GPS values uncertain instead of inventing coordinates", async () => {
    const result = await inspect("jpeg-truncated.jpg");
    const gps = categoryOf(result, "GPS");
    expect(gps.status).toBe("uncertain");
    expect(gps.tags.map((t) => t.displayedValue).join(" ")).not.toMatch(/NaN/);
    expect(gps.warnings.join(" ")).toMatch(/unreadable|uncertain/i);
  });
  it("never reports C2PA as absent — only uninspected", async () => {
    for (const name of ["jpeg-exif.jpg", "avif-exif-xmp.avif", "heic-exif-gps.heic", "png-text-exif.png"]) {
      const result = await inspect(name);
      expect(categoryOf(result, "C2PA / Content Credentials").status).toBe("not_inspected");
    }
  });
});
