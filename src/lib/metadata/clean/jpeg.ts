import {
  CleanRefused,
  MetadataChange,
  fingerprint,
  resolvesCleaningTarget,
  type CleaningPolicy,
} from "./types";

/**
 * Lossless JPEG metadata cleaner (Phase 3).
 *
 * Walks segments SOI→SOS (entropy bytes are NEVER scanned for markers),
 * drops only positively identified metadata segments, and copies the scan
 * payload byte-for-byte. Orientation is preserved via a minimal technical
 * EXIF block when needed — display must not rotate as a side effect.
 */

const XMP_MAIN_HEADER = "http://ns.adobe.com/xap/1.0/";
const XMP_EXT_HEADER = "http://ns.adobe.com/xmp/extension/";

function asciiPrefix(bytes: Uint8Array, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length && offset + i < bytes.length; i += 1) {
    const code = bytes[offset + i];
    if (code === undefined || code > 0x7e) return out;
    if (code === 0x00) {
      out += "\n";
      continue;
    }
    out += String.fromCharCode(code);
  }
  return out;
}

export interface JpegSegments {
  /** Kept segments in order: raw bytes including marker+length. */
  prefix: Uint8Array[];
  /** Scan payload SOS..EOI inclusive, verbatim. */
  scan: Uint8Array;
  /** Bytes after EOI (preserved verbatim, warned about). */
  trailing: Uint8Array;
  app1: { header: string; payload: Uint8Array; raw: Uint8Array }[];
  app2: { header: string; raw: Uint8Array }[];
  app13: Uint8Array[];
  app11: Uint8Array[];
  appOther: { marker: number; raw: Uint8Array }[];
  com: Uint8Array[];
  exifOrientation: number | null;
  hadExif: boolean;
}

export function parseJpegSegments(input: Uint8Array): JpegSegments {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) {
    throw new CleanRefused("failed", "Not a JPEG (missing SOI marker).");
  }
  const prefix: Uint8Array[] = [];
  const app1: JpegSegments["app1"] = [];
  const app2: JpegSegments["app2"] = [];
  const app13: Uint8Array[] = [];
  const app11: Uint8Array[] = [];
  const appOther: JpegSegments["appOther"] = [];
  const com: Uint8Array[] = [];
  let offset = 2;
  let steps = 0;
  while (offset + 2 <= input.length && steps < 512) {
    steps += 1;
    if (input[offset] !== 0xff) {
      throw new CleanRefused("failed", `Expected segment marker at offset ${offset}.`);
    }
    const marker = input[offset + 1] ?? 0;
    if (marker === 0xd9) {
      throw new CleanRefused("failed", "EOI reached before start-of-scan; no image payload.");
    }
    if (marker === 0xda) {
      // SOS: scan runs to EOI with byte-stuffing respected.
      const scan = scanToEoi(input, offset);
      return {
        prefix, scan: scan.scan, trailing: scan.trailing,
        app1, app2, app13, app11, appOther, com,
        exifOrientation: readOrientation(app1),
        hadExif: app1.some((a) => a.header.startsWith("Exif")),
      };
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      prefix.push(input.slice(offset, offset + 2));
      offset += 2;
      continue;
    }
    if (offset + 4 > input.length) {
      throw new CleanRefused("failed", "Truncated JPEG segment header.");
    }
    const length = (input[offset + 2]! << 8) | input[offset + 3]!;
    if (length < 2) {
      throw new CleanRefused("failed", `Segment FF${marker.toString(16).toUpperCase()} declares implausible length ${length}.`);
    }
    if (offset + 2 + length > input.length) {
      throw new CleanRefused("failed", `Segment FF${marker.toString(16).toUpperCase()} declares ${length} bytes beyond EOF (truncated file).`);
    }
    const raw = input.slice(offset, offset + 2 + length);
    const payload = raw.slice(4);
    if (marker === 0xe1) {
      const header = asciiPrefix(payload, 0, 48);
      app1.push({ header, payload, raw });
    } else if (marker === 0xe2) {
      app2.push({ header: asciiPrefix(payload, 0, 16), raw });
    } else if (marker === 0xed) {
      app13.push(raw);
    } else if (marker === 0xeb) {
      app11.push(raw);
    } else if (marker === 0xfe) {
      com.push(raw);
    } else if (marker === 0xe0 || marker === 0xee) {
      prefix.push(raw); // APP0 (JFIF) / APP14 (Adobe): structural, always kept
    } else if (marker >= 0xe0 && marker <= 0xef) {
      appOther.push({ marker, raw });
    } else {
      prefix.push(raw); // structural: DQT/DHT/SOF/DRI/…
    }
    offset += 2 + length;
  }
  throw new CleanRefused("failed", "No start-of-scan found (not a still JPEG image?).");
}

/** Forward scan from SOS honouring 0xFF00 stuffing and restart markers. */
function scanToEoi(input: Uint8Array, sosOffset: number): { scan: Uint8Array; trailing: Uint8Array } {
  // SOS header has a length; payload follows, then entropy.
  if (sosOffset + 4 > input.length) {
    throw new CleanRefused("failed", "Truncated SOS header.");
  }
  const sosLength = ((input[sosOffset + 2] ?? 0) << 8) | (input[sosOffset + 3] ?? 0);
  if (sosLength < 2) throw new CleanRefused("failed", "SOS with implausible length.");
  let cursor = sosOffset + 2 + sosLength;
  while (cursor + 1 < input.length) {
    if (input[cursor] === 0xff) {
      const next = input[cursor + 1] ?? 0;
      if (next === 0x00) {
        cursor += 2; // stuffed byte: part of entropy
        continue;
      }
      if (next >= 0xd0 && next <= 0xd7) {
        cursor += 2; // restart marker inside scan
        continue;
      }
      if (next === 0xda) {
        // Another scan header (progressive / multi-scan JPEG): skip its
        // length-delimited header, then continue with entropy.
        if (cursor + 4 > input.length) {
          throw new CleanRefused("failed", "Truncated SOS header inside scan data.");
        }
        const innerLength = ((input[cursor + 2] ?? 0) << 8) | (input[cursor + 3] ?? 0);
        if (innerLength < 2 || cursor + 2 + innerLength > input.length) {
          throw new CleanRefused("failed", "SOS header inside scan data overruns EOF.");
        }
        cursor += 2 + innerLength;
        continue;
      }
      if (next === 0xd9) {
        return { scan: input.slice(sosOffset, cursor + 2), trailing: input.slice(cursor + 2) };
      }
      if (next === 0xd8) {
        throw new CleanRefused("failed", "SOI marker inside scan data (unsupported JPEG variant).");
      }
      if (next === 0x01 || (next >= 0xd0 && next <= 0xd7)) {
        cursor += 2; // TEM / restart markers carry no length
        continue;
      }
      // Every other marker between scans (DHT/DQT/DRI/APPn/COM/DNL/SOS…)
      // is length-delimited: skip exactly its declared bytes.
      if (next < 0xc0 || next > 0xfe) {
        throw new CleanRefused("failed", "Unexpected marker inside scan data (unsupported JPEG variant).");
      }
      if (cursor + 4 > input.length) {
        throw new CleanRefused("failed", "Truncated in-scan segment header.");
      }
      {
        const innerLength = ((input[cursor + 2] ?? 0) << 8) | (input[cursor + 3] ?? 0);
        if (innerLength < 2 || cursor + 2 + innerLength > input.length) {
          throw new CleanRefused("failed", "In-scan segment overruns EOF (truncated file).");
        }
        cursor += 2 + innerLength;
        continue;
      }
    }
    cursor += 1;
  }
  throw new CleanRefused("failed", "Scan data runs past EOF without EOI (truncated file).");
}

/** Minimal TIFF walk for IFD0 Orientation (274/SHORT). Null when absent. */
export function readOrientation(app1: { header: string; payload: Uint8Array }[]): number | null {
  const exif = app1.find((a) => a.header.startsWith("Exif"));
  if (!exif) return null;
  // Payload starts with "Exif\0\0" (6 bytes) then TIFF header.
  const tiff = exif.payload.slice(6);
  if (tiff.length < 8) return null;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  const big = tiff[0] === 0x4d && tiff[1] === 0x4d;
  if (!little && !big) return null;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const u16 = (off: number) => little ? view.getUint16(off, true) : view.getUint16(off, false);
  const u32 = (off: number) => little ? view.getUint32(off, true) : view.getUint32(off, false);
  if (u16(2) !== 42) return null;
  const ifd0 = u32(4);
  if (ifd0 + 2 > tiff.length) return null;
  const count = u16(ifd0);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd0 + 2 + i * 12;
    if (entry + 12 > tiff.length) return null;
    if (u16(entry) !== 274) continue;
    if (u16(entry + 2) !== 3) return null; // SHORT expected
    const inline = tiff.slice(entry + 8, entry + 10);
    return little ? (inline[0]! | (inline[1]! << 8)) : ((inline[0]! << 8) | inline[1]!);
  }
  return null;
}

/** Minimal technical EXIF: TIFF with ONLY the Orientation tag. */
export function buildMinimalOrientationExif(orientation: number): Uint8Array {
  const tiff = new Uint8Array(8 + 2 + 12 + 4);
  const view = new DataView(tiff.buffer);
  tiff[0] = 0x49; tiff[1] = 0x49; // "II"
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, 1, true); // one entry
  view.setUint16(10, 274, true);
  view.setUint16(12, 3, true);
  view.setUint32(14, 1, true);
  view.setUint16(18, orientation, true);
  view.setUint16(20, 0, true);
  view.setUint32(22, 0, true); // next IFD: none
  const header = new TextEncoder().encode("Exif\0\0");
  const out = new Uint8Array(header.length + tiff.length);
  out.set(header, 0);
  out.set(tiff, header.length);
  return out;
}

export interface JpegCleanOutput {
  data: Uint8Array;
  changes: MetadataChange[];
  warnings: string[];
  scanFingerprint: string;
  orientationRetained: boolean;
  coverageLimited: boolean;
}

function change(
  group: string, key: string | undefined, action: MetadataChange["action"],
  reason?: string, before?: string,
): MetadataChange {
  return { group, key, action, before, verification: "not_verified", reason };
}

export function cleanJpeg(input: Uint8Array, policy: CleaningPolicy): JpegCleanOutput {
  const seg = parseJpegSegments(input);
  const changes: MetadataChange[] = [];
  const warnings: string[] = [];
  const aggressive = policy.mode === "aggressive_when_proven_safe";
  const removeExif = resolvesCleaningTarget(policy, "exif_gps");
  const removeDescriptive = resolvesCleaningTarget(policy, "descriptive");
  let coverageLimited = false;
  const out: Uint8Array[] = [new Uint8Array([0xff, 0xd8])];

  // APP1 handling.
  let exifDropped = false;
  const orientation: number | null = seg.exifOrientation;
  for (const entry of seg.app1) {
    if (entry.header.startsWith("Exif")) {
      if (removeExif) {
        exifDropped = true;
        changes.push(change("EXIF", "APP1 Exif segment", "removed", "Camera/software/GPS/tags block dropped as one segment."));
      } else {
        out.push(entry.raw);
      }
    } else if (entry.header.startsWith(XMP_MAIN_HEADER)) {
      if (removeDescriptive) changes.push(change("XMP", "APP1 XMP packet", "removed", "Main XMP packet dropped."));
      else out.push(entry.raw);
    } else if (entry.header.startsWith(XMP_EXT_HEADER)) {
      if (removeDescriptive) changes.push(change("XMP", "APP1 extended XMP fragment", "removed", "Extended XMP fragment dropped."));
      else out.push(entry.raw);
    } else if (aggressive) {
      changes.push(change("APP1", "unknown APP1 segment", "removed", "Aggressive policy: unidentified APP1 dropped.", entry.header.slice(0, 40)));
    } else {
      out.push(entry.raw);
      warnings.push(`Unidentified APP1 segment retained (${entry.header.slice(0, 40) || "no header"}); coverage limited.`);
      changes.push(change("APP1", "unknown APP1 segment", "retained_unsupported", "Unidentified APP1 kept; not assessed."));
      coverageLimited = true;
    }
  }
  // Orientation preservation: minimal technical EXIF when needed.
  let orientationRetained = false;
  if (exifDropped && orientation !== null && orientation !== 1) {
    const minimal = buildMinimalOrientationExif(orientation);
    const segment = new Uint8Array(2 + 2 + minimal.length);
    segment[0] = 0xff; segment[1] = 0xe1;
    segment[2] = ((minimal.length + 2) >> 8) & 0xff;
    segment[3] = (minimal.length + 2) & 0xff;
    segment.set(minimal, 4);
    out.push(segment);
    orientationRetained = true;
    changes.push(change("EXIF", "Orientation", "retained_technical", `Orientation ${orientation} kept in a minimal technical EXIF block so display does not rotate.`));
  } else if (exifDropped && orientation !== null) {
    changes.push(change("EXIF", "Orientation", "removed", "Orientation was 1 (normal); no technical EXIF retained."));
  }

  // APP13 (Photoshop incl. IPTC).
  for (const raw of seg.app13) {
    if (removeDescriptive) {
      changes.push(change("IPTC", "APP13 Photoshop block", "removed", "Photoshop/IRB block (incl. IPTC datasets) dropped as one segment."));
    } else {
      out.push(raw);
    }
  }
  // COM comments.
  for (const raw of seg.com) {
    if (removeDescriptive) changes.push(change("JPEG", "COM comment", "removed", "Comment segment dropped."));
    else out.push(raw);
  }
  // APP11 / JUMBF: never strip blindly.
  for (const raw of seg.app11) {
    out.push(raw);
    coverageLimited = true;
    warnings.push("APP11 (possible JUMBF/C2PA container data) retained unassessed; ordinary cleaning does not remove signed provenance.");
    changes.push(change("JUMBF", "APP11 segment", "retained_unsupported", "Unassessed container data kept; coverage limited."));
  }
  // APP2: keep ICC + MPF-aware conservatism.
  for (const entry of seg.app2) {
    if (entry.header.startsWith("ICC_PROFILE")) {
      out.push(entry.raw);
      changes.push(change("ICC", "APP2 ICC profile", "retained_technical", "Color profile preserved for correct display."));
    } else if (entry.header.startsWith("MPF")) {
      out.push(entry.raw);
      coverageLimited = true;
      warnings.push("APP2 MPF (multi-picture) retained; editing it could invalidate image offsets.");
      changes.push(change("MPF", "APP2 MPF", "retained_unsupported", "Multi-picture structure kept; offsets untrusted."));
    } else if (aggressive) {
      changes.push(change("APP2", "other APP2 segment", "removed", "Aggressive policy: non-ICC/MPF APP2 dropped.", entry.header.slice(0, 24)));
    } else {
      out.push(entry.raw);
      warnings.push(`Unidentified APP2 retained (${entry.header.slice(0, 24) || "no header"}).`);
      changes.push(change("APP2", "other APP2 segment", "retained_unsupported", "Unidentified APP2 kept; not assessed."));
      coverageLimited = true;
    }
  }
  // Other APPn.
  for (const entry of seg.appOther) {
    if (aggressive) {
      changes.push(change("APPn", `FF${entry.marker.toString(16).toUpperCase()}`, "removed", "Aggressive policy: unidentified APPn dropped."));
    } else {
      out.push(entry.raw);
      warnings.push(`Unidentified APPn (FF${entry.marker.toString(16).toUpperCase()}) retained; coverage limited.`);
      changes.push(change("APPn", `FF${entry.marker.toString(16).toUpperCase()}`, "retained_unsupported", "Unidentified APPn kept; not assessed."));
      coverageLimited = true;
    }
  }
  // Structural prefix (APP0/JFIF/APP14/DQT/…) + scan + trailing preserved.
  changes.push(change("JPEG", "structure (SOI/APP0/APP14/scan/EOI)", "retained_technical", "Container structure and encoded pixels preserved byte-for-byte."));
  for (const kept of seg.prefix) out.push(kept);
  out.push(seg.scan);
  if (seg.trailing.length > 0) {
    out.push(seg.trailing);
    warnings.push(`${seg.trailing.length} trailing byte(s) after EOI preserved verbatim.`);
  }

  const total = out.reduce((sum, part) => sum + part.length, 0);
  const data = new Uint8Array(total);
  let cursor = 0;
  for (const part of out) {
    data.set(part, cursor);
    cursor += part.length;
  }
  return {
    data,
    changes,
    warnings,
    scanFingerprint: fingerprint(seg.scan),
    orientationRetained,
    coverageLimited,
  };
}

/** Re-parse output structurally (used by verification). */
export function validateJpegStructure(data: Uint8Array): { ok: boolean; errors: string[]; warnings: string[] } {
  try {
    parseJpegSegments(data);
    return { ok: true, errors: [], warnings: [] };
  } catch (error) {
    if (error instanceof CleanRefused) {
      return { ok: false, errors: [error.message], warnings: [] };
    }
    return { ok: false, errors: ["Unknown JPEG validation failure."], warnings: [] };
  }
}

/** Scan-payload fingerprint of finished bytes (payload-equality proof). */
export function jpegScanFingerprint(data: Uint8Array): string {
  return fingerprint(parseJpegSegments(data).scan);
}
