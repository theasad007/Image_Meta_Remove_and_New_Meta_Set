import { encodeChunk, parsePngChunks } from "../clean/png";
import type { GpsEngineDirective } from "./gps";
import { GPS_XMP_REMOVAL_QUERIES, toTiffDirective } from "./gps";
import type { FieldWritePlan } from "./writes";
import {
  buildTiff,
  buildTiffWithGps,
  buildXmpPacket,
  editXmpPacket,
  parseTiff,
  type TiffWriteValue,
  type XmlCodec,
  type XmpProperty,
} from "./codecs";

/**
 * PNG profile-field writer (Phase 6) with Screen 09 GPS support:
 * `eXIf` TIFF chunk (rebuilt through the GPS-aware codec when a GPS
 * directive rides along) + XMP `iTXt` chunk (standard coordinate mirrors
 * stripped for "Remove GPS location"). Merge semantics otherwise: existing
 * chunks are read and overlaid, everything else (IDAT/iCCP/palette/
 * ancillary) passes through byte-identical with fresh CRCs. New metadata
 * chunks are inserted right after IHDR.
 */

export type RewriteChannel = "created" | "merged" | "absent" | "unsupported";

export interface PngRewriteOutput {
  data: Uint8Array;
  warnings: string[];
  detail: { exif: RewriteChannel; xmp: RewriteChannel; gps: RewriteChannel };
  skipped: Array<{ field: string; channel: string; reason: string }>;
}

const XMP_KEYWORD = "XML:com.adobe.xmp";

function encodeItxtXmp(packet: Uint8Array): Uint8Array {
  // iTXt layout: keyword NUL, compression flag, method, langtag NUL,
  // translated keyword NUL, text.
  const keyword = new TextEncoder().encode(XMP_KEYWORD);
  const rebuilt = new Uint8Array(keyword.length + 1 + 1 + 1 + 1 + 1 + packet.length);
  rebuilt.set(keyword, 0);
  let cursor = keyword.length;
  rebuilt[cursor] = 0; cursor += 1;
  rebuilt[cursor] = 0; cursor += 1; // uncompressed
  rebuilt[cursor] = 0; cursor += 1; // method
  rebuilt[cursor] = 0; cursor += 1; // empty langtag + NUL
  rebuilt[cursor] = 0; cursor += 1; // empty translated keyword + NUL
  rebuilt.set(packet, cursor);
  return rebuilt;
}

function decodeItxtXmp(data: Uint8Array): string | null {
  try {
    let cursor = 0;
    while (cursor < data.length && data[cursor] !== 0) cursor += 1;
    if (cursor + 4 > data.length) return null;
    const compressed = data[cursor + 1];
    cursor += 4; // keyword NUL + flag + method + (langtag starts)
    while (cursor < data.length && data[cursor] !== 0) cursor += 1; // langtag
    cursor += 1;
    while (cursor < data.length && data[cursor] !== 0) cursor += 1; // translated
    cursor += 1;
    if (compressed !== 0) return null; // compressed XMP unsupported for merge
    return new TextDecoder("utf-8", { fatal: false }).decode(data.slice(cursor));
  } catch {
    return null;
  }
}

export function writePngFields(
  input: Uint8Array,
  plans: FieldWritePlan[],
  xml: XmlCodec,
  gps?: GpsEngineDirective,
): PngRewriteOutput {
  const warnings: string[] = [];
  const skipped: PngRewriteOutput["skipped"] = [];
  const { chunks, trailing } = parsePngChunks(input);
  const gpsTiff = gps ? toTiffDirective(gps) : null;
  const xmpRemovals = gps?.op === "remove" ? GPS_XMP_REMOVAL_QUERIES : [];

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
  const detail: PngRewriteOutput["detail"] = {
    exif: exifWrites.length === 0 ? "absent" : "unsupported",
    xmp: xmpProps.length === 0 ? "absent" : "unsupported",
    gps: gps ? "unsupported" : "absent",
  };

  let exifChunk: Uint8Array | null = null;
  if (exifWrites.length > 0 || gps) {
    const existing = chunks.filter((c) => c.type === "eXIf");
    if (existing.length > 1) {
      for (const field of exifFields) skipped.push({ field, channel: "EXIF", reason: "Multiple eXIf chunks present; refusing ambiguous merge." });
      if (gps) detail.gps = "unsupported";
    } else if (existing.length === 1 && existing[0]) {
      const parsed = parseTiff(existing[0].data);
      if (!parsed) {
        for (const field of exifFields) skipped.push({ field, channel: "EXIF", reason: "Existing eXIf chunk is malformed; refusing to rewrite it." });
        if (gps) detail.gps = "unsupported";
      } else {
        const merged = gpsTiff
          ? buildTiffWithGps(parsed, exifWrites, gpsTiff, parsed.little)
          : buildTiff(parsed, exifWrites, parsed.little);
        if (!merged) {
          for (const field of exifFields) skipped.push({ field, channel: "EXIF", reason: "EXIF merge failed value encoding." });
          if (gps) detail.gps = "unsupported";
        } else {
          exifChunk = encodeChunk("eXIf", merged);
          if (exifWrites.length > 0) detail.exif = "merged";
          if (gps) detail.gps = "merged";
        }
      }
    } else if (gpsTiff?.op === "remove") {
      // No eXIf chunk: no PNG EXIF GPS exists to remove; nothing is created.
      detail.gps = "absent";
    } else {
      const built = gpsTiff
        ? buildTiffWithGps(null, exifWrites, gpsTiff, true)
        : buildTiff(null, exifWrites, true);
      if (!built) {
        for (const field of exifFields) skipped.push({ field, channel: "EXIF", reason: "EXIF value encoding failed." });
        if (gps) detail.gps = "unsupported";
      } else {
        exifChunk = encodeChunk("eXIf", built);
        if (exifWrites.length > 0) detail.exif = "created";
        if (gps) detail.gps = "created";
      }
    }
  }

  let xmpChunk: Uint8Array | null = null;
  if (xmpProps.length > 0 || xmpRemovals.length > 0) {
    const existing = chunks.filter(
      (c) => c.type === "iTXt" && new TextDecoder("latin1").decode(c.data.slice(0, 17)).startsWith(XMP_KEYWORD),
    );
    if (existing.length > 1) {
      for (const field of xmpFields) skipped.push({ field, channel: "XMP", reason: "Multiple XMP iTXt chunks present; refusing ambiguous merge." });
      if (xmpRemovals.length > 0) detail.gps = "unsupported";
    } else if (existing.length === 1 && existing[0]) {
      const text = decodeItxtXmp(existing[0].data);
      if (text === null) {
        for (const field of xmpFields) skipped.push({ field, channel: "XMP", reason: "Existing XMP iTXt is compressed or malformed; refusing to rewrite it." });
        if (xmpRemovals.length > 0) detail.gps = "unsupported";
      } else {
        const merged = editXmpPacket(text, xmpProps, xmpRemovals, xml);
        if (merged === null) {
          for (const field of xmpFields) skipped.push({ field, channel: "XMP", reason: "Existing XMP is not parseable XML; refusing to rewrite it." });
          if (xmpRemovals.length > 0) detail.gps = "unsupported";
        } else {
          xmpChunk = encodeChunk("iTXt", encodeItxtXmp(new TextEncoder().encode(merged)));
          if (xmpProps.length > 0) detail.xmp = "merged";
        }
      }
    } else if (xmpRemovals.length > 0 && xmpProps.length === 0) {
      // No XMP iTXt present: no XMP coordinates exist to remove. Nothing is
      // created; the removal claim is settled by output verification.
    } else {
      xmpChunk = encodeChunk("iTXt", encodeItxtXmp(buildXmpPacket(xmpProps)));
      detail.xmp = "created";
    }
  }

  // Assembly: signature, IHDR, new metadata, then every original chunk with
  // replaced counterparts swapped (order of the rest is preserved).
  const out: Uint8Array[] = [input.slice(0, 8)];
  let inserted = false;
  for (const chunk of chunks) {
    if (!inserted && chunk.type === "IHDR") {
      out.push(encodeChunk(chunk.type, chunk.data));
      if (exifChunk) out.push(exifChunk);
      if (xmpChunk) out.push(xmpChunk);
      inserted = true;
      continue;
    }
    if (chunk.type === "eXIf" && exifChunk) continue;
    if (chunk.type === "iTXt" && xmpChunk &&
      new TextDecoder("latin1").decode(chunk.data.slice(0, 17)).startsWith(XMP_KEYWORD)) continue;
    out.push(encodeChunk(chunk.type, chunk.data));
  }
  if (trailing.length > 0) {
    out.push(trailing);
    warnings.push(`${trailing.length} trailing byte(s) after IEND preserved verbatim.`);
  }
  const total = out.reduce((sum, part) => sum + part.length, 0);
  const data = new Uint8Array(total);
  let cursor = 0;
  for (const part of out) {
    data.set(part, cursor);
    cursor += part.length;
  }
  return { data, warnings, detail, skipped };
}
