import fs from "node:fs";
import path from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import { beforeAll, describe, expect, it } from "vitest";
import { sniffImageBytes, type SniffedKind } from "../../format-detection/signatures";
import { hasEmbeddedManifestStore } from "../inspect/c2pa";
import { inspectImage } from "../inspect/inspect";
import type { ImageInspectionResult, InspectionCategoryResult } from "../../../types/inspection";
import { cleanImageBytes } from "./index";
import { locateIsobmffC2pa, locateJpegC2pa, locatePngC2pa, locateWebpC2pa } from "./c2pa-locate";
import { parseJpegSegments, jpegScanFingerprint } from "./jpeg";
import { parsePngChunks, pngIdatFingerprint } from "./png";
import { parseWebpChunks, validateWebpStructure, webpPayloadFingerprint } from "./webp";
import {
  isobmffImagePayloads,
  validateIsobmffStructure,
  walkTopLevel,
} from "./isobmff";
import {
  PRIVACY_SAFE_DEFAULT,
  fingerprint,
  resolvesC2paRemovalTarget,
  type CleaningPolicy,
} from "./types";
import { verifyCleanedImage } from "../verify/verify";

/**
 * C2PA removal milestone tests on REAL signed bytes.
 *
 * Positive fixtures are natively signed by c2patool (test identity) —
 * never a bare UUID marker. Negatives prove the locator never deletes
 * unrelated bytes. Node tests prove structural removal + payload
 * integrity; the detected→not_detected transition through the real WASM
 * validator is proven by browser E2E (see e2e/c2pa-openai.spec.ts).
 */

const FIXTURES = path.join(__dirname, "..", "..", "..", "test-fixtures");
const domParser = new DOMParser();
const EXIF_ONLY: CleaningPolicy = { mode: "privacy_safe_default", targets: ["exif_gps"] };
const AI_NO_C2PA: CleaningPolicy = { mode: "privacy_safe_default", targets: ["ai_markers"], aiEvidenceGroups: ["XMP"] };
const AI_WITH_C2PA: CleaningPolicy = {
  mode: "privacy_safe_default",
  targets: ["ai_markers"],
  aiEvidenceGroups: ["C2PA / Content Credentials"],
};

function bytesOf(name: string): Uint8Array {
  const full = fs.readFileSync(path.join(FIXTURES, name));
  return new Uint8Array(full.buffer.slice(full.byteOffset, full.byteOffset + full.byteLength));
}

function extOf(name: string): string {
  return name.slice(name.lastIndexOf(".") + 1).toLowerCase();
}

function kindOf(name: string, bytes: Uint8Array): SniffedKind {
  const sniff = sniffImageBytes(bytes.slice(0, Math.min(65536, bytes.length)), bytes.length, extOf(name));
  if (sniff.kind === "empty" || sniff.kind === "unknown" || sniff.kind === "unreadable") {
    throw new Error(`fixture ${name} sniffed as ${sniff.kind}`);
  }
  return sniff.kind;
}

function c2paChangeNames(changes: Array<{ group: string; action: string }>): string[] {
  return changes.filter((c) => c.group === "C2PA").map((c) => c.action);
}

beforeAll(async () => {
  // Fail fast if a fixture is missing rather than asserting on air.
  for (const name of [
    "signed-c2pa.jpg", "jpeg-c2pa-multi.jpg", "jpeg-c2pa-foreign-app11.jpg",
    "jpeg-c2pa-truncated-store.jpg", "jpeg-com-c2pa-text.jpg", "jpeg-jumbf.jpg",
    "signed-c2pa.png", "png-c2pa-forged-cabx.png", "png-c2pa-stray-cabx.png",
    "webp-c2pa-signed.webp", "webp-c2pa-forged.webp",
    "avif-c2pa-signed.avif", "avif-uuid-unrelated.avif",
    "heic-c2pa-signed.heic", "heic-uuid.heic", "expired-cert.jpg",
  ]) {
    if (!fs.existsSync(path.join(FIXTURES, name))) throw new Error(`missing fixture ${name}`);
  }
});

describe("cleaning-scope behavior table (when C2PA removal is attempted)", () => {
  it("runs under the default and descriptive scopes, not under EXIF-only", () => {
    expect(resolvesC2paRemovalTarget(PRIVACY_SAFE_DEFAULT)).toBe(true);
    expect(resolvesC2paRemovalTarget({ mode: "privacy_safe_default", targets: ["descriptive"] })).toBe(true);
    expect(resolvesC2paRemovalTarget(EXIF_ONLY)).toBe(false);
  });
  it("runs under AI-only scope only with C2PA evidence for this file", () => {
    expect(resolvesC2paRemovalTarget(AI_WITH_C2PA)).toBe(true);
    expect(resolvesC2paRemovalTarget(AI_NO_C2PA)).toBe(false);
    expect(
      resolvesC2paRemovalTarget({ mode: "privacy_safe_default", targets: ["ai_markers"] }),
    ).toBe(false);
  });
});

describe("JPEG APP11 locator (official grouping semantics)", () => {
  function payloadsOf(name: string): Uint8Array[] {
    return parseJpegSegments(bytesOf(name)).app11.map((raw) => raw.slice(4));
  }
  it("identifies the single-segment store", () => {
    const groups = locateJpegC2pa(payloadsOf("signed-c2pa.jpg"));
    expect(groups).toHaveLength(1);
    expect(groups[0]?.indices).toEqual([0]);
  });
  it("groups all three segments of a multi-segment store by EN+Z order", () => {
    const groups = locateJpegC2pa(payloadsOf("jpeg-c2pa-multi.jpg"));
    expect(groups).toHaveLength(1);
    expect(groups[0]?.indices).toEqual([0, 1, 2]);
    expect(groups[0]?.enHex).toBe("0211");
  });
  it("excludes an interleaved foreign APP11 without breaking the group", () => {
    const groups = locateJpegC2pa(payloadsOf("jpeg-c2pa-foreign-app11.jpg"));
    expect(groups).toHaveLength(1);
    expect(groups[0]?.indices).toEqual([0, 2, 3]);
  });
  it("identifies the present parts of a truncated store", () => {
    const groups = locateJpegC2pa(payloadsOf("jpeg-c2pa-truncated-store.jpg"));
    expect(groups).toHaveLength(1);
    expect(groups[0]?.indices).toEqual([0, 1]);
  });
  it("never fires on dummy markers, COM text, or plain photos", () => {
    expect(locateJpegC2pa(payloadsOf("jpeg-jumbf.jpg"))).toHaveLength(0);
    expect(locateJpegC2pa(payloadsOf("jpeg-com-c2pa-text.jpg"))).toHaveLength(0);
    expect(locateJpegC2pa(payloadsOf("jpeg-exif.jpg"))).toHaveLength(0);
  });
});

describe("JPEG C2PA removal", () => {
  it("drops the manifest store and keeps scan bytes identical", () => {
    const input = bytesOf("signed-c2pa.jpg");
    const out = cleanImageBytes(input, "jpeg", PRIVACY_SAFE_DEFAULT);
    expect(locateJpegC2pa(parseJpegSegments(out.data).app11.map((raw) => raw.slice(4)))).toHaveLength(0);
    expect(out.coverageLimited).toBe(false);
    const removed = out.changes.filter((c) => c.group === "C2PA" && c.action === "removed");
    expect(removed).toHaveLength(1);
    expect(removed[0]?.key).toMatch(/1 segment/);
    expect(jpegScanFingerprint(out.data)).toBe(jpegScanFingerprint(input));
  });
  it("removes every part of a multi-segment store", () => {
    const input = bytesOf("jpeg-c2pa-multi.jpg");
    const out = cleanImageBytes(input, "jpeg", PRIVACY_SAFE_DEFAULT);
    expect(locateJpegC2pa(parseJpegSegments(out.data).app11.map((raw) => raw.slice(4)))).toHaveLength(0);
    expect(out.changes.some((c) => c.group === "C2PA" && c.action === "removed" && (c.key ?? "").includes("3 segment"))).toBe(true);
    expect(jpegScanFingerprint(out.data)).toBe(jpegScanFingerprint(input));
  });
  it("keeps an unrelated APP11 while dropping the C2PA group", () => {
    const out = cleanImageBytes(bytesOf("jpeg-c2pa-foreign-app11.jpg"), "jpeg", PRIVACY_SAFE_DEFAULT);
    const app11 = parseJpegSegments(out.data).app11;
    expect(app11).toHaveLength(1);
    expect(Buffer.from(app11[0] ?? []).includes(Buffer.from("UNRELATED-DATA"))).toBe(true);
    expect(locateJpegC2pa(app11.map((raw) => raw.slice(4)))).toHaveLength(0);
  });
  it("removes the present parts of a truncated store without crashing", () => {
    const input = bytesOf("jpeg-c2pa-truncated-store.jpg");
    const out = cleanImageBytes(input, "jpeg", PRIVACY_SAFE_DEFAULT);
    expect(locateJpegC2pa(parseJpegSegments(out.data).app11.map((raw) => raw.slice(4)))).toHaveLength(0);
    expect(jpegScanFingerprint(out.data)).toBe(jpegScanFingerprint(input));
  });
  it("emits no C2PA change for COM text that merely mentions c2pa", () => {
    const out = cleanImageBytes(bytesOf("jpeg-com-c2pa-text.jpg"), "jpeg", PRIVACY_SAFE_DEFAULT);
    expect(c2paChangeNames(out.changes)).toHaveLength(0);
  });
  it("retains an identified store outside the selected scope", () => {
    const out = cleanImageBytes(bytesOf("signed-c2pa.jpg"), "jpeg", EXIF_ONLY);
    expect(out.changes.some((c) => c.group === "C2PA" && c.action === "retained_unsupported")).toBe(true);
    expect(locateJpegC2pa(parseJpegSegments(out.data).app11.map((raw) => raw.slice(4)))).toHaveLength(1);
    expect(out.coverageLimited).toBe(true);
  });
  it("removes an expired-credential store: Invalid before is still a target", () => {
    const out = cleanImageBytes(bytesOf("expired-cert.jpg"), "jpeg", PRIVACY_SAFE_DEFAULT);
    expect(out.changes.some((c) => c.group === "C2PA" && c.action === "removed")).toBe(true);
    expect(locateJpegC2pa(parseJpegSegments(out.data).app11.map((raw) => raw.slice(4)))).toHaveLength(0);
  });
});

describe("PNG caBX locator and removal", () => {
  it("proves the real store, rejects forgeries and ignores IDAT text", () => {
    const signed = parsePngChunks(bytesOf("signed-c2pa.png")).chunks;
    const hit = locatePngC2pa(signed.map((c) => ({ type: c.type, data: c.data })));
    expect(hit.identified).toHaveLength(1);
    expect(hit.unproven).toHaveLength(0);
    const forged = parsePngChunks(bytesOf("png-c2pa-forged-cabx.png")).chunks;
    const fake = locatePngC2pa(forged.map((c) => ({ type: c.type, data: c.data })));
    expect(fake.identified).toHaveLength(0);
    expect(fake.unproven).toHaveLength(1);
    const stray = parsePngChunks(bytesOf("png-c2pa-stray-cabx.png")).chunks;
    expect(locatePngC2pa(stray.map((c) => ({ type: c.type, data: c.data }))).identified).toHaveLength(0);
  });
  it("drops the caBX store with IDAT bytes identical", () => {
    const input = bytesOf("signed-c2pa.png");
    const out = cleanImageBytes(input, "png", PRIVACY_SAFE_DEFAULT);
    const after = parsePngChunks(out.data).chunks;
    expect(after.some((c) => c.type === "caBX")).toBe(false);
    expect(pngIdatFingerprint(out.data)).toBe(pngIdatFingerprint(input));
    expect(out.changes.some((c) => c.group === "C2PA" && c.action === "removed")).toBe(true);
  });
  it("retains a forged caBX even when aggressive", () => {
    for (const policy of [PRIVACY_SAFE_DEFAULT, { mode: "aggressive_when_proven_safe" } as CleaningPolicy]) {
      const out = cleanImageBytes(bytesOf("png-c2pa-forged-cabx.png"), "png", policy);
      const after = parsePngChunks(out.data).chunks;
      expect(after.some((c) => c.type === "caBX")).toBe(true);
      expect(out.changes.some((c) => c.group === "C2PA" && c.action === "retained_unsupported")).toBe(true);
      expect(out.coverageLimited).toBe(true);
    }
  });
  it("leaves stray caBX bytes inside IDAT untouched", () => {
    const input = bytesOf("png-c2pa-stray-cabx.png");
    const out = cleanImageBytes(input, "png", PRIVACY_SAFE_DEFAULT);
    expect(pngIdatFingerprint(out.data)).toBe(pngIdatFingerprint(input));
    expect(c2paChangeNames(out.changes)).toHaveLength(0);
  });
});

describe("WebP C2PA locator and removal", () => {
  it("proves the real chunk and rejects forgeries", () => {
    const signed = parseWebpChunks(bytesOf("webp-c2pa-signed.webp")).chunks;
    const hit = locateWebpC2pa(signed);
    expect(hit.identified).toHaveLength(1);
    const forged = parseWebpChunks(bytesOf("webp-c2pa-forged.webp")).chunks;
    const fake = locateWebpC2pa(forged);
    expect(fake.identified).toHaveLength(0);
    expect(fake.unproven).toHaveLength(1);
  });
  it("drops the C2PA chunk with VP8 payload and RIFF size rebuilt", () => {
    const input = bytesOf("webp-c2pa-signed.webp");
    const out = cleanImageBytes(input, "webp", PRIVACY_SAFE_DEFAULT);
    const after = parseWebpChunks(out.data).chunks;
    expect(after.some((c) => c.id === "C2PA")).toBe(false);
    expect(webpPayloadFingerprint(out.data)).toBe(webpPayloadFingerprint(input));
    expect(validateWebpStructure(out.data).ok).toBe(true);
    expect(out.changes.some((c) => c.group === "C2PA" && c.action === "removed")).toBe(true);
  });
  it("retains a forged C2PA chunk even when aggressive", () => {
    for (const policy of [PRIVACY_SAFE_DEFAULT, { mode: "aggressive_when_proven_safe" } as CleaningPolicy]) {
      const out = cleanImageBytes(bytesOf("webp-c2pa-forged.webp"), "webp", policy);
      expect(parseWebpChunks(out.data).chunks.some((c) => c.id === "C2PA")).toBe(true);
      expect(out.changes.some((c) => c.group === "C2PA" && c.action === "retained_unsupported")).toBe(true);
    }
  });
});

describe("ISOBMFF uuid locator and removal (AVIF + HEIC)", () => {
  function topOf(name: string) {
    return walkTopLevel(bytesOf(name)).boxes;
  }
  it("proves genuine stores and ignores generic uuid boxes", () => {
    for (const name of ["avif-c2pa-signed.avif", "heic-c2pa-signed.heic"]) {
      const hit = locateIsobmffC2pa(topOf(name));
      expect(hit.identified).toHaveLength(1);
      expect(hit.unproven).toHaveLength(0);
    }
    for (const name of ["heic-uuid.heic", "avif-uuid-unrelated.avif"]) {
      const plain = locateIsobmffC2pa(topOf(name));
      expect(plain.identified).toHaveLength(0);
      expect(plain.unproven).toHaveLength(0);
    }
  });
  it("drops the uuid store with image-item payloads byte-identical", () => {
    for (const [name, kind] of [["avif-c2pa-signed.avif", "avif"], ["heic-c2pa-signed.heic", "heic"]] as const) {
      const input = bytesOf(name);
      const beforePayloads = isobmffImagePayloads(input).map((part) => fingerprint(part)).join("|");
      const out = cleanImageBytes(input, kind, PRIVACY_SAFE_DEFAULT);
      const afterBoxes = walkTopLevel(out.data).boxes;
      expect(locateIsobmffC2pa(afterBoxes).identified).toHaveLength(0);
      expect(validateIsobmffStructure(out.data, kind).ok).toBe(true);
      const afterPayloads = isobmffImagePayloads(out.data).map((part) => fingerprint(part)).join("|");
      expect(afterPayloads).toBe(beforePayloads);
      expect(out.changes.some((c) => c.group === "C2PA" && c.action === "removed")).toBe(true);
    }
  });
  it("retains generic uuid boxes with existing honest semantics", () => {
    for (const [name, kind] of [["heic-uuid.heic", "heic"], ["avif-uuid-unrelated.avif", "avif"]] as const) {
      const out = cleanImageBytes(bytesOf(name), kind, PRIVACY_SAFE_DEFAULT);
      expect(walkTopLevel(out.data).boxes.some((box) => box.type === "uuid")).toBe(true);
      expect(out.coverageLimited).toBe(true);
    }
  });
});

describe("verify gate: C2PA removal is fail-closed without a real after-check", () => {
  function cannedAfter(
    before: ImageInspectionResult,
    c2pa: Pick<InspectionCategoryResult, "status" | "tags">,
  ): ImageInspectionResult {
    const categories = before.categories.map((category) => {
      if (category.category === "EXIF" || category.category === "GPS" || category.category === "XMP") {
        return { ...category, status: "not_detected" as const, tags: [] };
      }
      if (category.category.startsWith("C2PA")) {
        return { ...category, status: c2pa.status, tags: c2pa.tags, warnings: [] };
      }
      return category;
    });
    return { ...before, outcome: "completed", categories, warnings: [] };
  }

  async function runWithAfter(name: string, c2pa: Pick<InspectionCategoryResult, "status" | "tags">) {
    const bytes = bytesOf(name);
    const copy = new Uint8Array(bytes);
    const before = await inspectImage(name, copy.buffer, name, { domParser });
    return verifyCleanedImage({
      fileId: name, inputName: name, extension: extOf(name), kind: kindOf(name, bytes),
      inputBytes: bytes, before, policy: PRIVACY_SAFE_DEFAULT, domParser,
      inspectOutput: async () => cannedAfter(before, c2pa),
    });
  }

  const noTags: InspectionCategoryResult["tags"] = [];
  const manifestTag: InspectionCategoryResult["tags"] = [
    { group: "C2PA / Content Credentials", key: "Manifest Store", displayedValue: "Present", source: "C2PA manifest store" },
  ];

  it("confirms verified_clean when the after-check proves absence", async () => {
    const result = await runWithAfter("signed-c2pa.jpg", { status: "not_detected", tags: noTags });
    expect(result.status).toBe("verified_clean");
    expect(result.output).toBeDefined();
    const c2pa = result.changes.find((c) => c.group === "C2PA" && c.action === "removed");
    expect(c2pa?.verification).toBe("verified");
  });
  it("withholds output when the store is still detected after cleaning", async () => {
    const result = await runWithAfter("signed-c2pa.jpg", { status: "detected", tags: manifestTag });
    expect(result.status).toBe("failed");
    expect(result.output).toBeUndefined();
  });
  it("withholds output when the after-check cannot inspect C2PA", async () => {
    const result = await runWithAfter("signed-c2pa.jpg", { status: "not_inspected", tags: noTags });
    expect(result.status).toBe("failed");
    expect(result.output).toBeUndefined();
    expect(result.errors.join(" ")).toMatch(/not proven|unverified|still present|not explicitly inspected/i);
  });
  it("preflight proves the cleaner output carries no store bytes", async () => {
    for (const name of [
      "signed-c2pa.jpg", "jpeg-c2pa-multi.jpg", "signed-c2pa.png",
      "webp-c2pa-signed.webp", "avif-c2pa-signed.avif", "heic-c2pa-signed.heic",
    ]) {
      const out = cleanImageBytes(bytesOf(name), kindOf(name, bytesOf(name)), PRIVACY_SAFE_DEFAULT);
      await expect(hasEmbeddedManifestStore(new Blob([out.data as BlobPart]))).resolves.toBe(false);
    }
  });
});
