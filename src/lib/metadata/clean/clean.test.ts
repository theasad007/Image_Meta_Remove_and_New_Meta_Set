import fs from "node:fs";
import path from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import { beforeAll, describe, expect, it } from "vitest";
import { sniffImageBytes, type SniffedKind } from "../../format-detection/signatures";
import { inspectImage } from "../inspect/inspect";
import type { ImageInspectionResult } from "../../../types/inspection";
import { cleanImageBytes } from "./index";
import { parsePngChunks, pngCrc } from "./png";
import { parseWebpChunks } from "./webp";
import { fingerprint, PRIVACY_SAFE_DEFAULT, type CleaningPolicy } from "./types";
import { createRunGuard } from "../verify/run-guard";
import { verifyCleanedImage } from "../verify/verify";

/**
 * Phase 3 cleaner + verification tests on REAL fixture bytes.
 * Every positive case asserts removal evidence, technical retention, and
 * payload equality through the mandatory verify gate — never the cleaner's
 * word alone. The `after` inspection runs the same Phase 2 engine.
 */

const FIXTURES = path.join(__dirname, "..", "..", "..", "test-fixtures");
const domParser = new DOMParser();
const AGGRESSIVE: CleaningPolicy = { mode: "aggressive_when_proven_safe" };
const beforeResults = new Map<string, ImageInspectionResult>();

function bytesOf(name: string): Uint8Array {
  const full = fs.readFileSync(path.join(FIXTURES, name));
  return new Uint8Array(full.buffer.slice(full.byteOffset, full.byteOffset + full.byteLength));
}

function extOf(name: string): string {
  return name.slice(name.lastIndexOf(".") + 1).toLowerCase();
}

function sniffedKind(name: string, bytes: Uint8Array): { kind: SniffedKind; brand?: string } {
  const sniff = sniffImageBytes(bytes.slice(0, Math.min(65536, bytes.length)), bytes.length, extOf(name));
  if (
    sniff.kind === "empty" || sniff.kind === "unknown" || sniff.kind === "unreadable" ||
    sniff.kind === "mp4-video" || sniff.kind === "avif-sequence" || sniff.kind === "heif-sequence"
  ) {
    throw new Error(`fixture ${name} sniffed as ${sniff.kind}`);
  }
  return { kind: sniff.kind, brand: sniff.majorBrand };
}

async function beforeOf(name: string): Promise<ImageInspectionResult> {
  const hit = beforeResults.get(name);
  if (hit) return hit;
  const bytes = bytesOf(name);
  const copy = new Uint8Array(bytes);
  const result = await inspectImage(name, copy.buffer, name, { domParser });
  beforeResults.set(name, result);
  return result;
}

async function cleanAndVerify(name: string, policy = PRIVACY_SAFE_DEFAULT) {
  const bytes = bytesOf(name);
  const before = await beforeOf(name);
  const { kind, brand } = sniffedKind(name, bytes);
  const result = await verifyCleanedImage({
    fileId: name, inputName: name, extension: extOf(name), kind, brand,
    inputBytes: bytes, before, policy, domParser,
  });
  return { bytes, before, result };
}

function categoryOf(result: ImageInspectionResult, category: string) {
  const found = result.categories.find((c) => c.category === category);
  if (!found) throw new Error(`missing category ${category}`);
  return found;
}

beforeAll(async () => {
  for (const name of [
    "jpeg-exif.jpg", "jpeg-gps-sw.jpg", "jpeg-xmp-iptc.jpg", "jpeg-empty.jpg",
    "jpeg-progressive.jpg", "jpeg-xmp-extended.jpg", "jpeg-jumbf.jpg", "jpeg-icc.jpg",
    "png-text-exif.png", "png-empty.png", "png-icc.png",
    "webp-exif-xmp.webp", "webp-empty.webp", "webp-lossless-alpha.webp",
    "avif-exif-xmp.avif", "avif-real-encoder.avif",
    "heic-exif-gps.heic", "heic-uuid.heic", "heic-real-encoder.heic",
  ]) {
    await beforeOf(name);
  }
}, 180000);

describe("JPEG cleaning + verification", () => {
  it("removes EXIF/GPS/XMP/IPTC with verified field evidence", async () => {
    const { result } = await cleanAndVerify("jpeg-xmp-iptc.jpg");
    expect(result.status).toBe("verified_clean");
    expect(result.output).toBeDefined();
    const verified = result.changes.filter((c) => c.action === "removed" && c.verification === "verified");
    expect(verified.map((c) => `${c.group}:${c.key}`)).toContain("EXIF:APP1 Exif segment");
    const after = result.after;
    if (!after) throw new Error("missing after-inspection");
    expect(categoryOf(after, "EXIF").status).toBe("not_detected");
    expect(categoryOf(after, "GPS").status).toBe("not_detected");
    expect(categoryOf(after, "XMP").status).toBe("not_detected");
    expect(categoryOf(after, "IPTC").status).toBe("not_detected");
  });
  it("removes only the metadata families selected by the user", async () => {
    const exifOnly = (await cleanAndVerify("jpeg-xmp-iptc.jpg", {
      mode: "privacy_safe_default",
      targets: ["exif_gps"],
    })).result;
    expect(exifOnly.status).toBe("verified_clean");
    expect(categoryOf(exifOnly.after!, "EXIF").status).toBe("not_detected");
    expect(categoryOf(exifOnly.after!, "XMP").status).toBe("detected");
    expect(categoryOf(exifOnly.after!, "IPTC").status).toBe("detected");

    const descriptiveOnly = (await cleanAndVerify("jpeg-xmp-iptc.jpg", {
      mode: "privacy_safe_default",
      targets: ["descriptive"],
    })).result;
    expect(descriptiveOnly.status).toBe("verified_clean");
    expect(categoryOf(descriptiveOnly.after!, "EXIF").status).toBe("detected");
    expect(categoryOf(descriptiveOnly.after!, "XMP").status).toBe("not_detected");
    expect(categoryOf(descriptiveOnly.after!, "IPTC").status).toBe("not_detected");
  });
  it("AI-only cleaning targets the metadata block that supplied AI evidence", async () => {
    const before = await beforeOf("jpeg-ai.jpg");
    expect(before.aiIndicators.length).toBeGreaterThan(0);
    const result = (await cleanAndVerify("jpeg-ai.jpg", {
      mode: "privacy_safe_default",
      targets: ["ai_markers"],
      aiEvidenceGroups: [...new Set(before.aiIndicators.map((indicator) => indicator.evidenceGroup))],
    })).result;
    expect(result.status).toBe("verified_clean");
    expect(result.after?.aiIndicators).toHaveLength(0);
  });
  it("keeps Orientation in a minimal technical EXIF for rotated photos", async () => {
    const { result } = await cleanAndVerify("jpeg-gps-sw.jpg");
    expect(result.status).toBe("verified_clean");
    const after = result.after;
    if (!after) throw new Error("missing after-inspection");
    const orientation = categoryOf(after, "EXIF").tags.find((t) => t.key === "Orientation");
    expect(orientation).toBeDefined();
    expect(categoryOf(after, "EXIF").tags).toHaveLength(1);
    expect(categoryOf(after, "GPS").status).toBe("not_detected");
    expect(result.changes.some((c) => c.action === "retained_technical" && c.key === "Orientation" && c.verification === "verified")).toBe(true);
  });
  it("preserves progressive scans and ICC profiles byte-for-byte", async () => {
    const progressive = (await cleanAndVerify("jpeg-progressive.jpg")).result;
    expect(progressive.status).toBe("verified_clean");
    const icc = (await cleanAndVerify("jpeg-icc.jpg")).result;
    expect(icc.status).toBe("verified_clean");
    expect(icc.changes.some((c) => c.group === "ICC" && c.action === "retained_technical" && c.verification === "verified")).toBe(true);
  });
  it("drops extended XMP fragments and reports JUMBF as coverage-limited partial", async () => {
    const extended = (await cleanAndVerify("jpeg-xmp-extended.jpg")).result;
    expect(extended.status).toBe("verified_clean");
    const after = extended.after;
    if (!after) throw new Error("missing after-inspection");
    expect(categoryOf(after, "XMP").status).toBe("not_detected");
    const jumbf = (await cleanAndVerify("jpeg-jumbf.jpg")).result;
    expect(jumbf.status).toBe("partially_cleaned");
    expect(jumbf.output).toBeDefined();
    expect(jumbf.changes.some((c) => c.group === "JUMBF" && c.action === "retained_unsupported")).toBe(true);
    const jumbfAfter = jumbf.after;
    if (!jumbfAfter) throw new Error("missing after-inspection");
    expect(categoryOf(jumbfAfter, "EXIF").status).toBe("not_detected");
  });
  it("reports no-op files without fake success", async () => {
    const { result, bytes } = await cleanAndVerify("jpeg-empty.jpg");
    expect(result.status).toBe("unchanged_no_target_tags");
    expect(result.output).toBeDefined();
    const outputBytes = new Uint8Array(await result.output!.arrayBuffer());
    expect(outputBytes.length).toBe(bytes.length);
  });
  it("fails safely on truncated input with no output", async () => {
    const bytes = bytesOf("jpeg-truncated.jpg");
    const before = await beforeOf("jpeg-truncated.jpg");
    const result = await verifyCleanedImage({
      fileId: "t", inputName: "jpeg-truncated.jpg", extension: "jpg", kind: "jpeg",
      inputBytes: bytes, before, policy: PRIVACY_SAFE_DEFAULT, domParser,
    });
    expect(result.status).toBe("failed");
    expect(result.output).toBeUndefined();
  });
  it("leaves the source bytes untouched", async () => {
    const bytes = bytesOf("jpeg-exif.jpg");
    const digestBefore = fingerprint(bytes);
    await cleanAndVerify("jpeg-exif.jpg");
    expect(fingerprint(bytesOf("jpeg-exif.jpg"))).toBe(digestBefore);
  });
  it("treats unknown APPn conservatively by default, aggressively on request", () => {
    const base = bytesOf("jpeg-empty.jpg");
    const app9 = new Uint8Array([0xff, 0xe9, 0x00, 0x04, 0x01, 0x02]);
    const withApp9 = new Uint8Array([...base.slice(0, 2), ...app9, ...base.slice(2)]);
    const cautious = cleanImageBytes(withApp9, "jpeg", PRIVACY_SAFE_DEFAULT);
    expect(cautious.coverageLimited).toBe(true);
    expect(cautious.data.length).toBe(withApp9.length);
    const strict = cleanImageBytes(withApp9, "jpeg", AGGRESSIVE);
    expect(strict.data.length).toBeLessThan(withApp9.length);
    expect(strict.changes.some((c) => c.group === "APPn" && c.action === "removed")).toBe(true);
  });
});

describe("PNG cleaning + verification", () => {
  it("drops text/eXIf chunks, keeps pixels/profile with valid CRCs", async () => {
    const { result, bytes } = await cleanAndVerify("png-text-exif.png");
    expect(result.status).toBe("verified_clean");
    const after = result.after;
    if (!after) throw new Error("missing after-inspection");
    expect(categoryOf(after, "PNG text chunks").status).toBe("not_detected");
    expect(categoryOf(after, "EXIF").status).toBe("not_detected");
    // iCCP-class chunks preserved: re-parse output independently.
    const outputBytes = new Uint8Array(await result.output!.arrayBuffer());
    const outChunks = parsePngChunks(outputBytes).chunks;
    expect(outChunks.every((c) => c.crcOk)).toBe(true);
    expect(outChunks.some((c) => c.type === "IDAT")).toBe(true);
    const inChunks = parsePngChunks(bytes).chunks;
    const idatIn = inChunks.filter((c) => c.type === "IDAT").map((c) => c.data);
    const idatOut = outChunks.filter((c) => c.type === "IDAT").map((c) => c.data);
    expect(fingerprint(Buffer.concat(idatOut.map((d) => Buffer.from(d))))).toBe(
      fingerprint(Buffer.concat(idatIn.map((d) => Buffer.from(d)))),
    );
  });
  it("preserves iCCP byte-for-byte while removing Title text", async () => {
    const { result, bytes } = await cleanAndVerify("png-icc.png");
    expect(result.status).toBe("verified_clean");
    const outputBytes = new Uint8Array(await result.output!.arrayBuffer());
    const iccp = (chunks: ReturnType<typeof parsePngChunks>["chunks"], type: string) =>
      chunks.find((c) => c.type === type)?.data;
    expect(fingerprint(iccp(parsePngChunks(outputBytes).chunks, "iCCP")!)).toBe(
      fingerprint(iccp(parsePngChunks(bytes).chunks, "iCCP")!));
  });
  it("fails closed on CRC corruption and refuses APNG", async () => {
    const bad = bytesOf("png-bad-crc.png");
    const result = await verifyCleanedImage({
      fileId: "bad", inputName: "png-bad-crc.png", extension: "png", kind: "png",
      inputBytes: bad, before: await beforeOf("png-bad-crc.png"), policy: PRIVACY_SAFE_DEFAULT, domParser,
    });
    expect(result.status).toBe("failed");
    expect(result.output).toBeUndefined();
    // Synthetic APNG: signature + IHDR + acTL + IEND (valid CRCs).
    const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = new Uint8Array([0, 0, 0, 16, 16, 8, 2, 0, 0, 0]);
    const actl = new Uint8Array([0, 0, 0, 2, 0, 0, 0, 0]);
    const mk = (type: string, data: Uint8Array) => {
      const out = new Uint8Array(12 + data.length);
      new DataView(out.buffer).setUint32(0, data.length);
      for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
      out.set(data, 8);
      new DataView(out.buffer).setUint32(8 + data.length, pngCrc(type, data));
      return out;
    };
    const apng = Buffer.concat([Buffer.from(sig), Buffer.from(mk("IHDR", ihdr)), Buffer.from(mk("acTL", actl)), Buffer.from(mk("IEND", new Uint8Array(0)))]);
    const apngResult = await verifyCleanedImage({
      fileId: "apng", inputName: "anim.png", extension: "png", kind: "png",
      inputBytes: new Uint8Array(apng), before: await beforeOf("png-empty.png"),
      policy: PRIVACY_SAFE_DEFAULT, domParser,
    });
    expect(apngResult.status).toBe("unsupported");
    expect(apngResult.output).toBeUndefined();
  });
  it("aggressive mode drops unknown ancillary chunks, default retains them", async () => {
    const base = bytesOf("png-empty.png");
    const time = new Uint8Array([50, 48, 50, 54, 10, 13, 12, 34, 56]);
    const mk = (type: string, data: Uint8Array) => {
      const out = new Uint8Array(12 + data.length);
      new DataView(out.buffer).setUint32(0, data.length);
      for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
      out.set(data, 8);
      new DataView(out.buffer).setUint32(8 + data.length, pngCrc(type, data));
      return out;
    };
    // Insert tIME before IEND.
    const iend = base.length - 12;
    const withTime = new Uint8Array([...base.slice(0, iend), ...mk("tIME", time), ...base.slice(iend)]);
    const cautious = cleanImageBytes(withTime, "png", PRIVACY_SAFE_DEFAULT);
    expect(cautious.coverageLimited).toBe(true);
    const strict = cleanImageBytes(withTime, "png", AGGRESSIVE);
    expect(strict.changes.some((c) => c.key === "tIME" && c.action === "removed")).toBe(true);
  });
});

describe("WebP cleaning + verification", () => {
  it("drops EXIF/XMP, clears only their VP8X bits, keeps the bitstream", async () => {
    const { result } = await cleanAndVerify("webp-exif-xmp.webp");
    expect(result.status).toBe("verified_clean");
    const outputBytes = new Uint8Array(await result.output!.arrayBuffer());
    const { chunks } = parseWebpChunks(outputBytes);
    expect(chunks.some((c) => c.id === "EXIF" || c.id === "XMP ")).toBe(false);
    const vp8x = chunks.find((c) => c.id === "VP8X");
    if (!vp8x) throw new Error("expected VP8X in output");
    expect((vp8x.data[0] ?? 0) & 0x0c).toBe(0);
    const after = result.after;
    if (!after) throw new Error("missing after-inspection");
    expect(categoryOf(after, "EXIF").status).toBe("not_detected");
    expect(categoryOf(after, "XMP").status).toBe("not_detected");
  });
  it("preserves lossless + alpha payloads and refuses animation", async () => {
    const lossless = (await cleanAndVerify("webp-lossless-alpha.webp")).result;
    expect(lossless.status).toBe("verified_clean");
    const animated = bytesOf("webp-animated.webp");
    const result = await verifyCleanedImage({
      fileId: "anim", inputName: "webp-animated.webp", extension: "webp", kind: "webp",
      inputBytes: animated, before: await beforeOf("webp-animated.webp"),
      policy: PRIVACY_SAFE_DEFAULT, domParser,
    });
    expect(result.status).toBe("unsupported");
    expect(result.output).toBeUndefined();
  });
});

describe("AVIF cleaning + verification (mandatory)", () => {
  it("cleans the hand-built still: items dropped, payload equal, brand kept", async () => {
    const { result } = await cleanAndVerify("avif-exif-xmp.avif");
    expect(result.status).toBe("verified_clean");
    expect(result.detectedBrand).toBe("avif");
    const after = result.after;
    if (!after) throw new Error("missing after-inspection");
    expect(categoryOf(after, "EXIF").status).toBe("not_detected");
    expect(categoryOf(after, "XMP").status).toBe("not_detected");
    expect(categoryOf(after, "GPS").status).toBe("not_detected");
  });
  it("cleans the real-encoder still incl. iref cdsc pruning", async () => {
    const { result } = await cleanAndVerify("avif-real-encoder.avif");
    expect(result.status).toBe("verified_clean");
    const after = result.after;
    if (!after) throw new Error("missing after-inspection");
    expect(categoryOf(after, "EXIF").status).toBe("not_detected");
    expect(categoryOf(after, "GPS").status).toBe("not_detected");
  });
  it("refuses grid collections via a synthetic item-type swap", async () => {
    const bytes = bytesOf("avif-exif-xmp.avif");
    const swapped = bytes.slice();
    // iinf 'av01' primary item type -> 'grid' (same length, offsets intact).
    const marker = new TextEncoder().encode("av01");
    let found = -1;
    for (let i = 0; i + 4 <= swapped.length; i += 1) {
      if (swapped[i] === marker[0] && swapped[i + 1] === marker[1] && swapped[i + 2] === marker[2] && swapped[i + 3] === marker[3]) {
        found = i;
        break;
      }
    }
    if (found < 0) throw new Error("test setup: av01 marker not found");
    swapped.set(new TextEncoder().encode("grid"), found);
    const before = await beforeOf("avif-exif-xmp.avif");
    const result = await verifyCleanedImage({
      fileId: "grid", inputName: "grid.avif", extension: "avif", kind: "avif",
      inputBytes: swapped, before, policy: PRIVACY_SAFE_DEFAULT, domParser,
    });
    expect(result.status).toBe("unsupported");
    expect(result.output).toBeUndefined();
  });
});

describe("HEIC cleaning + verification (mandatory)", () => {
  it("cleans the still including the 0,0 GPS edge", async () => {
    const { result } = await cleanAndVerify("heic-exif-gps.heic");
    expect(result.status).toBe("verified_clean");
    expect(result.detectedBrand).toBe("heic");
    const after = result.after;
    if (!after) throw new Error("missing after-inspection");
    expect(categoryOf(after, "EXIF").status).toBe("not_detected");
    expect(categoryOf(after, "GPS").status).toBe("not_detected");
  });
  it("cleans the real libheif-encoded still (dual cdsc, 5-prop ipma, non-zero base offset)", async () => {
    const { result } = await cleanAndVerify("heic-real-encoder.heic");
    expect(result.status).toBe("verified_clean");
    expect(result.detectedBrand).toBe("heic");
    const after = result.after;
    if (!after) throw new Error("missing after-inspection");
    expect(categoryOf(after, "EXIF").status).toBe("not_detected");
    expect(categoryOf(after, "GPS").status).toBe("not_detected");
    expect(categoryOf(after, "XMP").status).toBe("not_detected");
  });
  it("keeps trailing uuid boxes and reports coverage-limited partial", async () => {
    const { result } = await cleanAndVerify("heic-uuid.heic");
    expect(result.status).toBe("partially_cleaned");
    expect(result.output).toBeDefined();
    expect(result.changes.some((c) => c.group === "JUMBF" && c.action === "retained_unsupported")).toBe(true);
    const after = result.after;
    if (!after) throw new Error("missing after-inspection");
    expect(categoryOf(after, "EXIF").status).toBe("not_detected");
  });
});

describe("negative,Naming, budget and guard coverage", () => {
  it("re-cleaning a cleaned file reports no-op without fake success", async () => {
    const first = (await cleanAndVerify("jpeg-xmp-iptc.jpg")).result;
    expect(first.status).toBe("verified_clean");
    const outputBytes = new Uint8Array(await first.output!.arrayBuffer());
    const second = await verifyCleanedImage({
      fileId: "second", inputName: first.outputName ?? "x-clean.jpg",
      extension: "jpg", kind: "jpeg", inputBytes: outputBytes,
      before: first.after!, policy: PRIVACY_SAFE_DEFAULT, domParser,
    });
    expect(second.status).toBe("unchanged_no_target_tags");
  });
  it("cleans by bytes, not by spoofed extension", async () => {
    const bytes = bytesOf("spoof-jpg-with-png-bytes.jpg");
    const sniff = sniffImageBytes(bytes.slice(0, Math.min(65536, bytes.length)), bytes.length, "jpg");
    expect(sniff.kind).toBe("png");
    const before = await beforeOf("spoof-jpg-with-png-bytes.jpg");
    const result = await verifyCleanedImage({
      fileId: "spoof", inputName: "spoof-jpg-with-png-bytes.jpg", extension: "jpg",
      kind: sniff.kind, inputBytes: bytes, before, policy: PRIVACY_SAFE_DEFAULT, domParser,
    });
    expect(result.status).toBe("unchanged_no_target_tags");
  });
  it("refuses video/empty/random/oversized inputs without invoking image writers", async () => {
    for (const [name, kind] of [["empty-file.bin", "empty"], ["random-bytes.bin", "unknown"]] as const) {
      const bytes = bytesOf(name);
      const result = await verifyCleanedImage({
        fileId: name, inputName: name, extension: "bin", kind,
        inputBytes: bytes, before: await beforeOf(name).catch(() => beforeResults.get("jpeg-empty.jpg")!),
        policy: PRIVACY_SAFE_DEFAULT, domParser,
      });
      expect(result.status).toBe("failed");
      expect(result.output).toBeUndefined();
    }
    const big = await verifyCleanedImage({
      fileId: "big", inputName: "jpeg-exif.jpg", extension: "jpg", kind: "jpeg",
      inputBytes: bytesOf("jpeg-exif.jpg"), before: await beforeOf("jpeg-exif.jpg"),
      policy: PRIVACY_SAFE_DEFAULT, domParser, maxBytes: 10,
    });
    expect(big.status).toBe("failed");
    expect(big.errors.join(" ")).toMatch(/budget/i);
  });
  it("withholds output when the structured after-inspection fails", async () => {
    const name = "jpeg-exif.jpg";
    const bytes = bytesOf(name);
    const before = await beforeOf(name);
    const { kind } = sniffedKind(name, bytes);
    const result = await verifyCleanedImage({
      fileId: "after-fails",
      inputName: name,
      extension: "jpg",
      kind,
      inputBytes: bytes,
      before,
      policy: PRIVACY_SAFE_DEFAULT,
      domParser,
      inspectOutput: async () => ({
        ...before,
        fileId: "after-fails:after",
        outcome: "failed",
        categories: [],
        warnings: ["Injected reader failure."],
      }),
    });
    expect(result.status).toBe("not_verified");
    expect(result.output).toBeUndefined();
    expect(result.errors.join(" ")).toMatch(/re-inspection ended as failed/i);
  });
  it("never treats a missing after category as proof of removal", async () => {
    const name = "jpeg-exif.jpg";
    const bytes = bytesOf(name);
    const before = await beforeOf(name);
    const { kind } = sniffedKind(name, bytes);
    const result = await verifyCleanedImage({
      fileId: "missing-after-category",
      inputName: name,
      extension: "jpg",
      kind,
      inputBytes: bytes,
      before,
      policy: PRIVACY_SAFE_DEFAULT,
      domParser,
      inspectOutput: async () => ({
        ...before,
        fileId: "missing-after-category:after",
        outcome: "completed",
        categories: [],
        warnings: [],
      }),
    });
    expect(result.status).toBe("failed");
    expect(result.output).toBeUndefined();
    expect(result.changes.some((change) => change.verification === "failed")).toBe(true);
  });
  it("sanitizes dangerous output names and keeps the true extension", async () => {
    const { buildOutputName: out } = await import("./types");
    expect(out("../../etc/passwd", "jpg")).toBe("passwd-clean.jpg");
    expect(out("photo.PNG", "png")).toBe("photo-clean.png");
    expect(out("", "heic")).toBe("file-clean.heic");
  });
  it("download bytes equal the verified output bytes", async () => {
    const { result } = await cleanAndVerify("webp-exif-xmp.webp");
    const blob = result.output;
    if (!blob) throw new Error("expected output blob");
    expect(blob.type).toBe("image/webp");
    expect(blob.size).toBe(result.outputBytes);
  });
  it("run-guard discards stale completions after cancel", async () => {
    const guard = createRunGuard();
    const first = guard.token();
    guard.cancel();
    expect(guard.isCurrent(first)).toBe(false);
    const second = guard.token();
    expect(guard.isCurrent(second)).toBe(true);
  });
});
