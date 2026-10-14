import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { C2PA_STORE_UUID, hasEmbeddedManifestStore, inspectC2pa } from "./c2pa";

/**
 * P0 C2PA preflight tests on REAL fixture bytes (no validator mocks).
 *
 * The byte-gate is the only C2PA layer executable under Node: the full
 * validator needs Worker + WebAssembly, so `inspectC2pa` must report
 * `not_inspected` here. The `detected` path is proven by real Chromium E2E
 * (e2e/c2pa-openai.spec.ts) against the production static export.
 */

const FIXTURES = path.join(__dirname, "..", "..", "..", "test-fixtures");

function blobOf(name: string): Blob {
  const full = fs.readFileSync(path.join(FIXTURES, name));
  const bytes = new Uint8Array(full.buffer.slice(full.byteOffset, full.byteOffset + full.byteLength));
  return new Blob([bytes as BlobPart]);
}

describe("C2PA store-UUID preflight (real bytes)", () => {
  it("uses the standard 128-bit Manifest Store JUMBF UUID", () => {
    expect(C2PA_STORE_UUID).toHaveLength(16);
    expect(Array.from(C2PA_STORE_UUID.slice(0, 4))).toEqual([0x63, 0x32, 0x70, 0x61]); // "c2pa"
  });
  it("hits on the genuinely signed JPEG and PNG fixtures", async () => {
    // Signed locally with c2patool 0.27.22 (built-in test identity);
    // independently verified with c2patool + ExifTool 13.55 (see docs/09).
    await expect(hasEmbeddedManifestStore(blobOf("signed-c2pa.jpg"))).resolves.toBe(true);
    // PNG carries the store in a real caBX chunk — same format-independent gate.
    await expect(hasEmbeddedManifestStore(blobOf("signed-c2pa.png"))).resolves.toBe(true);
  });
  it("still hits on the tampered manifest (UUID intact, signature broken)", async () => {
    await expect(hasEmbeddedManifestStore(blobOf("jpeg-c2pa-tampered.jpg"))).resolves.toBe(true);
  });
  it("misses on ordinary images with no manifest store", async () => {
    await expect(hasEmbeddedManifestStore(blobOf("jpeg-exif.jpg"))).resolves.toBe(false);
    await expect(hasEmbeddedManifestStore(blobOf("jpeg-openai.jpg"))).resolves.toBe(false);
    await expect(hasEmbeddedManifestStore(blobOf("jpeg-empty.jpg"))).resolves.toBe(false);
    await expect(hasEmbeddedManifestStore(blobOf("png-text-exif.png"))).resolves.toBe(false);
  });
  it("is not fooled by the dummy JUMBF APP11 marker (no real store UUID)", async () => {
    // jpeg-jumbf.jpg carries APP11 "JUMBF\\0" + zeros — must never preflight-hit.
    await expect(hasEmbeddedManifestStore(blobOf("jpeg-jumbf.jpg"))).resolves.toBe(false);
  });
});

describe("C2PA validator gate under Node (no Worker/WASM runtime)", () => {
  it("reports not_inspected instead of guessing", async () => {
    const result = await inspectC2pa(blobOf("signed-c2pa.jpg"), "image/jpeg");
    expect(result.category.status).toBe("not_inspected");
    expect(result.category.warnings.join(" ")).toMatch(/WASM/i);
    expect(result.aiIndicators).toHaveLength(0);
  });
});
