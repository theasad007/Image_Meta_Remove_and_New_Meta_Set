import {
  CleanRefused,
  MetadataChange,
  fingerprint,
  resolvesCleaningTarget,
  type CleaningPolicy,
} from "./types";

/**
 * Lossless WebP metadata cleaner (Phase 3).
 *
 * Drops EXIF / XMP chunks, clears their VP8X presence flags (and only
 * those), recomputes the RIFF size, and copies every image bitstream
 * byte-for-byte with padding preserved. Animation (ANIM/ANMF) is refused —
 * never flattened.
 */

export interface RiffChunk {
  id: string;
  size: number;
  data: Uint8Array;
  offset: number;
}

/** VP8X feature-flag bits (byte 0 of the 10-byte VP8X payload). */
const VP8X_FLAG_EXIF = 0x08;
const VP8X_FLAG_XMP = 0x04;

export function parseWebpChunks(input: Uint8Array): { chunks: RiffChunk[]; riffSize: number; trailing: Uint8Array } {
  if (
    input.length < 12 ||
    input[0] !== 0x52 || input[1] !== 0x49 || input[2] !== 0x46 || input[3] !== 0x46 ||
    input[8] !== 0x57 || input[9] !== 0x45 || input[10] !== 0x42 || input[11] !== 0x50
  ) {
    throw new CleanRefused("failed", "Not a WebP file (missing RIFF/WEBP header).");
  }
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const riffSize = view.getUint32(4, true);
  if (riffSize + 8 < 12 || riffSize > 0xffffffff - 8) {
    throw new CleanRefused("failed", "WebP RIFF size implausible.");
  }
  const chunks: RiffChunk[] = [];
  let offset = 12;
  let steps = 0;
  const end = Math.min(input.length, riffSize + 8);
  while (offset + 8 <= end && steps < 4096) {
    steps += 1;
    const id = String.fromCharCode(input[offset] ?? 0, input[offset + 1] ?? 0, input[offset + 2] ?? 0, input[offset + 3] ?? 0);
    if (!/^[\x20-\x7e]{4}$/.test(id)) {
      throw new CleanRefused("failed", `WebP chunk with invalid id at offset ${offset}.`);
    }
    const size = view.getUint32(offset + 4, true);
    if (size > end) {
      throw new CleanRefused("failed", `WebP chunk "${id.trim()}" declares ${size} bytes beyond the RIFF bounds.`);
    }
    if (offset + 8 + size > end) {
      throw new CleanRefused("failed", `WebP chunk "${id.trim()}" overruns the declared RIFF bounds (truncated file).`);
    }
    chunks.push({ id, size, data: input.slice(offset + 8, offset + 8 + size), offset });
    offset += 8 + size + (size % 2);
  }
  if (offset !== end) {
    throw new CleanRefused("failed", "Unparsed bytes inside the declared RIFF bounds (malformed file).");
  }
  return { chunks, riffSize, trailing: input.slice(end) };
}

export interface WebpCleanOutput {
  data: Uint8Array;
  changes: MetadataChange[];
  warnings: string[];
  payloadFingerprint: string;
  coverageLimited: boolean;
}

function encodeChunk(id: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + data.length + (data.length % 2));
  for (let i = 0; i < 4; i += 1) out[i] = id.charCodeAt(i);
  const view = new DataView(out.buffer);
  view.setUint32(4, data.length, true);
  out.set(data, 8);
  return out;
}

export function cleanWebp(input: Uint8Array, policy: CleaningPolicy): WebpCleanOutput {
  const { chunks, trailing } = parseWebpChunks(input);
  const changes: MetadataChange[] = [];
  const warnings: string[] = [];
  const aggressive = policy.mode === "aggressive_when_proven_safe";
  const removeExif = resolvesCleaningTarget(policy, "exif_gps");
  const removeDescriptive = resolvesCleaningTarget(policy, "descriptive");
  let coverageLimited = false;

  const ids = new Set(chunks.map((c) => c.id));
  if (ids.has("ANIM") || ids.has("ANMF")) {
    throw new CleanRefused("unsupported", "Animated WebP detected — animation chunks are preserved only by refusing; flattening would destroy content.");
  }
  const imageChunks = chunks.filter((c) => c.id === "VP8 " || c.id === "VP8L");
  if (imageChunks.length === 0) {
    throw new CleanRefused("failed", "No VP8/VP8L image bitstream found.");
  }

  const kept: { id: string; data: Uint8Array }[] = [];
  let removedCount = 0;
  for (const chunk of chunks) {
    if (chunk.id === "EXIF") {
      if (removeExif) {
        removedCount += 1;
        changes.push({ group: "EXIF", key: "WebP EXIF chunk", action: "removed", verification: "not_verified", reason: `EXIF chunk (${chunk.size} bytes) dropped; bitstream untouched.` });
      } else {
        kept.push({ id: chunk.id, data: chunk.data });
      }
      continue;
    }
    if (chunk.id === "XMP ") {
      if (removeDescriptive) {
        removedCount += 1;
        changes.push({ group: "XMP", key: "WebP XMP chunk", action: "removed", verification: "not_verified", reason: `XMP chunk (${chunk.size} bytes) dropped; bitstream untouched.` });
      } else {
        kept.push({ id: chunk.id, data: chunk.data });
      }
      continue;
    }
    if (chunk.id === "VP8X") {
      if (chunk.data.length < 10) {
        throw new CleanRefused("failed", "VP8X chunk too short to carry flags/canvas size.");
      }
      const data = chunk.data.slice();
      const before = data[0] ?? 0;
      const clearMask = (removeExif ? VP8X_FLAG_EXIF : 0) | (removeDescriptive ? VP8X_FLAG_XMP : 0);
      data[0] = before & ~clearMask;
      if (data[0] !== before) {
        changes.push({ group: "WebP", key: "VP8X metadata flags", action: "removed", verification: "not_verified", reason: "EXIF/XMP presence bits cleared; all other feature bits preserved." });
      }
      kept.push({ id: chunk.id, data });
      continue;
    }
    if (chunk.id === "ICCP") {
      kept.push({ id: chunk.id, data: chunk.data });
      changes.push({ group: "Color", key: "ICCP", action: "retained_technical", verification: "not_verified", reason: "Color profile preserved byte-for-byte." });
      continue;
    }
    if (chunk.id === "VP8 " || chunk.id === "VP8L" || chunk.id === "ALPH") {
      kept.push({ id: chunk.id, data: chunk.data });
      continue;
    }
    if (aggressive) {
      removedCount += 1;
      changes.push({ group: "WebP", key: chunk.id.trim() === "" ? "(padding/unknown)" : chunk.id, action: "removed", verification: "not_verified", reason: "Aggressive policy: unknown chunk dropped." });
      continue;
    }
    kept.push({ id: chunk.id, data: chunk.data });
    coverageLimited = true;
    warnings.push(`Unknown WebP chunk "${chunk.id}" retained; coverage limited.`);
    changes.push({ group: "WebP", key: chunk.id, action: "retained_unsupported", verification: "not_verified", reason: "Unknown chunk kept; not assessed." });
  }
  if (removedCount === 0) {
    warnings.push("No EXIF/XMP chunks present — nothing removable found.");
  }
  changes.push({ group: "WebP", key: "structure (RIFF/VP8X/bitstreams)", action: "retained_technical", verification: "not_verified", reason: "Container structure and image bitstreams preserved." });

  const body = kept.map((k) => encodeChunk(k.id, k.data));
  const payloadLength = body.reduce((sum, part) => sum + part.length, 0);
  // RIFF size = 4 (WEBP) + chunks.
  const riffSize = 4 + payloadLength;
  if (riffSize > 0xffffffff - 8) {
    throw new CleanRefused("failed", "Rebuilt RIFF size overflows 32 bits.");
  }
  const out = new Uint8Array(12 + payloadLength + trailing.length);
  out[0] = 0x52; out[1] = 0x49; out[2] = 0x46; out[3] = 0x46;
  new DataView(out.buffer).setUint32(4, riffSize, true);
  out[8] = 0x57; out[9] = 0x45; out[10] = 0x42; out[11] = 0x50;
  let cursor = 12;
  for (const part of body) {
    out.set(part, cursor);
    cursor += part.length;
  }
  if (trailing.length > 0) {
    out.set(trailing, cursor);
    warnings.push(`${trailing.length} trailing byte(s) past the RIFF bounds preserved verbatim.`);
  }
  const payload = imageChunks.map((c) => c.data);
  const total = payload.reduce((sum, part) => sum + part.length, 0);
  const joined = new Uint8Array(total);
  let c = 0;
  for (const part of payload) {
    joined.set(part, c);
    c += part.length;
  }
  return { data: out, changes, warnings, payloadFingerprint: fingerprint(joined), coverageLimited };
}

/** Structural re-validation of finished bytes (verification stage). */
export function validateWebpStructure(data: Uint8Array): { ok: boolean; errors: string[] } {
  try {
    const { chunks, trailing } = parseWebpChunks(data);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const declared = view.getUint32(4, true);
    if (declared + 8 + trailing.length !== data.length) {
      return { ok: false, errors: [`RIFF size field (${declared}) disagrees with file length (${data.length - 8}).`] };
    }
    if (!chunks.some((ch) => ch.id === "VP8 " || ch.id === "VP8L")) {
      return { ok: false, errors: ["Rebuilt WebP has no image bitstream."] };
    }
    return { ok: true, errors: [] };
  } catch (error) {
    if (error instanceof CleanRefused) return { ok: false, errors: [error.message] };
    return { ok: false, errors: ["Unknown WebP validation failure."] };
  }
}

export function webpPayloadFingerprint(data: Uint8Array): string {
  const { chunks } = parseWebpChunks(data);
  const payload = chunks.filter((ch) => ch.id === "VP8 " || ch.id === "VP8L").map((ch) => ch.data);
  const total = payload.reduce((sum, part) => sum + part.length, 0);
  const joined = new Uint8Array(total);
  let cursor = 0;
  for (const part of payload) {
    joined.set(part, cursor);
    cursor += part.length;
  }
  return fingerprint(joined);
}
