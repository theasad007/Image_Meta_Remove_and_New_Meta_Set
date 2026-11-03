import type { SniffedKind } from "../../format-detection/signatures";
import { parseJpegSegments } from "../clean/jpeg";
import { parsePngChunks } from "../clean/png";
import { parseWebpChunks } from "../clean/webp";
import { parseIinf, parseIloc, walkTopLevel } from "../clean/isobmff";
import type { FieldWritePlan } from "./writes";
import {
  extractGpsIfd,
  parseApp13,
  parseTiff,
  readXmpProperties,
  type XmlCodec,
} from "./codecs";
import { GPS_XMP_RETAINED_QUERIES, gpsAltitudeFromRationals, gpsRationalsToDecimal } from "./gps";

/**
 * Targeted field readers for rewrite verification (Phase 6).
 *
 * Reads back exactly the mapped standard locations (EXIF tags, XMP
 * properties, IPTC datasets) from finished bytes. Writers are never
 * trusted on their word: every claimed field is re-observed here.
 */

export interface ObservedField {
  field: string;
  /** Single-value channels (EXIF/XMP-alt/simple/IPTC singleton). */
  singles: Map<string, string>;
  /** Multi-value channels (XMP Seq/Bag, IPTC keywords). */
  multis: Map<string, string[]>;
}

function decodeAscii(value: Uint8Array): string {
  let end = value.length;
  const nul = value.indexOf(0);
  if (nul >= 0) end = nul;
  return new TextDecoder("utf-8", { fatal: false }).decode(value.slice(0, end));
}

function tiffSingles(tiff: Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  const parsed = parseTiff(tiff);
  if (!parsed) return out;
  for (const entry of parsed.entries) {
    if (entry.type === 2) out.set(`EXIF:${entry.tag}`, decodeAscii(entry.value));
    else if (entry.type === 3 && entry.value.length === 2) {
      const v = parsed.little
        ? (entry.value[0] ?? 0) | ((entry.value[1] ?? 0) << 8)
        : ((entry.value[0] ?? 0) << 8) | (entry.value[1] ?? 0);
      out.set(`EXIF:${entry.tag}`, String(v));
    }
  }
  return out;
}

function jpegExifTiff(input: Uint8Array): Uint8Array | null {
  try {
    const segments = parseJpegSegments(input);
    const exif = segments.app1.find((entry) => entry.header.startsWith("Exif"));
    if (!exif || exif.payload.length < 6) return null;
    return exif.payload.slice(6);
  } catch {
    return null;
  }
}

function jpegXmpText(input: Uint8Array): string | null {
  try {
    const segments = parseJpegSegments(input);
    const xmp = segments.app1.find((entry) =>
      entry.header.startsWith("http://ns.adobe.com/xap/1.0/"),
    );
    if (!xmp) return null;
    return new TextDecoder("utf-8", { fatal: false }).decode(xmp.payload.slice(29));
  } catch {
    return null;
  }
}

function jpegIptc(input: Uint8Array): Map<string, string[]> {
  const out = new Map<string, string[]>();
  try {
    for (const raw of parseJpegSegments(input).app13) {
      for (const dataset of parseApp13(raw.slice(4)).iptc) {
        const key = `IPTC:${dataset.record}:${dataset.dataset}`;
        const list = out.get(key) ?? [];
        list.push(new TextDecoder("utf-8", { fatal: false }).decode(dataset.data));
        out.set(key, list);
      }
    }
  } catch {
    // Partial reads stay partial; missing keys simply verify as absent.
  }
  return out;
}

function pngExifTiff(input: Uint8Array): Uint8Array | null {
  try {
    const exif = parsePngChunks(input).chunks.find((c) => c.type === "eXIf");
    return exif ? exif.data : null;
  } catch {
    return null;
  }
}

function pngXmpText(input: Uint8Array): string | null {
  try {
    const chunks = parsePngChunks(input).chunks;
    const itxt = chunks.find(
      (c) => c.type === "iTXt" && new TextDecoder("latin1").decode(c.data.slice(0, 17)).startsWith("XML:com.adobe.xmp"),
    );
    if (!itxt) return null;
    // Reuse the writer-side layout knowledge: keyword NUL, flag, method,
    // langtag NUL, translated NUL, text.
    let cursor = 0;
    while (cursor < itxt.data.length && itxt.data[cursor] !== 0) cursor += 1;
    cursor += 1;
    if ((itxt.data[cursor] ?? 1) !== 0) return null; // compressed: unreadable here
    cursor += 2;
    while (cursor < itxt.data.length && itxt.data[cursor] !== 0) cursor += 1;
    cursor += 1;
    while (cursor < itxt.data.length && itxt.data[cursor] !== 0) cursor += 1;
    cursor += 1;
    return new TextDecoder("utf-8", { fatal: false }).decode(itxt.data.slice(cursor));
  } catch {
    return null;
  }
}

function webpExifTiff(input: Uint8Array): Uint8Array | null {
  try {
    const exif = parseWebpChunks(input).chunks.find((c) => c.id === "EXIF");
    return exif ? exif.data : null;
  } catch {
    return null;
  }
}

function webpXmpText(input: Uint8Array): string | null {
  try {
    const xmp = parseWebpChunks(input).chunks.find((c) => c.id === "XMP ");
    if (!xmp) return null;
    return new TextDecoder("utf-8", { fatal: false }).decode(xmp.data);
  } catch {
    return null;
  }
}

function isobmffItems(input: Uint8Array): { exif: Uint8Array | null; xmp: string | null } {
  const result = { exif: null as Uint8Array | null, xmp: null as string | null };
  try {
    const { boxes } = walkTopLevel(input);
    const meta = boxes.find((box) => box.type === "meta");
    if (!meta) return result;
    const children = metaChildren(meta.payload);
    const ilocRaw = children.find((c) => c.type === "iloc");
    const iinfRaw = children.find((c) => c.type === "iinf");
    if (!ilocRaw || !iinfRaw) return result;
    const iloc = parseIloc(ilocRaw.data);
    const infe = parseIinf(iinfRaw.data);
    const byId = new Map(infe.map((entry) => [entry.itemId, entry]));
    for (const item of iloc.items) {
      const entry = byId.get(item.itemId);
      if (!entry) continue;
      const isExif = entry.itemType === "Exif";
      const isXmp = entry.itemType === "mime";
      if (!isExif && !isXmp) continue;
      const parts: Uint8Array[] = [];
      for (const extent of item.extents) {
        if (extent.offset < 0 || extent.length <= 0 || extent.offset + extent.length > input.length) return result;
        parts.push(input.subarray(extent.offset, extent.offset + extent.length));
      }
      const total = parts.reduce((sum, part) => sum + part.length, 0);
      const joined = new Uint8Array(total);
      let cursor = 0;
      for (const part of parts) {
        joined.set(part, cursor);
        cursor += part.length;
      }
      if (isExif) {
        // Real HEIF-family files carry an optional 4-byte TIFF-offset field
        // before "Exif\0\0" (offset = header size); locate the header so
        // both headerless (offset 0) and offset-prefixed layouts read.
        const headerAt = isobmffExifHeaderAt(joined);
        if (headerAt >= 0) result.exif = joined.slice(headerAt + 6);
      } else if (isXmp) {
        result.xmp = new TextDecoder("utf-8", { fatal: false }).decode(joined);
      }
    }
  } catch {
    // Unreadable items verify as absent downstream.
  }
  return result;
}

/** Same tolerant "Exif\0\0" location as the writer (shared shapes). */
function isobmffExifHeaderAt(payload: Uint8Array): number {
  for (let at = 0; at <= Math.min(8, Math.max(0, payload.length - 6)); at += 1) {
    if (
      payload[at] === 0x45 && payload[at + 1] === 0x78 &&
      payload[at + 2] === 0x69 && payload[at + 3] === 0x66 &&
      payload[at + 4] === 0x00 && payload[at + 5] === 0x00
    ) {
      return at;
    }
  }
  return -1;
}

function metaChildren(metaPayload: Uint8Array): Array<{ type: string; data: Uint8Array }> {
  // meta is a FullBox: version/flags first, then child boxes.
  const inner = metaPayload.length >= 4 ? metaPayload.slice(4) : metaPayload;
  const out: Array<{ type: string; data: Uint8Array }> = [];
  let offset = 0;
  const view = new DataView(inner.buffer, inner.byteOffset, inner.byteLength);
  for (let n = 0; n < 64 && offset + 8 <= inner.length; n += 1) {
    const size = view.getUint32(offset);
    const type = String.fromCharCode(
      inner[offset + 4] ?? 0, inner[offset + 5] ?? 0, inner[offset + 6] ?? 0, inner[offset + 7] ?? 0,
    );
    if (size < 8 || offset + size > inner.length) break;
    out.push({ type, data: inner.slice(offset + 8, offset + size) });
    offset += size;
  }
  return out;
}

export interface XmpQuery {
  ns: string;
  prop: string;
}

function xmpQueriesFor(plan: FieldWritePlan): XmpQuery[] {
  return plan.xmp.map((prop) => ({ ns: prop.ns, prop: prop.prop }));
}

/**
 * Observe the mapped locations for the requested plans in finished bytes.
 * Returns per-field single values (EXIF tags, XMP alt/simple, IPTC
 * singletons) and multi values (XMP Seq/Bag, IPTC keywords).
 */
export function observeFieldValues(
  input: Uint8Array,
  kind: SniffedKind,
  plans: FieldWritePlan[],
  xml: XmlCodec,
): Map<string, { singles: Map<string, string>; multis: Map<string, string[]> }> {
  let exifTiff: Uint8Array | null = null;
  let xmpText: string | null = null;
  let iptc = new Map<string, string[]>();
  if (kind === "jpeg") {
    exifTiff = jpegExifTiff(input);
    xmpText = jpegXmpText(input);
    iptc = jpegIptc(input);
  } else if (kind === "png") {
    exifTiff = pngExifTiff(input);
    xmpText = pngXmpText(input);
  } else if (kind === "webp") {
    exifTiff = webpExifTiff(input);
    xmpText = webpXmpText(input);
  } else if (kind === "avif" || kind === "heic" || kind === "heif-generic") {
    const items = isobmffItems(input);
    exifTiff = items.exif;
    xmpText = items.xmp;
  }

  const singles = exifTiff ? tiffSingles(exifTiff) : new Map<string, string>();
  const xmpRead = xmpText
    ? readXmpProperties(
        xmpText,
        plans.flatMap((inner) => xmpQueriesFor(inner)),
        xml,
      )
    : new Map<string, string[]>();

  const out = new Map<string, { singles: Map<string, string>; multis: Map<string, string[]> }>();
  for (const plan of plans) {
    const fieldSingles = new Map<string, string>();
    const fieldMultis = new Map<string, string[]>();
    for (const write of plan.exif) {
      const value = singles.get(`EXIF:${write.tag}`);
      if (value !== undefined) fieldSingles.set(`EXIF:${write.tag}`, value);
    }
    for (const prop of plan.xmp) {
      const values = xmpRead.get(`${prop.ns}#${prop.prop}`);
      if (values !== undefined) {
        if (prop.kind === "alt" || prop.kind === "simple" || prop.kind === "contactUrl") {
          fieldSingles.set(`XMP:${prop.prop}`, values[0] ?? "");
        } else {
          fieldMultis.set(`XMP:${prop.prop}`, values);
        }
      }
    }
    for (const dataset of plan.iptc) {
      const values = iptc.get(`IPTC:${dataset.record}:${dataset.dataset}`);
      if (values !== undefined) {
        if (dataset.dataset === 25) fieldMultis.set(`IPTC:2:25`, values);
        else fieldSingles.set(`IPTC:${dataset.record}:${dataset.dataset}`, values[0] ?? "");
      }
    }
    out.set(plan.field, { singles: fieldSingles, multis: fieldMultis });
  }
  return out;
}

// -------------------------------------------------------------- GPS (Screen 09)

export interface ObservedGps {
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  latRef: "N" | "S" | null;
  lonRef: "E" | "W" | null;
  /** GPS tags exist but could not be decoded (fail-closed evidence). */
  unreadable: boolean;
  /** Coordinate-bearing XMP paths still present, e.g. "XMP exif:GPSLatitude". */
  xmpCoordinates: string[];
}

function rationalTriplesFor(value: Uint8Array, little: boolean): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (value.length % 8 !== 0) return out;
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
  for (let i = 0; i < value.length; i += 8) {
    out.push([view.getUint32(i, little), view.getUint32(i + 4, little)]);
  }
  return out;
}

function asciiRef(value: Uint8Array): string | null {
  const code = value[0];
  if (code === undefined) return null;
  return String.fromCharCode(code);
}

function byteValue(value: Uint8Array): number | null {
  const code = value[0];
  return code === undefined ? null : code;
}

/**
 * Read GPS coordinates back from finished bytes (Screen 09 verification):
 * EXIF GPS IFD (primary) plus a scan for coordinate-bearing XMP properties
 * whose retention must be disclosed. Nothing is trusted from the writer —
 * this is the same standard-location discipline as `observeFieldValues`.
 */
export function observeGps(input: Uint8Array, kind: SniffedKind, xml: XmlCodec): ObservedGps {
  let exifTiff: Uint8Array | null = null;
  let xmpText: string | null = null;
  if (kind === "jpeg") {
    exifTiff = jpegExifTiff(input);
    xmpText = jpegXmpText(input);
  } else if (kind === "png") {
    exifTiff = pngExifTiff(input);
    xmpText = pngXmpText(input);
  } else if (kind === "webp") {
    exifTiff = webpExifTiff(input);
    xmpText = webpXmpText(input);
  } else if (kind === "avif" || kind === "heic" || kind === "heif-generic") {
    const items = isobmffItems(input);
    exifTiff = items.exif;
    xmpText = items.xmp;
  }

  const empty: ObservedGps = { latitude: null, longitude: null, altitude: null, latRef: null, lonRef: null, unreadable: false, xmpCoordinates: [] };

  if (exifTiff) {
    const parsed = parseTiff(exifTiff);
    if (parsed) {
      const gpsIfd = extractGpsIfd(parsed);
      if (gpsIfd) {
        const decodeRationals = (tag: number) => {
          const entry = gpsIfd.entries.find((e) => e.tag === tag && e.type === 5);
          return entry ? rationalTriplesFor(entry.value, parsed.little) : null;
        };
        const latRationals = decodeRationals(2);
        const lonRationals = decodeRationals(4);
        const latRefEntry = gpsIfd.entries.find((e) => e.tag === 1);
        const lonRefEntry = gpsIfd.entries.find((e) => e.tag === 3);
        // Spec refs are ASCII ("S\0", type 2); BYTE (type 1) is the lenient
        // variant some writers emit — both decode to the same letter here.
        const latRef = latRefEntry && (latRefEntry.type === 1 || latRefEntry.type === 2) ? (asciiRef(latRefEntry.value) as ObservedGps["latRef"] ?? null) : null;
        const lonRef = lonRefEntry && (lonRefEntry.type === 1 || lonRefEntry.type === 2) ? (asciiRef(lonRefEntry.value) as ObservedGps["lonRef"] ?? null) : null;
        let readable = true;
        let latitude: number | null = null;
        let longitude: number | null = null;
        let altitude: number | null = null;
        if (latRationals && latRationals.length === 3) {
          const value = gpsRationalsToDecimal(latRationals, latRef === "S" ? "S" : "N");
          if (value !== null) latitude = value;
          else readable = false;
        } else {
          readable = false; // a GPS IFD without a decodable latitude is corrupt
        }
        if (lonRationals && lonRationals.length === 3) {
          const value = gpsRationalsToDecimal(lonRationals, lonRef === "W" ? "W" : "E");
          if (value !== null) longitude = value;
          else readable = false;
        } else {
          readable = false;
        }
        const altEntry = gpsIfd.entries.find((e) => e.tag === 6 && e.type === 5);
        const altRefEntry = gpsIfd.entries.find((e) => e.tag === 5 && e.type === 1);
        if (altEntry) {
          const pair = rationalTriplesFor(altEntry.value, parsed.little)[0] ?? null;
          const ref = altRefEntry ? byteValue(altRefEntry.value) : null;
          if (pair && (ref === 0 || ref === 1)) {
            altitude = gpsAltitudeFromRationals(pair, ref === 1 ? 1 : 0);
          }
        }
        return { latitude, longitude, altitude, latRef, lonRef, unreadable: !readable, xmpCoordinates: xmpText ? scanXmpCoordinates(xmpText, xml) : [] };
      }
      // EXIF exists but carries no GPS IFD: honestly absent (never "unreadable").
      return { ...empty, xmpCoordinates: xmpText ? scanXmpCoordinates(xmpText, xml) : [] };
    }
    return { ...empty, unreadable: true, xmpCoordinates: xmpText ? scanXmpCoordinates(xmpText, xml) : [] };
  }
  return { ...empty, xmpCoordinates: xmpText ? scanXmpCoordinates(xmpText, xml) : [] };
}

function scanXmpCoordinates(packet: string, xml: XmlCodec): string[] {
  const values = readXmpProperties(
    packet,
    GPS_XMP_RETAINED_QUERIES.map((query) => ({ ns: query.ns, prop: query.prop })),
    xml,
  );
  const hits: string[] = [];
  for (const [key, list] of values) {
    if (list.length === 0) continue;
    const prop = key.split("#")[1] ?? key;
    hits.push(`XMP ${prop}`);
  }
  return hits;
}
