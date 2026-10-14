import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { C2PA_STORE_UUID, hasEmbeddedManifestStore, inspectC2pa, summarizeValidation } from "./c2pa";

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
  it("hits on the expired-credential fixture (store present, credential expired)", async () => {
    await expect(hasEmbeddedManifestStore(blobOf("expired-cert.jpg"))).resolves.toBe(true);
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

describe("summarizeValidation (failure classes stay distinguishable)", () => {
  it("counts active-manifest failures only, preserving codes in order", () => {
    const summary = summarizeValidation({
      validation_results: {
        activeManifest: {
          failure: [
            { code: "signingCredential.expired", explanation: "certificate expired", success: false },
            { code: "signingCredential.untrusted", explanation: "signing certificate untrusted", success: false },
          ],
        },
      },
      // A flattened list may additionally carry ingredient codes (as seen on
      // real ChatGPT PNGs) — it must not inflate the structured count.
      validation_status: [
        { code: "signingCredential.expired", success: false },
        { code: "signingCredential.untrusted", success: false },
        { code: "signingCredential.untrusted", success: false },
      ],
    });
    expect(summary.failures).toBe(2);
    expect(summary.failureDetails).toEqual([
      "signingCredential.expired — certificate expired",
      "signingCredential.untrusted — signing certificate untrusted",
    ]);
  });
  it("falls back to the flattened list only when structured results are absent", () => {
    const summary = summarizeValidation({
      validation_results: null,
      validation_status: [
        { code: "claimSignature.mismatch", explanation: "signature mismatch", success: false },
        { code: "claimSignature.validated", success: true },
      ],
    });
    expect(summary.failures).toBe(1);
    expect(summary.failureDetails).toEqual(["claimSignature.mismatch — signature mismatch"]);
  });
  it("reports zero cleanly and skips code-less entries in details", () => {
    expect(summarizeValidation({ validation_results: { activeManifest: { failure: [] } } })).toEqual({
      failures: 0,
      failureDetails: [],
    });
    const withBlank = summarizeValidation({
      validation_results: { activeManifest: { failure: [{ code: "  " }, { code: "a.b" }] } },
    });
    expect(withBlank.failures).toBe(2);
    expect(withBlank.failureDetails).toEqual(["a.b"]);
  });
  it("deduplicates repeats and caps adversarial detail lists", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ code: `f.${i % 11}` }));
    const summary = summarizeValidation({ validation_results: { activeManifest: { failure: many } } });
    expect(summary.failures).toBe(12);
    expect(summary.failureDetails).toHaveLength(10);
  });
});
