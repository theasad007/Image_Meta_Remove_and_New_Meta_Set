import {
  CleanRefused,
  MetadataChange,
  fingerprint,
  resolvesCleaningTarget,
  type CleaningPolicy,
} from "./types";

/**
 * Lossless PNG metadata cleaner (Phase 3).
 *
 * Drops eXIf + textual chunks (tEXt/zTXt/iTXt incl. XMP), keeps every
 * rendering chunk, recomputes lengths/CRCs. APNG is refused (never
 * flattened); unknown critical chunks fail closed; CRC mismatches fail
 * closed — no unverified output is ever emitted.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function crc32(data: Uint8Array): number {
  let table = CRC_TABLE;
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c;
    }
    CRC_TABLE = table;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = table[(crc ^ (data[i] ?? 0)) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
let CRC_TABLE: Int32Array | null = null;

export function pngCrc(type: string, data: Uint8Array): number {
  const bytes = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i += 1) bytes[i] = type.charCodeAt(i);
  bytes.set(data, 4);
  return crc32(bytes);
}

export interface PngChunk {
  type: string;
  data: Uint8Array;
  crcOk: boolean;
  offset: number;
}

function readAscii(view: DataView, offset: number): string {
  let out = "";
  for (let i = 0; i < 4; i += 1) out += String.fromCharCode(view.getUint8(offset + i));
  return out;
}

export function parsePngChunks(input: Uint8Array): { chunks: PngChunk[]; trailing: Uint8Array } {
  for (let i = 0; i < 8; i += 1) {
    if (input[i] !== PNG_SIGNATURE[i]) {
      throw new CleanRefused("failed", "Not a PNG (bad signature).");
    }
  }
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const chunks: PngChunk[] = [];
  let offset = 8;
  let steps = 0;
  while (offset + 12 <= input.length && steps < 4096) {
    steps += 1;
    const length = view.getUint32(offset);
    const type = readAscii(view, offset + 4);
    if (!/^[A-Za-z]{4}$/.test(type)) {
      throw new CleanRefused("failed", `PNG chunk with invalid type at offset ${offset}.`);
    }
    if (length > 268435456) {
      throw new CleanRefused("failed", `PNG chunk "${type}" declares ${length} bytes — refusing untrusted length.`);
    }
    if (offset + 12 + length > input.length) {
      throw new CleanRefused("failed", `PNG chunk "${type}" overruns EOF (truncated file).`);
    }
    const data = input.slice(offset + 8, offset + 8 + length);
    const stored = view.getUint32(offset + 8 + length);
    chunks.push({ type, data, crcOk: stored === pngCrc(type, data), offset });
    offset += 12 + length;
    if (type === "IEND") break;
  }
  if (chunks.length === 0 || chunks[chunks.length - 1]?.type !== "IEND") {
    throw new CleanRefused("failed", "PNG has no IEND (truncated file).");
  }
  return { chunks, trailing: input.slice(offset) };
}

function isCritical(type: string): boolean {
  const code = type.charCodeAt(0);
  return code >= 0x41 && code <= 0x5a;
}

const KEEP_TYPES = new Set([
  "IHDR", "PLTE", "IDAT", "IEND", "tRNS",
  "iCCP", "sRGB", "gAMA", "cHRM", "cICP", "pHYs", "sBIT",
]);
const DROP_TYPES = new Set(["eXIf", "tEXt", "zTXt", "iTXt"]);
/** APNG animation control — presence means refuse, never flatten. */
const APNG_TYPES = new Set(["acTL", "fcTL", "fdAT"]);

export interface PngCleanOutput {
  data: Uint8Array;
  changes: MetadataChange[];
  warnings: string[];
  idatFingerprint: string;
  coverageLimited: boolean;
}

function concat(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of arrays) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

function encodeChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, pngCrc(type, data));
  return out;
}

export function cleanPng(input: Uint8Array, policy: CleaningPolicy): PngCleanOutput {
  const { chunks, trailing } = parsePngChunks(input);
  const changes: MetadataChange[] = [];
  const warnings: string[] = [];
  const aggressive = policy.mode === "aggressive_when_proven_safe";
  const removeExif = resolvesCleaningTarget(policy, "exif_gps");
  const removeDescriptive = resolvesCleaningTarget(policy, "descriptive");
  let coverageLimited = false;

  if (chunks.some((c) => APNG_TYPES.has(c.type))) {
    throw new CleanRefused("unsupported", "Animated PNG (APNG) detected — animation chunks are preserved only by refusing; flattening would destroy content.");
  }
  const badCrc = chunks.filter((c) => !c.crcOk);
  if (badCrc.length > 0) {
    throw new CleanRefused(
      "failed",
      `CRC mismatch in ${badCrc.length} chunk(s) (${badCrc.slice(0, 4).map((c) => c.type).join(", ")}); refusing to emit output from a corrupt file.`,
    );
  }

  const kept: Uint8Array[] = [input.slice(0, 8)];
  const idatParts: Uint8Array[] = [];
  let textCount = 0;
  for (const chunk of chunks) {
    if (chunk.type === "IDAT") {
      idatParts.push(chunk.data);
      kept.push(encodeChunk(chunk.type, chunk.data));
      continue;
    }
    const selectedDrop = chunk.type === "eXIf" ? removeExif : removeDescriptive;
    if (DROP_TYPES.has(chunk.type) && selectedDrop) {
      textCount += 1;
      const label = chunk.type === "eXIf" ? "EXIF (eXIf chunk)" : `PNG ${chunk.type} text`;
      const group = chunk.type === "eXIf" ? "EXIF" : "PNG text";
      changes.push({ group, key: label, action: "removed", verification: "not_verified", reason: `${chunk.type} chunk (${chunk.data.length} bytes) dropped; pixels untouched.` });
      continue;
    }
    if (DROP_TYPES.has(chunk.type)) {
      kept.push(encodeChunk(chunk.type, chunk.data));
      continue;
    }
    if (KEEP_TYPES.has(chunk.type)) {
      kept.push(encodeChunk(chunk.type, chunk.data));
      if (chunk.type === "iCCP" || chunk.type === "sRGB" || chunk.type === "gAMA" || chunk.type === "cHRM") {
        changes.push({ group: "Color", key: chunk.type, action: "retained_technical", verification: "not_verified", reason: "Color/display chunk preserved byte-for-byte." });
      }
      continue;
    }
    if (isCritical(chunk.type)) {
      throw new CleanRefused("failed", `Unknown critical chunk "${chunk.type}" — refusing rather than risking an invalid file.`);
    }
    if (aggressive) {
      textCount += 1;
      changes.push({ group: "PNG", key: chunk.type, action: "removed", verification: "not_verified", reason: "Aggressive policy: unknown ancillary chunk dropped." });
      continue;
    }
    kept.push(encodeChunk(chunk.type, chunk.data));
    coverageLimited = true;
    warnings.push(`Unknown ancillary chunk "${chunk.type}" retained; coverage limited.`);
    changes.push({ group: "PNG", key: chunk.type, action: "retained_unsupported", verification: "not_verified", reason: "Unknown ancillary chunk kept; not assessed." });
  }
  if (textCount === 0) {
    warnings.push("No eXIf/textual chunks present — nothing removable found.");
  }
  changes.push({ group: "PNG", key: "structure (signature/IHDR/IDAT/IEND)", action: "retained_technical", verification: "not_verified", reason: "Image structure and pixel payload preserved." });
  const rebuilt = concat(kept);
  if (trailing.length > 0) {
    warnings.push(`${trailing.length} trailing byte(s) after IEND preserved verbatim.`);
    return {
      data: concat([rebuilt, trailing]),
      changes,
      warnings,
      idatFingerprint: fingerprint(concat(idatParts)),
      coverageLimited,
    };
  }
  return {
    data: rebuilt,
    changes,
    warnings,
    idatFingerprint: fingerprint(concat(idatParts)),
    coverageLimited,
  };
}

/** Structural re-validation of finished bytes (verification stage). */
export function validatePngStructure(data: Uint8Array): { ok: boolean; errors: string[] } {
  try {
    parsePngChunks(data);
    return { ok: true, errors: [] };
  } catch (error) {
    if (error instanceof CleanRefused) return { ok: false, errors: [error.message] };
    return { ok: false, errors: ["Unknown PNG validation failure."] };
  }
}

export function pngIdatFingerprint(data: Uint8Array): string {
  const idat = concat(parsePngChunks(data).chunks.filter((c) => c.type === "IDAT").map((c) => c.data));
  return fingerprint(idat);
}
