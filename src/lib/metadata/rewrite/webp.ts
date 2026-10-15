import { encodeChunk, parseWebpChunks } from "../clean/webp";
import type { FieldWritePlan } from "./writes";
import {
  buildTiff,
  buildXmpPacket,
  mergeXmpPacket,
  parseTiff,
  type TiffWriteValue,
  type XmlCodec,
  type XmpProperty,
} from "./codecs";

/**
 * WebP profile-field writer (Phase 6): `EXIF` / `XMP ` chunks + VP8X flags.
 * Merge semantics like PNG. VP8X presence bits are SET for added chunks
 * (never cleared here); a missing VP8X is created from the bitstream canvas
 * size. Animated WebP stays refused upstream (dispatcher never routes it).
 */

export type RewriteChannel = "created" | "merged" | "absent" | "unsupported";

export interface WebpRewriteOutput {
  data: Uint8Array;
  warnings: string[];
  detail: { exif: RewriteChannel; xmp: RewriteChannel };
  skipped: Array<{ field: string; channel: string; reason: string }>;
}

const VP8X_FLAG_EXIF = 0x08;
const VP8X_FLAG_XMP = 0x04;

/** Canvas dimensions from a VP8/VP8L bitstream (for VP8X synthesis). */
export function webpCanvasSize(data: Uint8Array, id: string): { width: number; height: number } | null {
  try {
    if (id === "VP8 ") {
      // Frame tag (3) + start code (3) + width/height LE (2+2, 14 bits).
      if (data.length < 10) return null;
      if (data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) return null;
      const width = (data[6] ?? 0) | (((data[7] ?? 0) & 0x3f) << 8);
      const height = (data[8] ?? 0) | (((data[9] ?? 0) & 0x3f) << 8);
      if (width === 0 || height === 0 || width > 16384 || height > 16384) return null;
      return { width, height };
    }
    if (id === "VP8L") {
      // Signature 0x2e + 4 packed bytes: 14b width-1, 14b height-1.
      if (data.length < 5 || data[0] !== 0x2e) return null;
      const b1 = data[1] ?? 0;
      const b2 = data[2] ?? 0;
      const b3 = data[3] ?? 0;
      const b4 = data[4] ?? 0;
      const width = 1 + (b1 | ((b2 & 0x3f) << 8));
      const height = 1 + (((b2 & 0xc0) >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10));
      if (width > 16384 || height > 16384) return null;
      return { width, height };
    }
    return null;
  } catch {
    return null;
  }
}

function buildVp8x(width: number, height: number, flags: number): Uint8Array {
  const out = new Uint8Array(10);
  out[0] = flags & 0xff;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = width & 0xff;
  out[5] = (width >> 8) & 0x3f;
  out[6] = height & 0xff;
  out[7] = (height >> 8) & 0x3f;
  out[8] = 0;
  out[9] = 0;
  return out;
}

export function writeWebpFields(
  input: Uint8Array,
  plans: FieldWritePlan[],
  xml: XmlCodec,
): WebpRewriteOutput {
  const warnings: string[] = [];
  const skipped: WebpRewriteOutput["skipped"] = [];
  const { chunks, trailing } = parseWebpChunks(input);

  const exifWrites: TiffWriteValue[] = [];
  const xmpProps: XmpProperty[] = [];
  const exifFields: string[] = [];
  const xmpFields: string[] = [];
  for (const plan of plans) {
    if (plan.exif.length > 0) {
      exifWrites.push(...plan.exif);
      exifFields.push(plan.field);
    }
    if (plan.xmp.length > 0) {
      xmpProps.push(...plan.xmp);
      xmpFields.push(plan.field);
    }
  }
  const detail: WebpRewriteOutput["detail"] = {
    exif: exifWrites.length === 0 ? "absent" : "unsupported",
    xmp: xmpProps.length === 0 ? "absent" : "unsupported",
  };

  let exifData: Uint8Array | null = null;
  if (exifWrites.length > 0) {
    const existing = chunks.filter((c) => c.id === "EXIF");
    if (existing.length > 1) {
      for (const field of exifFields) skipped.push({ field, channel: "EXIF", reason: "Multiple EXIF chunks present; refusing ambiguous merge." });
    } else if (existing.length === 1 && existing[0]) {
      const parsed = parseTiff(existing[0].data);
      if (!parsed) {
        for (const field of exifFields) skipped.push({ field, channel: "EXIF", reason: "Existing EXIF chunk is malformed; refusing to rewrite it." });
      } else {
        const merged = buildTiff(parsed, exifWrites, parsed.little);
        if (!merged) {
          for (const field of exifFields) skipped.push({ field, channel: "EXIF", reason: "EXIF merge failed value encoding." });
        } else {
          exifData = merged;
          detail.exif = "merged";
        }
      }
    } else {
      const built = buildTiff(null, exifWrites, true);
      if (!built) {
        for (const field of exifFields) skipped.push({ field, channel: "EXIF", reason: "EXIF value encoding failed." });
      } else {
        exifData = built;
        detail.exif = "created";
      }
    }
  }

  let xmpData: Uint8Array | null = null;
  if (xmpProps.length > 0) {
    const existing = chunks.filter((c) => c.id === "XMP ");
    if (existing.length > 1) {
      for (const field of xmpFields) skipped.push({ field, channel: "XMP", reason: "Multiple XMP chunks present; refusing ambiguous merge." });
    } else if (existing.length === 1 && existing[0]) {
      const text = new TextDecoder("utf-8", { fatal: false }).decode(existing[0].data);
      const merged = mergeXmpPacket(text, xmpProps, xml);
      if (merged === null) {
        for (const field of xmpFields) skipped.push({ field, channel: "XMP", reason: "Existing XMP is not parseable XML; refusing to rewrite it." });
      } else {
        xmpData = new TextEncoder().encode(merged);
        detail.xmp = "merged";
      }
    } else {
      xmpData = buildXmpPacket(xmpProps);
      detail.xmp = "created";
    }
  }

  // Assembly: preserve order, swap payloads, set (never clear) VP8X bits,
  // synthesize VP8X from canvas size only when metadata needs signaling.
  const imageChunk = chunks.find((c) => c.id === "VP8 " || c.id === "VP8L");
  const needFlags = (exifData ? VP8X_FLAG_EXIF : 0) | (xmpData ? VP8X_FLAG_XMP : 0);
  let vp8xData: Uint8Array | null = null;
  let vp8xSynthesized = false;
  const existingVp8x = chunks.find((c) => c.id === "VP8X");
  if (needFlags !== 0) {
    if (existingVp8x) {
      if (existingVp8x.data.length < 10) {
        for (const field of [...exifFields, ...xmpFields]) {
          skipped.push({ field, channel: "VP8X", reason: "VP8X chunk too short; cannot signal added metadata." });
        }
        exifData = null;
        xmpData = null;
        detail.exif = exifWrites.length > 0 ? "unsupported" : detail.exif;
        detail.xmp = xmpProps.length > 0 ? "unsupported" : detail.xmp;
      } else {
        vp8xData = existingVp8x.data.slice();
        vp8xData[0] = (vp8xData[0] ?? 0) | needFlags;
      }
    } else if (imageChunk) {
      const canvas = webpCanvasSize(imageChunk.data, imageChunk.id);
      if (!canvas) {
        for (const field of [...exifFields, ...xmpFields]) {
          skipped.push({ field, channel: "VP8X", reason: "Canvas size unreadable; cannot synthesize VP8X for new metadata." });
        }
        exifData = null;
        xmpData = null;
        detail.exif = exifWrites.length > 0 ? "unsupported" : detail.exif;
        detail.xmp = xmpProps.length > 0 ? "unsupported" : detail.xmp;
      } else {
        vp8xData = buildVp8x(canvas.width, canvas.height, needFlags);
        vp8xSynthesized = true;
      }
    }
  }

  const kept: { id: string; data: Uint8Array }[] = [];
  if (vp8xSynthesized && vp8xData) kept.push({ id: "VP8X", data: vp8xData });
  for (const chunk of chunks) {
    if (chunk.id === "VP8X" && vp8xData && !vp8xSynthesized && (exifData || xmpData)) {
      kept.push({ id: chunk.id, data: vp8xData });
      continue;
    }
    if (chunk.id === "EXIF" && exifData) {
      kept.push({ id: chunk.id, data: exifData });
      continue;
    }
    if (chunk.id === "XMP " && xmpData) {
      kept.push({ id: chunk.id, data: xmpData });
      continue;
    }
    kept.push({ id: chunk.id, data: chunk.data });
  }
  if (exifData && !chunks.some((c) => c.id === "EXIF")) {
    // Append new metadata after the image bitstream.
    const at = kept.findIndex((k) => k.id === "VP8 " || k.id === "VP8L");
    kept.splice(at >= 0 ? at + 1 : kept.length, 0, { id: "EXIF", data: exifData });
  }
  if (xmpData && !chunks.some((c) => c.id === "XMP ")) {
    const at = kept.findIndex((k) => k.id === "VP8 " || k.id === "VP8L");
    kept.splice(at >= 0 ? at + 1 : kept.length, 0, { id: "XMP ", data: xmpData });
  }

  const body = kept.map((k) => encodeChunk(k.id, k.data));
  const payloadLength = body.reduce((sum, part) => sum + part.length, 0);
  const riffSize = 4 + payloadLength;
  if (riffSize > 0xffffffff - 8) {
    return { data: input.slice(), warnings: ["Rebuilt RIFF size overflows 32 bits; returning input unchanged."], detail: { exif: "unsupported", xmp: "unsupported" }, skipped };
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
  return { data: out, warnings, detail, skipped };
}
