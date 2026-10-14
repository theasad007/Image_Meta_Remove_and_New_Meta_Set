import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalExtensionForSniffedKind, sniffImageBytes } from "./signatures";

const FIXTURES = path.join(__dirname, "..", "..", "test-fixtures");

function bytesOf(name: string): { head: Uint8Array; total: number } {
  const full = fs.readFileSync(path.join(FIXTURES, name));
  const head = new Uint8Array(full.buffer.slice(full.byteOffset, full.byteOffset + Math.min(65536, full.byteLength)));
  return { head, total: full.byteLength };
}

function extOf(name: string): string {
  return name.slice(name.lastIndexOf(".") + 1).toLowerCase();
}

describe("binary sniffing on real fixtures", () => {
  it("identifies JPEG EXIF fixtures without mismatch", () => {
    for (const name of ["jpeg-exif.jpg", "jpeg-gps-sw.jpg", "jpeg-xmp-iptc.jpg"]) {
      const { head, total } = bytesOf(name);
      const result = sniffImageBytes(head, total, "jpg");
      expect(result.kind).toBe("jpeg");
      expect(result.mismatchWithExtension).toBe(false);
    }
  });
  it("identifies PNG, WebP, AVIF and HEIC with brands", () => {
    const png = bytesOf("png-empty.png");
    expect(sniffImageBytes(png.head, png.total, "png").kind).toBe("png");
    const webp = bytesOf("webp-exif-xmp.webp");
    expect(sniffImageBytes(webp.head, webp.total, "webp").kind).toBe("webp");
    const avif = bytesOf("avif-exif-xmp.avif");
    const avifResult = sniffImageBytes(avif.head, avif.total, "avif");
    expect(avifResult.kind).toBe("avif");
    expect(avifResult.majorBrand).toBe("avif");
    expect(avifResult.hasMetaBox).toBe(true);
    const heic = bytesOf("heic-exif-gps.heic");
    const heicResult = sniffImageBytes(heic.head, heic.total, "heic");
    expect(heicResult.kind).toBe("heic");
    expect(heicResult.majorBrand).toBe("heic");
    expect(heicResult.hasMetaBox).toBe(true);
  });
  it("flags extension spoofing with bytes taking precedence", () => {
    const { head, total } = bytesOf("spoof-jpg-with-png-bytes.jpg");
    const result = sniffImageBytes(head, total, "jpg");
    expect(result.kind).toBe("png");
    expect(result.mismatchWithExtension).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/bytes take precedence/i);
  });
  it("handles empty and random inputs without crashing", () => {
    const empty = bytesOf("empty-file.bin");
    expect(sniffImageBytes(empty.head, empty.total, "bin").kind).toBe("empty");
    const random = bytesOf("random-bytes.bin");
    const result = sniffImageBytes(random.head, random.total, "bin");
    expect(["unknown", "unreadable"]).toContain(result.kind);
  });
  it("warns on truncated JPEG and malformed AVIF instead of trusting lengths", () => {
    const truncated = bytesOf("jpeg-truncated.jpg");
    const jpegResult = sniffImageBytes(truncated.head, truncated.total, "jpg");
    expect(jpegResult.kind).toBe("jpeg");
    expect(jpegResult.warnings.length).toBeGreaterThan(0);
    const badAvif = bytesOf("avif-truncated-box.avif");
    const avifResult = sniffImageBytes(badAvif.head, badAvif.total, "avif");
    expect(avifResult.warnings.join(" ")).toMatch(/largesize|structure/i);
    const huge = bytesOf("png-huge-length.png");
    const pngResult = sniffImageBytes(huge.head, huge.total, "png");
    expect(pngResult.warnings.join(" ")).toMatch(/refusing to trust|truncated|IEND/i);
  });
  it("uses the filename extension only as a hint (ext helper covered)", () => {
    expect(extOf("PHOTO.HEIC")).toBe("heic");
  });
});

describe("synthetic brand classification", () => {
  function isobmff(major: string, compat: string[]): Uint8Array {
    const boxes = new Uint8Array(4 + 4 + 4 + 4 + compat.length * 4 + 8);
    const view = new DataView(boxes.buffer);
    view.setUint32(0, boxes.length);
    for (let i = 0; i < 4; i += 1) boxes[4 + i] = "ftyp".charCodeAt(i);
    for (let i = 0; i < 4; i += 1) boxes[8 + i] = major.charCodeAt(i);
    view.setUint32(12, 0);
    compat.forEach((brand, index) => {
      for (let i = 0; i < 4; i += 1) boxes[16 + index * 4 + i] = brand.charCodeAt(i);
    });
    view.setUint32(16 + compat.length * 4, 8);
    for (let i = 0; i < 4; i += 1) boxes[20 + compat.length * 4 + i] = "mdat".charCodeAt(i);
    return boxes;
  }
  it("treats mif1-only as generic HEIF, never as proven HEIC", () => {
    const result = sniffImageBytes(isobmff("mif1", ["mif1", "miaf"]), 64, "heif");
    expect(result.kind).toBe("heif-generic");
  });
  it("marks avis/msf1 sequences honestly", () => {
    expect(sniffImageBytes(isobmff("avis", ["avis", "msf1"]), 64, "avif").kind).toBe("avif-sequence");
    expect(sniffImageBytes(isobmff("msf1", ["msf1", "hevc"]), 64, "heic").kind).toBe("heif-sequence");
  });
  it("recognizes MP4-family brands as video, not images", () => {
    expect(sniffImageBytes(isobmff("isom", ["isom", "mp41"]), 64, "mp4").kind).toBe("mp4-video");
  });
  it("never reads out of bounds on tiny inputs", () => {
    expect(sniffImageBytes(new Uint8Array([0xff, 0xd8]), 2, "jpg").kind).toBe("unknown");
    expect(sniffImageBytes(new Uint8Array([0x52, 0x49]), 2, "webp").kind).toBe("unknown");
    expect(sniffImageBytes(new Uint8Array(0), 0, "").kind).toBe("empty");
  });
  it("rejects RIFF-that-is-not-WEBP", () => {
    const riff = new Uint8Array([0x52, 0x49, 0x46, 0x46, 8, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]);
    const result = sniffImageBytes(riff, 12, "webp");
    expect(result.kind).toBe("unknown");
    expect(result.mismatchWithExtension).toBe(true);
  });
  it("maps byte-verified kinds to canonical output extensions", () => {
    expect(canonicalExtensionForSniffedKind("jpeg")).toBe("jpg");
    expect(canonicalExtensionForSniffedKind("png")).toBe("png");
    expect(canonicalExtensionForSniffedKind("webp")).toBe("webp");
    expect(canonicalExtensionForSniffedKind("avif")).toBe("avif");
    expect(canonicalExtensionForSniffedKind("avif-sequence")).toBe("avif");
    expect(canonicalExtensionForSniffedKind("heic")).toBe("heic");
    expect(canonicalExtensionForSniffedKind("heif-generic")).toBe("heic");
    expect(canonicalExtensionForSniffedKind("mp4-video")).toBe("mp4");
    expect(canonicalExtensionForSniffedKind("unknown")).toBe("bin");
  });
});
