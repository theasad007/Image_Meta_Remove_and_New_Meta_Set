/**
 * Binary container sniffing (Phase 2).
 *
 * Reads magic bytes / box structure from a bounded prefix of the file —
 * never the whole file — with strict bounds checks on every read. Extension
 * and MIME remain hints; bytes decide. No allocations proportional to
 * untrusted length fields.
 */

export type SniffedKind =
  | "jpeg"
  | "png"
  | "webp"
  | "avif"
  | "avif-sequence"
  | "heic"
  | "heif-generic"
  | "heif-sequence"
  | "mp4-video"
  | "empty"
  | "unknown"
  | "unreadable";

export interface BinaryVerification {
  kind: SniffedKind;
  /** ftyp major brand for ISO-BMFF kinds (sanitized printable ASCII). */
  majorBrand?: string;
  compatibleBrands?: string[];
  /** True when a top-level `meta` box was seen inside the scan window. */
  hasMetaBox?: boolean;
  /** Ordered top-level box types seen (capped), ISO-BMFF only. */
  topLevelBoxes?: string[];
  /** True when the scan window ended before the file did. */
  windowTruncated: boolean;
  bytesExamined: number;
  declaredExtension: string;
  mismatchWithExtension: boolean;
  warnings: string[];
}

/**
 * Canonical file extension for a byte-verified container kind, so outputs
 * keep the TRUE container type even when the input name lied.
 */
export function canonicalExtensionForSniffedKind(kind: SniffedKind): string {
  switch (kind) {
    case "jpeg":
      return "jpg";
    case "png":
      return "png";
    case "webp":
      return "webp";
    case "avif":
    case "avif-sequence":
      return "avif";
    case "heic":
    case "heif-generic":
    case "heif-sequence":
      return "heic";
    case "mp4-video":
      return "mp4";
    default:
      return "bin";
  }
}

/** Bytes read from the file head for sniffing. Large enough for ftyp+meta. */
export const SNIFF_WINDOW_BYTES = 65536;
const MAX_BOXES = 24;
const MAX_SCAN_BYTES = 262144;
const MAX_COMPAT_BRANDS = 16;

function ascii4(view: DataView, offset: number): string | null {
  if (offset < 0 || offset + 4 > view.byteLength) return null;
  let out = "";
  for (let i = 0; i < 4; i += 1) {
    const code = view.getUint8(offset + i);
    if (code < 0x20 || code > 0x7e) return null;
    out += String.fromCharCode(code);
  }
  return out;
}

function expectedKindForExtension(extension: string): SniffedKind | null {
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "jpeg";
    case "png":
      return "png";
    case "webp":
      return "webp";
    case "avif":
      return "avif";
    case "heic":
    case "heif":
      return "heic";
    case "mp4":
    case "mov":
    case "webm":
      return "mp4-video";
    default:
      return null;
  }
}

function kindsCompatible(sniffed: SniffedKind, expected: SniffedKind | null): boolean {  if (expected === null) return true;
  if (sniffed === expected) return true;
  // A generic-HEIF sighting keeps HEIC/AVIF-declared files in the
  // inspect-attempt path instead of failing them on brand technicality.
  if (
    (expected === "heic" || expected === "avif") &&
    (sniffed === "heic" || sniffed === "heif-generic" || sniffed === "avif")
  ) {
    return true;
  }
  return false;
}

interface BoxWalk {
  boxes: string[];
  ftyp?: { major: string; compat: string[] };
  meta: boolean;
  stoppedEarly: boolean;
  malformed?: string;
}

function walkIsobmff(view: DataView, end: number): BoxWalk {
  const boxes: string[] = [];
  let ftyp: BoxWalk["ftyp"];
  let meta = false;
  let offset = 0;
  let malformed: string | undefined;
  for (let n = 0; n < MAX_BOXES && offset + 8 <= end; n += 1) {
    const size32 = view.getUint32(offset);
    const type = ascii4(view, offset + 4);
    if (type === null) {
      malformed = `non-ASCII box type at offset ${offset}`;
      break;
    }
    let header = 8;
    let size = size32;
    if (size32 === 1) {
      if (offset + 16 > end) {
        malformed = `truncated 64-bit largesize at offset ${offset}`;
        break;
      }
      const high = view.getUint32(offset + 8);
      const low = view.getUint32(offset + 12);
      if (high !== 0 || low < 16 || low > 0xffffffff) {
        malformed = `implausible largesize at offset ${offset}`;
        break;
      }
      size = low;
      header = 16;
    } else if (size32 === 0) {
      size = end - offset; // box extends to end of scan window
    } else if (size32 < 8) {
      malformed = `box size ${size32} below header minimum at offset ${offset}`;
      break;
    }
    boxes.push(type);
    if (type === "ftyp" && !ftyp && offset + header + 8 <= end) {
      const major = ascii4(view, offset + header);
      if (major !== null) {
        const compat: string[] = [];
        let cursor = offset + header + 8;
        for (
          let b = 0;
          b < MAX_COMPAT_BRANDS && cursor + 4 <= Math.min(offset + size, end);
          b += 1
        ) {
          const brand = ascii4(view, cursor);
          if (brand === null) break;
          compat.push(brand);
          cursor += 4;
        }
        ftyp = { major, compat };
      }
    }
    if (type === "meta") meta = true;
    if (offset + size > end) break; // box runs past window: stop, not an error
    if (size === 0) break;
    offset += size;
  }
  return { boxes, ftyp, meta, stoppedEarly: offset < end, malformed };
}

function classifyBrands(
  major: string,
  compat: string[],
): { kind: SniffedKind; note?: string } {
  const set = new Set([major, ...compat]);
  if (major === "avis" || (major === "avif" && set.has("avis"))) {
    return { kind: "avif-sequence", note: "AVIF image sequence brand (avis)." };
  }
  if (major === "msf1" || major === "heis" || major === "msix") {
    return { kind: "heif-sequence", note: "HEIF sequence brand; movie-box metadata out of scope." };
  }
  if (major === "avif" || compat.includes("avif")) return { kind: "avif" };
  if (
    major === "heic" ||
    major === "heix" ||
    major === "hevc" ||
    major === "hevx" ||
    compat.includes("heic") ||
    compat.includes("heix") ||
    compat.includes("hevc") ||
    compat.includes("hevx")
  ) {
    return { kind: "heic" };
  }
  if (major === "mif1" || major === "miaf" || compat.includes("mif1")) {
    return {
      kind: "heif-generic",
      note: `Generic HEIF brand (${major}); codec family not identifiable from brands alone.`,
    };
  }
  if (
    ["isom", "mp41", "mp42", "avc1", "iso2", "dash"].includes(major) ||
    compat.some((b) => ["isom", "mp41", "mp42", "avc1"].includes(b))
  ) {
    return { kind: "mp4-video" };
  }
  return {
    kind: "unknown",
    note: `Unrecognized ftyp major brand "${major}".`,
  };
}

/**
 * Sniff a file-head prefix. `scanWindow` should be the first ~64 KiB (or the
 * whole file when smaller); `totalSize` is the full file size so callers can
 * tell a slice edge from real truncation.
 */
export function sniffImageBytes(
  scanWindow: Uint8Array,
  totalSize: number,
  declaredExtension: string,
): BinaryVerification {
  const base = {
    bytesExamined: scanWindow.length,
    windowTruncated: scanWindow.length < totalSize,
    declaredExtension,
    mismatchWithExtension: false,
    warnings: [] as string[],
  };
  if (totalSize === 0 || scanWindow.length === 0) {
    return { ...base, kind: "empty" };
  }
  let kind: SniffedKind = "unknown";
  let majorBrand: string | undefined;
  let compatibleBrands: string[] | undefined;
  let hasMetaBox: boolean | undefined;
  let topLevelBoxes: string[] | undefined;
  const warnings: string[] = [];
  try {
    const view = new DataView(
      scanWindow.buffer,
      scanWindow.byteOffset,
      scanWindow.byteLength,
    );
    const n = scanWindow.length;
    if (n >= 3 && view.getUint8(0) === 0xff && view.getUint8(1) === 0xd8 && view.getUint8(2) === 0xff) {
      kind = "jpeg";
      // Defensive marker walk: plausible structure, bounded steps.
      let offset = 2;
      let segments = 0;
      let sawSOS = false;
      while (offset + 4 <= n && segments < 64) {
        if (view.getUint8(offset) !== 0xff) break;
        const marker = view.getUint8(offset + 1);
        segments += 1;
        if (marker === 0xd9) break; // EOI
        if (marker === 0xda) {
          sawSOS = true;
          break;
        }
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          offset += 2;
          continue;
        }
        if (offset + 4 > n) {
          warnings.push("JPEG segment header truncated at end of scan window.");
          break;
        }
        const length = view.getUint16(offset + 2);
        if (length < 2) {
          warnings.push(`JPEG segment with implausible length ${length}; structure walk stopped.`);
          break;
        }
        offset += 2 + length;
      }
      if (!sawSOS && !base.windowTruncated && offset >= n) {
        warnings.push("No JPEG start-of-scan/end-of-image seen; file may be truncated.");
      }
    } else if (
      n >= 8 &&
      view.getUint32(0) === 0x89504e47 &&
      view.getUint32(4) === 0x0d0a1a0a
    ) {
      kind = "png";
      // Defensive chunk walk with strict length sanity.
      let offset = 8;
      let chunks = 0;
      let sawIEND = false;
      while (offset + 8 <= n && chunks < 128) {
        const length = view.getUint32(offset);
        const type = ascii4(view, offset + 4);
        chunks += 1;
        if (type === null) {
          warnings.push(`PNG chunk with non-ASCII type at offset ${offset}; walk stopped.`);
          break;
        }
        if (type === "IEND") {
          sawIEND = true;
          break;
        }
        if (length > 268435456) {
          warnings.push(`PNG chunk "${type}" declares ${length} bytes — refusing to trust the length; walk stopped.`);
          break;
        }
        if (offset + 12 + length > n) break; // past window: stop quietly
        offset += 12 + length;
      }
      if (!sawIEND && !base.windowTruncated) {
        warnings.push("No PNG IEND seen within the file; file may be truncated.");
      }
    } else if (
      n >= 12 &&
      ascii4(view, 0) === "RIFF" &&
      ascii4(view, 8) === "WEBP"
    ) {
      kind = "webp";
    } else if (
      n >= 12 &&
      ascii4(view, 0) === "RIFF" &&
      ascii4(view, 8) !== null
    ) {
      kind = "unknown";
      warnings.push("RIFF container without a WEBP marker — not treated as WebP.");
    } else if (n >= 8) {
      const size32 = view.getUint32(0);
      const type = ascii4(view, 4);
      if ((size32 >= 8 || size32 === 0 || size32 === 1) && type !== null) {
        const walk = walkIsobmff(view, Math.min(n, MAX_SCAN_BYTES));
        topLevelBoxes = walk.boxes;
        hasMetaBox = walk.meta;
        if (walk.malformed) warnings.push(`ISO-BMFF structure issue: ${walk.malformed}.`);
        const ftypBox = walk.ftyp;
        if (ftypBox) {
          majorBrand = ftypBox.major;
          compatibleBrands = ftypBox.compat;
          const classified = classifyBrands(ftypBox.major, ftypBox.compat);
          kind = classified.kind;
          if (classified.note) warnings.push(classified.note);
        } else if (walk.boxes.length > 0) {
          warnings.push("No ftyp box inside the scan window; container family undetermined.");
        }
      }
    }
  } catch {
    return { ...base, kind: "unreadable" };
  }

  const expected = expectedKindForExtension(declaredExtension);
  const mismatchWithExtension = !kindsCompatible(kind, expected);
  if (mismatchWithExtension && expected !== null && kind !== "unknown" && kind !== "unreadable" && kind !== "empty") {
    warnings.push(
      `Extension ".${declaredExtension || "?"}" suggests ${expected}, but file bytes identify ${kind}. Bytes take precedence.`,
    );
  }
  return {
    ...base,
    kind,
    majorBrand,
    compatibleBrands,
    hasMetaBox,
    topLevelBoxes,
    mismatchWithExtension,
    warnings,
  };
}
