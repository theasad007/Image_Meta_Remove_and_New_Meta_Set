import {
  CleanRefused,
  MetadataChange,
  fingerprint,
  resolvesC2paRemovalTarget,
  resolvesCleaningTarget,
  type CleaningPolicy,
} from "./types";
import { describeIsobmffUuid, locateIsobmffC2pa } from "./c2pa-locate";

/**
 * Native AVIF/HEIC (ISOBMFF) metadata cleaner (Phase 3).
 *
 * Removes Exif/XMP metadata *items* and rebuilds `meta` (fresh
 * `iinf`/`iloc`, pruned `iref`/`ipma`) plus a fresh `mdat`, recomputing every
 * offset from the new layout. Encoded image payloads are relocated
 * verbatim. Anything structural beyond proven still-image layouts —
 * sequences, grids/overlays/aux references, idat-backed items, 64-bit
 * iloc fields, untyped v0/v1 entries, extra mdats — refuses with an
 * explicit unsupported/failed outcome instead of risking corruption.
 */

const STILL_MAJORS = new Set(["avif", "heic", "heix", "hevc", "hevx"]);
const SEQUENCE_MAJORS = new Set(["avis", "msf1", "heis", "msix"]);
const VIDEO_MAJORS = new Set(["isom", "mp41", "mp42", "avc1", "iso2", "dash"]);
const COLLECTION_ITEM_TYPES = new Set(["grid", "iovl", "strk"]);
const COLLECTION_REF_TYPES = new Set(["thmb", "auxl", "dimg"]);
const MIME_XMP = "application/rdf+xml";

class Cursor {
  private view: DataView;
  offset: number;
  readonly end: number;
  constructor(data: Uint8Array, offset: number, end: number) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.offset = offset;
    this.end = end;
  }
  remaining(): number {
    return this.end - this.offset;
  }
  u8(): number {
    if (this.offset + 1 > this.end) throw new CleanRefused("failed", "ISOBMFF box overruns its bounds.");
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }
  u16(): number {
    if (this.offset + 2 > this.end) throw new CleanRefused("failed", "ISOBMFF box overruns its bounds.");
    const value = this.view.getUint16(this.offset);
    this.offset += 2;
    return value;
  }
  u32(): number {
    if (this.offset + 4 > this.end) throw new CleanRefused("failed", "ISOBMFF box overruns its bounds.");
    const value = this.view.getUint32(this.offset);
    this.offset += 4;
    return value;
  }
  bytes(length: number): Uint8Array {
    if (length < 0 || this.offset + length > this.end) {
      throw new CleanRefused("failed", "ISOBMFF field length exceeds box bounds.");
    }
    const out = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, length);
    this.offset += length;
    return out;
  }
  nulString(maxLen = 256): string {
    const bytes: number[] = [];
    while (bytes.length < maxLen) {
      const byte = this.u8();
      if (byte === 0) break;
      if (byte < 0x20 || byte > 0x7e) {
        throw new CleanRefused("failed", "ISOBMFF string contains non-printable bytes.");
      }
      bytes.push(byte);
    }
    return String.fromCharCode(...bytes);
  }
}

export interface RawBox {
  type: string;
  start: number;
  size: number;
  headerLength: number;
  payload: Uint8Array;
}

function ascii4(data: Uint8Array, offset: number): string | null {
  if (offset + 4 > data.length) return null;
  let out = "";
  for (let i = 0; i < 4; i += 1) {
    const code = data[offset + i] ?? 0;
    if (code < 0x20 || code > 0x7e) return null;
    out += String.fromCharCode(code);
  }
  return out;
}

export function walkTopLevel(data: Uint8Array, maxBoxes = 32): { boxes: RawBox[]; trailing: Uint8Array } {
  const boxes: RawBox[] = [];
  let offset = 0;
  for (let n = 0; n < maxBoxes && offset + 8 <= data.length; n += 1) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const size32 = view.getUint32(offset);
    const type = ascii4(data, offset + 4);
    if (type === null || (size32 !== 0 && size32 < 8)) {
      // Not a box header: remaining bytes are trailing garbage, preserved
      // verbatim by the caller with a warning (never trusted as boxes).
      // A *declared* size that overruns EOF stays a hard failure below.
      return { boxes, trailing: data.slice(offset) };
    }
    let headerLength = 8;
    let size = size32;
    if (size32 === 1) {
      if (offset + 16 > data.length) throw new CleanRefused("failed", `Truncated 64-bit largesize at offset ${offset}.`);
      const high = view.getUint32(offset + 8);
      const low = view.getUint32(offset + 12);
      if (high !== 0 || low < 16) throw new CleanRefused("failed", `Implausible largesize at offset ${offset}.`);
      size = low;
      headerLength = 16;
    } else if (size32 === 0) {
      size = data.length - offset;
    }
    if (offset + size > data.length) {
      throw new CleanRefused("failed", `Top-level box "${type}" overruns EOF (truncated file).`);
    }
    boxes.push({ type, start: offset, size, headerLength, payload: data.subarray(offset + headerLength, offset + size) });
    offset += size;
    if (size === 0) break;
  }
  return { boxes, trailing: data.slice(offset) };
}

function childBoxes(metaPayload: Uint8Array, skipVersionFlags = true): RawBox[] {
  // `start` is relative to the full payload so slices stay aligned.
  const header = skipVersionFlags ? 4 : 0;
  if (metaPayload.length < header) throw new CleanRefused("failed", "Container box too short.");
  const inner = metaPayload.subarray(header);
  const boxes: RawBox[] = [];
  let offset = 0;
  for (let n = 0; n < 32 && offset + 8 <= inner.length; n += 1) {
    const size = new DataView(inner.buffer, inner.byteOffset, inner.byteLength).getUint32(offset);
    const type = ascii4(inner, offset + 4);
    if (type === null || size < 8 || offset + size > inner.length) {
      throw new CleanRefused("failed", "Malformed child box inside meta.");
    }
    boxes.push({ type, start: offset + 4, size, headerLength: 8, payload: inner.subarray(offset + 8, offset + size) });
    offset += size;
  }
  return boxes;
}

function fullVersion(payload: Uint8Array): number {
  if (payload.length < 4) throw new CleanRefused("failed", "FullBox too short.");
  return payload[0] ?? 0;
}

interface IlocItem {
  itemId: number;
  constructionMethod: number;
  extents: { offset: number; length: number }[];
}

interface ParsedIloc {
  items: IlocItem[];
}

function readSized(cursor: Cursor, size: number): number {
  if (size === 0) return 0;
  if (size === 4) return cursor.u32();
  if (size === 8) {
    const high = cursor.u32();
    const low = cursor.u32();
    if (high !== 0) throw new CleanRefused("unsupported", "64-bit ISOBMFF offset/length fields are not supported (matches reader limits).");
    return low;
  }
  throw new CleanRefused("unsupported", `ISOBMFF field width ${size} bytes is not supported.`);
}

function parseIloc(payload: Uint8Array): ParsedIloc {
  const version = fullVersion(payload);
  if (version > 2) throw new CleanRefused("unsupported", `iloc version ${version} is not supported.`);
  const cursor = new Cursor(payload, 4, payload.length);
  const sizes = cursor.u8();
  const offsetSize = sizes >> 4;
  const lengthSize = sizes & 0x0f;
  const base = cursor.u8();
  const baseOffsetSize = base >> 4;
  const indexSize = base & 0x0f;
  for (const [name, size] of [["offset", offsetSize], ["length", lengthSize], ["base-offset", baseOffsetSize], ["index", indexSize]] as const) {
    if (size !== 0 && size !== 4 && !(name === "index" && size === 8)) {
      if (size === 8) throw new CleanRefused("unsupported", "64-bit ISOBMFF offset/length fields are not supported (matches reader limits).");
      throw new CleanRefused("unsupported", `iloc ${name} field width ${size} is not supported.`);
    }
  }
  if (indexSize !== 0) throw new CleanRefused("unsupported", "iloc extent indexes are not supported.");
  const itemCount = version === 2 ? cursor.u32() : cursor.u16();
  if (itemCount > 256) throw new CleanRefused("failed", `iloc item count ${itemCount} exceeds sanity budget.`);
  const items: IlocItem[] = [];
  for (let i = 0; i < itemCount; i += 1) {
    const itemId = version === 2 ? cursor.u32() : cursor.u16();
    let constructionMethod = 0;
    if (version >= 1) constructionMethod = cursor.u16();
    cursor.u16(); // data_reference_index (must be 0 for our files; tolerated otherwise)
    const baseOffset = readSized(cursor, baseOffsetSize);
    const extentCount = version === 2 ? cursor.u32() : cursor.u16();
    if (extentCount > 64) throw new CleanRefused("failed", `iloc extent count ${extentCount} exceeds sanity budget.`);
    const extents: IlocItem["extents"] = [];
    for (let e = 0; e < extentCount; e += 1) {
      const extentOffset = readSized(cursor, offsetSize);
      const extentLength = readSized(cursor, lengthSize);
      if (extentLength === 0 || extentLength > 256 * 1024 * 1024) {
        throw new CleanRefused("failed", `iloc extent length ${extentLength} implausible.`);
      }
      extents.push({ offset: baseOffset + extentOffset, length: extentLength });
    }
    items.push({ itemId, constructionMethod, extents });
  }
  return { items };
}

export interface InfeEntry {
  itemId: number;
  itemType: string | null; // null for v0/v1 (unidentifiable)
  itemName: string;
  contentType: string;
  version: number;
}

function parseIinf(payload: Uint8Array): InfeEntry[] {
  const version = fullVersion(payload);
  const cursor = new Cursor(payload, 4, payload.length);
  const entryCount = version === 0 ? cursor.u16() : cursor.u32();
  if (entryCount > 256) throw new CleanRefused("failed", `iinf entry count ${entryCount} exceeds sanity budget.`);
  const entries: InfeEntry[] = [];
  for (let i = 0; i < entryCount; i += 1) {
    if (cursor.remaining() < 8) throw new CleanRefused("failed", "Truncated infe entry.");
    const size = cursor.u32();
    const typeBytes = cursor.bytes(4);
    const type = String.fromCharCode(typeBytes[0] ?? 0, typeBytes[1] ?? 0, typeBytes[2] ?? 0, typeBytes[3] ?? 0);
    if (type !== "infe") throw new CleanRefused("failed", "Expected infe inside iinf.");
    if (size < 8 || size > cursor.remaining() + 8) throw new CleanRefused("failed", "infe size out of bounds.");
    const body = cursor.bytes(size - 8);
    const entry = parseInfeBody(body);
    entries.push(entry);
  }
  return entries;
}

function parseInfeBody(body: Uint8Array): InfeEntry {
  if (body.length < 4) throw new CleanRefused("failed", "infe too short.");
  const version = body[0] ?? 0;
  const cursor = new Cursor(body, 4, body.length);
  if (version === 0 || version === 1) {
    const itemId = cursor.u16();
    cursor.u16(); // protection index
    const itemName = cursor.nulString();
    return { itemId, itemType: null, itemName, contentType: "", version };
  }
  if (version !== 2 && version !== 3) {
    throw new CleanRefused("unsupported", `infe version ${version} is not supported.`);
  }
  const itemId = version === 2 ? cursor.u16() : cursor.u32();
  cursor.u16(); // protection index
  const typeBytes = cursor.bytes(4);
  const itemType = String.fromCharCode(typeBytes[0] ?? 0, typeBytes[1] ?? 0, typeBytes[2] ?? 0, typeBytes[3] ?? 0);
  const itemName = cursor.nulString();
  let contentType = "";
  if (itemType === "mime") {
    contentType = cursor.nulString();
    // content_encoding follows; ignored (position-independent from here).
  }
  return { itemId, itemType, itemName, contentType, version };
}

interface IrefEntry {
  fromId: number;
  refType: string;
  toIds: number[];
}

function parseIref(payload: Uint8Array): IrefEntry[] {
  const version = fullVersion(payload);
  if (version > 1) throw new CleanRefused("unsupported", `iref version ${version} is not supported.`);
  const cursor = new Cursor(payload, 4, payload.length);
  const entries: IrefEntry[] = [];
  let steps = 0;
  while (cursor.remaining() >= 8 && steps < 64) {
    steps += 1;
    const size = cursor.u32();
    const typeBytes = cursor.bytes(4);
    const refType = String.fromCharCode(typeBytes[0] ?? 0, typeBytes[1] ?? 0, typeBytes[2] ?? 0, typeBytes[3] ?? 0);
    if (!/^[A-Za-z0-9]{4}$/.test(refType)) throw new CleanRefused("failed", "iref entry with invalid reference type.");
    if (size < 8 || size - 8 > cursor.remaining()) throw new CleanRefused("failed", "iref entry size out of bounds.");
    const body = cursor.bytes(size - 8);
    const inner = new Cursor(body, 0, body.length);
    const fromId = version === 0 ? inner.u16() : inner.u32();
    const toCount = version === 0 ? inner.u16() : inner.u32();
    if (toCount > 256) throw new CleanRefused("failed", "iref fan-out exceeds sanity budget.");
    const toIds: number[] = [];
    for (let i = 0; i < toCount; i += 1) toIds.push(version === 0 ? inner.u16() : inner.u32());
    entries.push({ fromId, refType, toIds });
  }
  return entries;
}

interface IpmaEntry {
  itemId: number;
  associations: number[];
}

function parseIpma(payload: Uint8Array): { version: number; flags: number; entries: IpmaEntry[] } {
  if (payload.length < 4) throw new CleanRefused("failed", "ipma too short.");
  const version = payload[0] ?? 0;
  const flags = ((payload[1] ?? 0) << 16) | ((payload[2] ?? 0) << 8) | (payload[3] ?? 0);
  if (version > 1) throw new CleanRefused("unsupported", `ipma version ${version} is not supported.`);
  const idSize = flags & 1 ? 4 : 2;
  const assocSize = flags & 2 ? 2 : 1;
  const cursor = new Cursor(payload, 4, payload.length);
  const entryCount = cursor.u32();
  if (entryCount > 256) throw new CleanRefused("failed", "ipma entry count exceeds sanity budget.");
  const entries: IpmaEntry[] = [];
  for (let i = 0; i < entryCount; i += 1) {
    const itemId = idSize === 2 ? cursor.u16() : cursor.u32();
    const assocCount = cursor.u8();
    if (assocCount > 64) throw new CleanRefused("failed", "ipma association fan-out exceeds sanity budget.");
    const associations: number[] = [];
    for (let a = 0; a < assocCount; a += 1) {
      associations.push(assocSize === 1 ? cursor.u8() : cursor.u16());
    }
    entries.push({ itemId, associations });
  }
  return { version, flags, entries };
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

function sizedBox(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  new DataView(out.buffer).setUint32(0, out.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  return out;
}

function fullBox(type: string, version: number, flags: number, payload: Uint8Array): Uint8Array {
  const head = new Uint8Array(4 + payload.length);
  head[0] = version;
  head[1] = (flags >> 16) & 0xff;
  head[2] = (flags >> 8) & 0xff;
  head[3] = flags & 0xff;
  head.set(payload, 4);
  return sizedBox(type, head);
}

function encodeInfe(entry: InfeEntry): Uint8Array {
  const name = new TextEncoder().encode(entry.itemName);
  const itemType = entry.itemType ?? "????";
  const contentType = new TextEncoder().encode(entry.contentType);
  // v2 layout (matches our proven fixtures and real encoders).
  const body = concatBytes([
    new Uint8Array([2, 0, 0, 0]),
    new Uint8Array([(entry.itemId >> 8) & 0xff, entry.itemId & 0xff, 0, 0]),
    new TextEncoder().encode(itemType),
    name, new Uint8Array([0]), contentType, new Uint8Array([0, 0]),
  ]);
  return sizedBox("infe", body);
}

function encodeIinf(entries: InfeEntry[]): Uint8Array {
  const parts = [
    new Uint8Array([0, 0, 0, 0, 0, entries.length]),
    ...entries.map(encodeInfe),
  ];
  // version/flags(4) + entry_count u16 (v0 container keeps v2 entries, as writers do).
  return sizedBox("iinf", concatBytes(parts));
}

function encodeIloc(items: { itemId: number; offset: number; length: number }[]): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array([0, 0, 0, 0, 0x44, 0x40, 0, items.length])];
  for (const item of items) {
    if (item.itemId > 0xffff || item.offset > 0xffffffff || item.length > 0xffffffff) {
      throw new CleanRefused("failed", "Rebuilt iloc values exceed 32-bit budget.");
    }
    const entry = new Uint8Array(2 + 2 + 4 + 2 + 8);
    const view = new DataView(entry.buffer);
    view.setUint16(0, item.itemId);
    view.setUint16(2, 0); // data_reference_index
    view.setUint32(4, 0); // base_offset
    view.setUint16(8, 1); // extent_count
    view.setUint32(10, item.offset);
    view.setUint32(14, item.length);
    parts.push(entry);
  }
  return sizedBox("iloc", concatBytes(parts));
}

function encodeIref(entries: IrefEntry[]): Uint8Array | null {
  if (entries.length === 0) return null;
  for (const entry of entries) {
    if (entry.fromId > 0xffff || entry.toIds.some((id) => id > 0xffff)) {
      throw new CleanRefused("failed", "Item ids exceed 16-bit budget for iref rebuild.");
    }
  }
  const parts: Uint8Array[] = [new Uint8Array([0, 0, 0, 0])];
  for (const entry of entries) {
    const body = new Uint8Array(2 + 2 + entry.toIds.length * 2);
    const view = new DataView(body.buffer);
    view.setUint16(0, entry.fromId);
    view.setUint16(2, entry.toIds.length);
    entry.toIds.forEach((id, i) => view.setUint16(4 + i * 2, id));
    parts.push(sizedBox(entry.refType, body));
  }
  return sizedBox("iref", concatBytes(parts));
}

export interface IsobmffCleanOutput {
  data: Uint8Array;
  changes: MetadataChange[];
  warnings: string[];
  imagePayloadFingerprint: string;
  coverageLimited: boolean;
}

export function cleanIsobmff(
  input: Uint8Array,
  kind: "avif" | "heic",
  policy: CleaningPolicy,
): IsobmffCleanOutput {
  const changes: MetadataChange[] = [];
  const warnings: string[] = [];
  let coverageLimited = false;

  const { boxes: topLevel, trailing: inputTrailing } = walkTopLevel(input);
  const ftyp = topLevel.find((box) => box.type === "ftyp");
  if (!ftyp || ftyp.payload.length < 8) throw new CleanRefused("failed", "Missing ftyp box.");
  const major = String.fromCharCode(ftyp.payload[0] ?? 0, ftyp.payload[1] ?? 0, ftyp.payload[2] ?? 0, ftyp.payload[3] ?? 0);
  if (SEQUENCE_MAJORS.has(major)) {
    throw new CleanRefused("unsupported", `Image-sequence brand "${major}" — sequences are out of scope; refusing rather than corrupting.`);
  }
  if (VIDEO_MAJORS.has(major)) {
    throw new CleanRefused("unsupported", `Video-family brand "${major}" — not an image clean target.`);
  }
  if (!STILL_MAJORS.has(major)) {
    throw new CleanRefused("unsupported", `Brand "${major}" is not a proven still-image brand (generic mif1/mp4 refused).`);
  }
  const meta = topLevel.find((box) => box.type === "meta");
  if (!meta) {
    // No metadata container at all: nothing removable.
    return {
      data: input.slice(), changes: [{
        group: "ISOBMFF", key: "meta box", action: "unchanged",
        verification: "not_verified", reason: "No meta box present — no removable metadata items found.",
      }],
      warnings: ["No meta box present; file returned byte-identical."],
      imagePayloadFingerprint: fingerprint(input),
      coverageLimited: false,
    };
  }
  const children = childBoxes(meta.payload);
  const byType = new Map(children.map((box) => [box.type, box] as const));
  const ilocBox = byType.get("iloc");
  const iinfBox = byType.get("iinf");
  const pitmBox = byType.get("pitm");
  if (!ilocBox || !iinfBox || !pitmBox) {
    throw new CleanRefused("failed", "meta box lacks iloc/iinf/pitm; structure not understood.");
  }
  const iloc = parseIloc(ilocBox.payload);
  const infeEntries = parseIinf(iinfBox.payload);
  if (infeEntries.some((entry) => entry.itemType === null)) {
    throw new CleanRefused("unsupported", "v0/v1 item entries without item types — metadata items cannot be identified safely.");
  }
  for (const item of iloc.items) {
    if (item.constructionMethod !== 0) {
      throw new CleanRefused("unsupported", `iloc construction method ${item.constructionMethod} is not supported (idat/item offsets refused).`);
    }
  }
  if (children.some((box) => box.type === "idat")) {
    throw new CleanRefused("unsupported", "idat box present — idat-backed layouts are out of scope.");
  }
  const mdats = topLevel.filter((box) => box.type === "mdat");
  if (mdats.length !== 1) {
    throw new CleanRefused("unsupported", `Expected exactly one mdat box, found ${mdats.length}.`);
  }
  if (topLevel.some((box) => box.type === "moov" || box.type === "mvex" || box.type === "moof")) {
    throw new CleanRefused("unsupported", "Movie boxes present — not a still image; refusing.");
  }
  // Collections/auxiliary: refuse rather than risk dangling relations.
  for (const entry of infeEntries) {
    if (entry.itemType && COLLECTION_ITEM_TYPES.has(entry.itemType)) {
      throw new CleanRefused("unsupported", `Derived/collection item "${entry.itemType}" present — collections are out of scope.`);
    }
  }
  const irefBox = byType.get("iref");
  let irefEntries: IrefEntry[] = [];
  if (irefBox) irefEntries = parseIref(irefBox.payload);
  for (const ref of irefEntries) {
    if (COLLECTION_REF_TYPES.has(ref.refType)) {
      throw new CleanRefused("unsupported", `Item reference "${ref.refType}" (thumbnails/auxiliary/derived) present — out of scope.`);
    }
  }

  // Identify removable metadata items by type/content, never by guessing.
  const removable = new Set<number>();
  const removeExif = resolvesCleaningTarget(policy, "exif_gps");
  const removeDescriptive = resolvesCleaningTarget(policy, "descriptive");
  for (const entry of infeEntries) {
    if (entry.itemType === "Exif" && removeExif) removable.add(entry.itemId);
    else if (entry.itemType === "mime" && entry.contentType === MIME_XMP && removeDescriptive) removable.add(entry.itemId);
  }
  const pitmTarget = parsePitm(pitmBox.payload);
  if (removable.has(pitmTarget)) {
    throw new CleanRefused("failed", "Primary item is itself a metadata item — refusing contradictory file.");
  }
  // ipma: drop associations of removed items (parse needed only then).
  // Note: real encoders (libavif) write iprp WITHOUT FullBox version/flags,
  // so tolerate both layouts — strict FullBox first, plain fallback second.
  const iprpBox = byType.get("iprp");
  let ipmaKept: Uint8Array | null = null;
  if (iprpBox) {
    let iprpChildren: RawBox[];
    let iprpHasVersionFlags = true;
    try {
      iprpChildren = childBoxes(iprpBox.payload, true);
      // Sanity: first child must plausibly be ipco.
      if (iprpChildren.length === 0 || iprpChildren[0]?.type !== "ipco") {
        iprpChildren = childBoxes(iprpBox.payload, false);
        iprpHasVersionFlags = false;
      }
    } catch {
      iprpChildren = childBoxes(iprpBox.payload, false);
      iprpHasVersionFlags = false;
    }
    const ipmaSub = iprpChildren.find((box) => box.type === "ipma");
    if (ipmaSub) {
      const ipma = parseIpma(ipmaSub.payload);
      if (ipma.entries.some((entry) => removable.has(entry.itemId))) {
        const keptEntries = ipma.entries.filter((entry) => !removable.has(entry.itemId));
        const parts: Uint8Array[] = [ipmaSub.payload.slice(0, 4)];
        const count = new Uint8Array(4);
        new DataView(count.buffer).setUint32(0, keptEntries.length);
        parts.push(count);
        for (const entry of keptEntries) {
          const idSize = ipma.flags & 1 ? 4 : 2;
          const assocSize = ipma.flags & 2 ? 2 : 1;
          const bytes = new Uint8Array(idSize + 1 + entry.associations.length * assocSize);
          const view = new DataView(bytes.buffer);
          if (idSize === 2) view.setUint16(0, entry.itemId);
          else view.setUint32(0, entry.itemId);
          bytes[idSize] = entry.associations.length;
          entry.associations.forEach((assoc, i) => {
            if (assocSize === 1) bytes[idSize + 1 + i] = assoc;
            else view.setUint16(idSize + 1 + i * 2, assoc);
          });
          parts.push(bytes);
        }
        // Rebuild iprp with the pruned ipma (other properties untouched),
        // preserving the original version/flags layout (or lack thereof).
        const rebuiltIprpChildren: Uint8Array[] = [];
        for (const child of iprpChildren) {
          if (child.type === "ipma") {
            rebuiltIprpChildren.push(sizedBox("ipma", concatBytes(parts)));
          } else {
            rebuiltIprpChildren.push(iprpBox.payload.slice(child.start, child.start + child.size));
          }
        }
        const inner = concatBytes(rebuiltIprpChildren);
        ipmaKept = iprpHasVersionFlags
          ? fullBox("iprp", fullVersion(iprpBox.payload), 0, inner)
          : sizedBox("iprp", inner);
      }
    }
  }

  // C2PA top-level uuid stores (spec A.5): identified by box UUID +
  // purpose + inner store marker. Dropped only when proven AND in scope;
  // C2PA-typed but unproven boxes are always retained (never blindly cut).
  const removeC2pa = resolvesC2paRemovalTarget(policy);
  const c2pa = locateIsobmffC2pa(topLevel);
  const c2paDrop = new Set<number>();
  const c2paUnproven = new Set<number>(c2pa.unproven);
  for (const index of c2pa.identified) {
    const box = topLevel[index];
    const purpose = box ? describeIsobmffUuid(box.payload)?.purpose ?? "?" : "?";
    if (removeC2pa) {
      c2paDrop.add(index);
      changes.push({ group: "C2PA", key: `top-level uuid C2PA manifest store (purpose "${purpose}", ${box?.size ?? 0} bytes)`, action: "removed", verification: "not_verified", reason: "Structurally proven C2PA uuid box dropped; image items and offsets recomputed." });
    } else {
      coverageLimited = true;
      warnings.push(`Identified C2PA uuid store (purpose "${purpose}") retained: outside the selected cleaning scope.`);
      changes.push({ group: "C2PA", key: `top-level uuid C2PA manifest store (purpose "${purpose}")`, action: "retained_unsupported", verification: "not_verified", reason: "C2PA removal needs the descriptive (XMP/IPTC/text) or AI-indicator scope." });
    }
  }
  for (const index of c2pa.unproven) {
    const box = topLevel[index];
    const purpose = box ? describeIsobmffUuid(box.payload)?.purpose ?? "?" : "?";
    coverageLimited = true;
    warnings.push(`C2PA-typed uuid box (purpose "${purpose}") failed structural proof; retained unassessed — C2PA removal is not supported for this layout.`);
    changes.push({ group: "C2PA", key: "top-level uuid box", action: "retained_unsupported", verification: "not_verified", reason: "C2PA-typed box failed content proof; kept rather than risk deleting unknown data." });
  }

  if (removable.size === 0 && c2paDrop.size === 0) {
    return {
      data: input.slice(),
      changes: [{ group: "ISOBMFF", key: "Selected Exif/XMP items", action: "unchanged", verification: "not_verified", reason: "No metadata items matched the selected removal types." }],
      warnings: ["No metadata items matched the selected removal types; file returned byte-identical."],
      imagePayloadFingerprint: fingerprint(input),
      coverageLimited: false,
    };
  }

  // Gather kept item payloads (bounds-checked) + fingerprint image payloads.
  const ilocById = new Map(iloc.items.map((item) => [item.itemId, item]));
  const keptPayloads = new Map<number, Uint8Array>();
  const imageFingerprints: string[] = [];
  for (const entry of infeEntries) {
    if (removable.has(entry.itemId)) continue;
    const ilocItem = ilocById.get(entry.itemId);
    if (!ilocItem || ilocItem.extents.length === 0) {
      throw new CleanRefused("failed", `Kept item ${entry.itemId} has no iloc extents.`);
    }
    const parts: Uint8Array[] = [];
    for (const extent of ilocItem.extents) {
      if (extent.offset < 0 || extent.length <= 0 || extent.offset + extent.length > input.length) {
        throw new CleanRefused("failed", `Item ${entry.itemId} extent points outside the file.`);
      }
      parts.push(input.subarray(extent.offset, extent.offset + extent.length));
    }
    const payload = concatBytes(parts);
    keptPayloads.set(entry.itemId, payload);
    if (entry.itemType !== null && !["Exif", "mime"].includes(entry.itemType)) {
      imageFingerprints.push(fingerprint(payload));
    }
  }

  // Change records for removals.
  for (const entry of infeEntries) {
    if (!removable.has(entry.itemId)) continue;
    const label = entry.itemType === "Exif" ? "EXIF" : "XMP";
    changes.push({ group: label, key: `ISOBMFF ${label} item (id ${entry.itemId})`, action: "removed", verification: "not_verified", reason: `${label} metadata item dropped; extents excluded from rebuilt mdat.` });
  }

  // Rebuild meta children in original order, swapping iloc/iinf/iref/iprp.
  const keptInfe = infeEntries.filter((entry) => !removable.has(entry.itemId));
  // Layout: meta size depends on rebuilt iloc (fixed widths → compute after mdat plan).
  const mdatPlan: { itemId: number; payload: Uint8Array }[] = [];
  for (const entry of keptInfe) {
    const payload = keptPayloads.get(entry.itemId);
    if (!payload) throw new CleanRefused("failed", `Kept item ${entry.itemId} payload missing during rebuild.`);
    mdatPlan.push({ itemId: entry.itemId, payload });
  }
  // Assemble meta with placeholder iloc to measure, then finalize offsets.
  const placeholderIloc = encodeIloc(mdatPlan.map((p) => ({ itemId: p.itemId, offset: 0, length: p.payload.length })));
  const keptIref = irefEntries
    .map((ref) => ({ ...ref, toIds: ref.toIds.filter((id) => !removable.has(id)) }))
    .filter((ref) => ref.toIds.length > 0 && !removable.has(ref.fromId));
  if (keptIref.length !== irefEntries.length || irefEntries.some((ref) => ref.toIds.some((id) => removable.has(id)) || removable.has(ref.fromId))) {
    changes.push({ group: "ISOBMFF", key: "iref references", action: "removed", verification: "not_verified", reason: "References to removed metadata items dropped; other relations preserved." });
  }
  const rebuiltIref = keptIref.length > 0 ? encodeIref(keptIref) : null;
  const metaChildrenParts: { type: string; bytes: Uint8Array }[] = [];
  for (const child of children) {
    if (child.type === "iloc") metaChildrenParts.push({ type: "iloc", bytes: placeholderIloc });
    else if (child.type === "iinf") metaChildrenParts.push({ type: "iinf", bytes: encodeIinf(keptInfe) });
    else if (child.type === "iref") {
      if (rebuiltIref) metaChildrenParts.push({ type: "iref", bytes: rebuiltIref });
    } else if (child.type === "iprp" && ipmaKept) {
      metaChildrenParts.push({ type: "iprp", bytes: ipmaKept });
    } else {
      const raw = meta.payload.slice(child.start, child.start + child.size);
      metaChildrenParts.push({ type: child.type, bytes: raw });
      if (!["hdlr", "pitm", "iprp", "iloc", "iinf", "iref"].includes(child.type)) {
        coverageLimited = true;
        warnings.push(`Unknown meta child "${child.type}" preserved verbatim; coverage limited.`);
        changes.push({ group: "ISOBMFF", key: child.type, action: "retained_unsupported", verification: "not_verified", reason: "Unknown meta child kept; not assessed." });
      }
    }
  }
  const metaSizeWithPlaceholder = 8 + 4 + metaChildrenParts.reduce((sum, part) => sum + part.bytes.length, 0);
  // Offsets: ftyp + meta + (kept top-level boxes before mdat?) — rebuild keeps
  // original top-level order; mdat position depends on preceding boxes.
  // Dropped C2PA uuid boxes are excluded so iloc offsets recompute cleanly.
  const mdatIndex = topLevel.findIndex((box) => box.type === "mdat");
  const keptPrefix = (box: (typeof topLevel)[number], index: number) =>
    index < mdatIndex && !c2paDrop.has(index);
  let prefixSize = 0;
  topLevel.forEach((box, index) => {
    if (!keptPrefix(box, index)) return;
    prefixSize += box.type === "meta" ? metaSizeWithPlaceholder : box.size;
  });
  const mdatDataStart = prefixSize + 8; // + mdat header
  let cursor = mdatDataStart;
  const finalIlocItems = mdatPlan.map((p) => {
    const item = { itemId: p.itemId, offset: cursor, length: p.payload.length };
    cursor += p.payload.length;
    return item;
  });
  const finalIloc = encodeIloc(finalIlocItems);
  const finalChildren = metaChildrenParts.map((part) => (part.type === "iloc" ? finalIloc : part.bytes));
  const finalMeta = fullBox("meta", fullVersion(meta.payload), 0, concatBytes(finalChildren));
  if (finalMeta.length !== metaSizeWithPlaceholder) {
    throw new CleanRefused("failed", "Rebuilt meta size drifted from plan; refusing inconsistent output.");
  }
  const finalMdat = sizedBox("mdat", concatBytes(mdatPlan.map((p) => p.payload)));
  const outParts: Uint8Array[] = [];
  const KNOWN_TOP_LEVEL = new Set(["ftyp", "meta", "mdat", "free", "skip", "wide"]);
  topLevel.forEach((box, index) => {
    if (index >= mdatIndex) return;
    if (c2paDrop.has(index)) return; // removal already recorded above
    if (box.type === "meta") {
      outParts.push(finalMeta);
      return;
    }
    // C2PA-typed but unproven boxes keep their specific record (pushed
    // above); only truly unknown types get the generic one.
    if (!c2paUnproven.has(index) && !KNOWN_TOP_LEVEL.has(box.type)) {
      coverageLimited = true;
      warnings.push(`Top-level "${box.type}" box preserved unassessed; coverage limited.`);
      changes.push({ group: "ISOBMFF", key: box.type, action: "retained_unsupported", verification: "not_verified", reason: "Unknown top-level box kept; not assessed." });
    }
    outParts.push(input.slice(box.start, box.start + box.size));
  });
  outParts.push(finalMdat);
  topLevel.forEach((box, index) => {
    if (index <= mdatIndex) return;
    if (c2paDrop.has(index)) return; // removal already recorded above
    if (c2paUnproven.has(index)) {
      outParts.push(input.slice(box.start, box.start + box.size));
      return; // specific C2PA record already pushed; no generic duplicate
    }
    if (box.type === "uuid" || box.type === "jumb") {
      coverageLimited = true;
      warnings.push(`Top-level "${box.type}" box preserved unassessed (possible JUMBF/C2PA data); coverage limited.`);
      changes.push({ group: "JUMBF", key: box.type, action: "retained_unsupported", verification: "not_verified", reason: "Unassessed container data kept; coverage limited." });
    } else if (box.type !== "free" && box.type !== "skip" && box.type !== "wide") {
      coverageLimited = true;
      warnings.push(`Top-level "${box.type}" box preserved unassessed; coverage limited.`);
      changes.push({ group: "ISOBMFF", key: box.type, action: "retained_unsupported", verification: "not_verified", reason: "Unknown top-level box kept; not assessed." });
    }
    outParts.push(input.slice(box.start, box.start + box.size));
  });
  changes.push({ group: "ISOBMFF", key: `structure (${kind} ftyp/meta/mdat)`, action: "retained_technical", verification: "not_verified", reason: "Container signature, primary item, color/property boxes and encoded payloads preserved." });
  const rebuilt = concatBytes(outParts);
  if (inputTrailing.length > 0) {
    warnings.push(`${inputTrailing.length} trailing byte(s) after the last box preserved verbatim.`);
    return {
      data: concatBytes([rebuilt, inputTrailing]),
      changes,
      warnings,
      imagePayloadFingerprint: imageFingerprints.join("|"),
      coverageLimited,
    };
  }
  return {
    data: rebuilt,
    changes,
    warnings,
    imagePayloadFingerprint: imageFingerprints.join("|"),
    coverageLimited,
  };
}

function parsePitm(payload: Uint8Array): number {
  const version = fullVersion(payload);
  const cursor = new Cursor(payload, 4, payload.length);
  return version === 0 ? cursor.u16() : cursor.u32();
}

/** Structural re-validation of finished bytes (verification stage). */
export function validateIsobmffStructure(data: Uint8Array, kind: "avif" | "heic"): { ok: boolean; errors: string[] } {
  try {
    const { boxes: topLevel } = walkTopLevel(data);
    const ftyp = topLevel.find((box) => box.type === "ftyp");
    const meta = topLevel.find((box) => box.type === "meta");
    const mdats = topLevel.filter((box) => box.type === "mdat");
    if (!ftyp || !meta || mdats.length !== 1) {
      return { ok: false, errors: ["Rebuilt file lacks ftyp/meta/exactly-one-mdat."] };
    }
    const major = String.fromCharCode(ftyp.payload[0] ?? 0, ftyp.payload[1] ?? 0, ftyp.payload[2] ?? 0, ftyp.payload[3] ?? 0);
    const expected = kind === "avif" ? "avif" : "heic";
    if (major !== expected && !(kind === "heic" && ["heix", "hevc", "hevx"].includes(major))) {
      return { ok: false, errors: [`Brand changed from ${kind} to ${major}.`] };
    }
    const children = childBoxes(meta.payload);
    const ilocBox = children.find((box) => box.type === "iloc");
    const iinfBox = children.find((box) => box.type === "iinf");
    const pitmBox = children.find((box) => box.type === "pitm");
    if (!ilocBox || !iinfBox || !pitmBox) return { ok: false, errors: ["Rebuilt meta lacks iloc/iinf/pitm."] };
    const iloc = parseIloc(ilocBox.payload);
    const infe = parseIinf(iinfBox.payload);
    const ids = new Set(infe.map((entry) => entry.itemId));
    for (const item of iloc.items) {
      if (!ids.has(item.itemId)) return { ok: false, errors: [`iloc item ${item.itemId} missing from iinf.`] };
      for (const extent of item.extents) {
        if (extent.offset + extent.length > data.length) {
          return { ok: false, errors: [`Item ${item.itemId} extent points outside the file.`] };
        }
      }
    }
    const pitmTarget = parsePitm(pitmBox.payload);
    if (!ids.has(pitmTarget)) return { ok: false, errors: ["Primary item reference dangles."] };
    return { ok: true, errors: [] };
  } catch (error) {
    if (error instanceof CleanRefused) return { ok: false, errors: [error.message] };
    return { ok: false, errors: ["Unknown ISOBMFF validation failure."] };
  }
}

/** Kept (non-metadata) item payloads in stable item/extent order. */
export function isobmffImagePayloads(data: Uint8Array): Uint8Array[] {
  const { boxes: topLevel } = walkTopLevel(data);
  const meta = topLevel.find((box) => box.type === "meta");
  if (!meta) return [data];
  const children = childBoxes(meta.payload);
  const ilocBox = children.find((box) => box.type === "iloc");
  const iinfBox = children.find((box) => box.type === "iinf");
  if (!ilocBox || !iinfBox) return [data];
  const iloc = parseIloc(ilocBox.payload);
  const infe = parseIinf(iinfBox.payload);
  const typeById = new Map(infe.map((entry) => [entry.itemId, entry.itemType]));
  const parts: Uint8Array[] = [];
  for (const item of iloc.items) {
    const type = typeById.get(item.itemId);
    if (type === "Exif" || (type === "mime")) continue;
    for (const extent of item.extents) {
      parts.push(data.subarray(extent.offset, extent.offset + extent.length));
    }
  }
  return parts;
}

/** Compact diagnostic fingerprint retained for reports/tests, not verification. */
export function isobmffImageFingerprint(data: Uint8Array): string {
  const parts = isobmffImagePayloads(data).map((part) => fingerprint(part));
  return parts.join("|");
}
