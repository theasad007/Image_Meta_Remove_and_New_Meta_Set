/**
 * Shared Phase 6 write codecs: TIFF IFD0, XMP RDF, IPTC-IIM (Phase 6).
 *
 * Browser-safe (Uint8Array/DataView, DOM for XML) with zero dependencies.
 * All writers preserve what they do not understand: unknown TIFF tags are
 * carried with verbatim value bytes, unknown XMP elements survive DOM
 * merges, and non-IPTC Photoshop IRBs pass through untouched.
 */

// ---------------------------------------------------------------- TIFF

const TIFF_TYPE_SIZES: Record<number, number> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  7: 1, // UNDEFINED
  9: 4, // SLONG
  10: 8, // SRATIONAL
};

/** IFD tags whose LONG value points at a sub-IFD (preserved as a block). */
const SUB_IFD_TAGS = new Set([34665, 34853, 40965]);

export interface TiffEntry {
  tag: number;
  type: number;
  count: number;
  /** Resolved value bytes (inline or dereferenced + copied). */
  value: Uint8Array;
}

export interface ParsedTiff {
  little: boolean;
  ifdOffset: number;
  entries: TiffEntry[];
  /** Next-IFD (thumbnail) offset, 0 when absent. */
  nextIfdOffset: number;
  /** Rigid tail block [tailStart, end): sub-IFDs/thumbnail, relocated whole. */
  tailStart: number;
  raw: Uint8Array;
}

function tiffView(tiff: Uint8Array): DataView {
  return new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
}

export function parseTiff(tiff: Uint8Array): ParsedTiff | null {
  if (tiff.length < 8) return null;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  const big = tiff[0] === 0x4d && tiff[1] === 0x4d;
  if (!little && !big) return null;
  const view = tiffView(tiff);
  const u16 = (off: number): number | null =>
    off + 2 <= tiff.length ? view.getUint16(off, little) : null;
  const u32 = (off: number): number | null =>
    off + 4 <= tiff.length ? view.getUint32(off, little) : null;
  if (u16(2) !== 42) return null;
  const ifdOffset = u32(4);
  if (ifdOffset === null || ifdOffset + 2 > tiff.length) return null;
  const count = u16(ifdOffset);
  if (count === null || count > 256) return null;
  const entries: TiffEntry[] = [];
  let pointerTail = tiff.length;
  for (let i = 0; i < count; i += 1) {
    const base = ifdOffset + 2 + i * 12;
    if (base + 12 > tiff.length) return null;
    const tag = u16(base) ?? 0;
    const type = u16(base + 2) ?? 0;
    const num = u32(base + 4) ?? 0;
    const sizePer = TIFF_TYPE_SIZES[type] ?? 0;
    if (sizePer === 0 || num === 0 || num > 65536) return null;
    const total = num * sizePer;
    if (total > tiff.length) return null;
    let value: Uint8Array;
    if (total <= 4) {
      value = tiff.slice(base + 8, base + 8 + total);
    } else {
      const at = u32(base + 8);
      if (at === null || at + total > tiff.length) return null;
      value = tiff.slice(at, at + total);
    }
    entries.push({ tag, type, count: num, value });
    if (SUB_IFD_TAGS.has(tag) && total <= 4) {
      // Pointer value lives inline; dereference it for tail computation.
      const at = total === 4 ? view.getUint32(base + 8, little) : 0;
      if (at > 8 && at < pointerTail) pointerTail = at;
    }
  }
  const nextBase = ifdOffset + 2 + count * 12;
  const nextIfdOffset = nextBase + 4 <= tiff.length ? (u32(nextBase) ?? 0) : 0;
  let tailStart = pointerTail;
  if (nextIfdOffset !== 0) {
    if (nextIfdOffset < 8 || nextIfdOffset >= tiff.length) return null;
    if (nextIfdOffset < tailStart) tailStart = nextIfdOffset;
  }
  return { little, ifdOffset, entries, nextIfdOffset, tailStart, raw: tiff };
}

export interface TiffWriteValue {
  tag: number;
  type: number;
  values: Array<string | number | [number, number]>;
}

function encodeTiffValue(little: boolean, type: number, values: TiffWriteValue["values"]): Uint8Array | null {
  const bytes: number[] = [];
  const pushU16 = (v: number) => {
    bytes.push(little ? v & 0xff : (v >> 8) & 0xff, little ? (v >> 8) & 0xff : v & 0xff);
  };
  const pushU32 = (v: number) => {
    const b = [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
    if (little) b.reverse();
    bytes.push(...b);
  };
  for (const value of values) {
    if (type === 2 && typeof value === "string") {
      const encoded = new TextEncoder().encode(value);
      bytes.push(...encoded, 0);
    } else if ((type === 3 || type === 9) && typeof value === "number") {
      if (type === 3) pushU16(value & 0xffff);
      else pushU32(value >>> 0);
    } else if (type === 4 && typeof value === "number") {
      pushU32(value >>> 0);
    } else if ((type === 5 || type === 10) && Array.isArray(value)) {
      pushU32(value[0] >>> 0);
      pushU32(value[1] >>> 0);
    } else if ((type === 1 || type === 7) && typeof value === "number") {
      bytes.push(value & 0xff);
    } else {
      return null;
    }
  }
  return new Uint8Array(bytes);
}

/**
 * Merge requested tag writes into an existing TIFF (update mode) or build
 * a fresh IFD0 (replace mode, `base` null). Unknown tags, sub-IFD blocks
 * and thumbnail IFDs are preserved via a rigid relocated tail; proprietary
 * Makernote internals stay byte-identical (offset-dependent manufacturer
 * parsing differences are a disclosed limitation).
 */
export function buildTiff(
  base: ParsedTiff | null,
  writes: TiffWriteValue[],
  little = true,
): Uint8Array | null {
  const merged = new Map<number, { type: number; value: Uint8Array }>();
  const order: number[] = [];
  if (base) {
    for (const entry of base.entries) {
      merged.set(entry.tag, { type: entry.type, value: entry.value });
      order.push(entry.tag);
    }
  }
  for (const write of writes) {
    const value = encodeTiffValue(little, write.type, write.values);
    if (!value) return null;
    if (!merged.has(write.tag)) order.push(write.tag);
    merged.set(write.tag, { type: write.type, value });
  }
  if (order.length > 256) return null;
  // Layout: header(8) + count(2) + entries(12n) + next(4) + data area + tail.
  const headerSize = 8 + 2 + order.length * 12 + 4;
  const dataParts: Uint8Array[] = [];
  const entryBlobs: Uint8Array[] = [];
  let cursor = headerSize;
  for (const tag of order) {
    const item = merged.get(tag);
    if (!item) return null;
    const entry = new Uint8Array(12);
    const view = new DataView(entry.buffer);
    const put16 = (off: number, v: number) => view.setUint16(off, v, little);
    const put32 = (off: number, v: number) => view.setUint32(off, v >>> 0, little);
    put16(0, tag);
    put16(2, item.type);
    const per = TIFF_TYPE_SIZES[item.type] ?? 0;
    const count = per > 0 ? Math.floor(item.value.length / per) : 0;
    if (per === 0 || count === 0 || count * per !== item.value.length) return null;
    put32(4, count);
    if (item.value.length <= 4) {
      entry.set(item.value, 8);
    } else {
      put32(8, cursor);
      dataParts.push(item.value);
      cursor += item.value.length;
    }
    entryBlobs.push(entry);
  }
  // Rigid tail: sub-IFDs/thumbnail shift by one delta; internal offsets hold.
  const tailSource = base && base.tailStart < base.raw.length ? base.raw.slice(base.tailStart) : null;
  const parts: Uint8Array[] = [
    new Uint8Array(little ? [0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00] : [0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08]),
  ];
  const countBytes = new Uint8Array(2);
  new DataView(countBytes.buffer).setUint16(0, order.length, little);
  parts.push(countBytes, ...entryBlobs);
  // Next-IFD pointer: fixed up below when a tail exists, else zero.
  parts.push(new Uint8Array(4));
  // Data parts follow the entries; the rigid tail goes last.
  parts.push(...dataParts);
  let tailOffset = 0;
  if (tailSource) {
    tailOffset = headerSize + dataParts.reduce((sum, part) => sum + part.length, 0);
    parts.push(tailSource);
  }
  const out = concat(parts);
  const outView = new DataView(out.buffer, out.byteOffset, out.byteLength);
  // Fix pointer tags (sub-IFDs lived inside the rigid tail) and next-IFD.
  // Pointer values are absolute from TIFF start; only values that lived
  // inside the old tail shift with it.
  if (tailSource && base) {
    const delta = tailOffset - base.tailStart;
    order.forEach((tag, entryIndex) => {
      if (!SUB_IFD_TAGS.has(tag)) return;
      const entryOff = 8 + 2 + entryIndex * 12;
      if (outView.getUint32(entryOff + 4, little) !== 1) return;
      const at = outView.getUint32(entryOff + 8, little);
      if (at >= base.tailStart) {
        outView.setUint32(entryOff + 8, (at + delta) >>> 0, little);
      }
    });
    if (base.nextIfdOffset !== 0) {
      outView.setUint32(8 + 2 + order.length * 12, (base.nextIfdOffset + delta) >>> 0, little);
    }
  }
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

// ---------------------------------------------------------------- XMP

export const XMP_NS = {
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  dc: "http://purl.org/dc/elements/1.1/",
  xmpRights: "http://ns.adobe.com/xap/1.0/rights/",
  photoshop: "http://ns.adobe.com/photoshop/1.0/",
  iptcCore: "http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/",
} as const;

export interface XmpProperty {
  ns: string;
  prefix: string;
  prop: string;
  kind: "seq" | "bag" | "alt" | "simple" | "contactUrl";
  values: string[];
}

export interface XmlCodec {
  parse: (text: string) => Document;
  serialize: (doc: Document) => string;
}

function xpacket(inner: string): string {
  return (
    `<?xpacket begin="${String.fromCharCode(0xef, 0xbb, 0xbf)}" id="W5M0MpCehiHzreSzNTczkc9d"?>\n` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/">\n<rdf:RDF xmlns:rdf="${XMP_NS.rdf}">\n${inner}\n</rdf:RDF>\n</x:xmpmeta>\n<?xpacket end="w"?>`
  );
}

export function buildXmpPacket(props: XmpProperty[]): Uint8Array {
  const descriptions = new Map<string, string[]>();
  for (const prop of props) {
    const list = descriptions.get(prop.prefix) ?? [];
    list.push(renderXmpProperty(prop));
    descriptions.set(prop.prefix, list);
  }
  const blocks: string[] = [];
  const prefixNs = new Map<string, string>();
  for (const prop of props) prefixNs.set(prop.prefix, prop.ns);
  for (const [prefix, items] of descriptions) {
    blocks.push(`<rdf:Description rdf:about="" xmlns:${prefix}="${prefixNs.get(prefix)}">${items.join("")}</rdf:Description>`);
  }
  return new TextEncoder().encode(xpacket(blocks.join("\n")));
}

function renderXmpProperty(prop: XmpProperty): string {
  const tag = `${prop.prefix}:${prop.prop}`;
  const esc = (value: string): string =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  if (prop.kind === "simple") {
    return `<${tag}>${esc(prop.values[0] ?? "")}</${tag}>`;
  }
  if (prop.kind === "contactUrl") {
    return `<${tag} rdf:parseType="Resource"><${prop.prefix}:CiUrlWork>${esc(prop.values[0] ?? "")}</${prop.prefix}:CiUrlWork></${tag}>`;
  }
  const container = prop.kind === "seq" ? "Seq" : prop.kind === "bag" ? "Bag" : "Alt";
  const items =
    prop.kind === "alt"
      ? `<rdf:li xml:lang="x-default">${esc(prop.values[0] ?? "")}</rdf:li>`
      : prop.values.map((value) => `<rdf:li>${esc(value)}</rdf:li>`).join("");
  return `<${tag}><rdf:${container}>${items}</rdf:${container}></${tag}>`;
}

function findElements(doc: Document, ns: string, local: string): Element[] {
  const found: Element[] = [];
  const all = doc.getElementsByTagName("*");
  for (let i = 0; i < all.length; i += 1) {
    const element = all[i] as Element;
    if (element.namespaceURI === ns && element.localName === local) found.push(element);
  }
  return found;
}

function ensureDescription(doc: Document, ns: string, prefix: string): Element {
  const rdf = findElements(doc, XMP_NS.rdf, "RDF")[0];
  if (!rdf) throw new Error("XMP has no rdf:RDF root.");
  const existing = findElements(doc, XMP_NS.rdf, "Description").find(
    (candidate) => candidate.parentNode === rdf && candidate.getAttribute(`xmlns:${prefix}`) === ns,
  );
  if (existing) return existing;
  const created = doc.createElementNS(XMP_NS.rdf, "rdf:Description");
  created.setAttribute("rdf:about", "");
  created.setAttribute(`xmlns:${prefix}`, ns);
  rdf.appendChild(created);
  return created;
}

function setProperty(doc: Document, prop: XmpProperty): void {
  const description = ensureDescription(doc, prop.ns, prop.prefix);
  // Remove prior statements of the same property (no duplicate conflicts).
  for (const stale of findElements(description.ownerDocument ?? doc, prop.ns, prop.prop)) {
    if (stale.parentNode === description) description.removeChild(stale);
  }
  const tag = doc.createElementNS(prop.ns, `${prop.prefix}:${prop.prop}`);
  const esc = (value: string): Text => doc.createTextNode(value);
  if (prop.kind === "simple") {
    tag.appendChild(esc(prop.values[0] ?? ""));
  } else if (prop.kind === "contactUrl") {
    // Website lives in the CreatorContactInfo struct (no wrapper element).
    const contact = doc.createElementNS(prop.ns, `${prop.prefix}:CreatorContactInfo`);
    const url = doc.createElementNS(prop.ns, `${prop.prefix}:CiUrlWork`);
    url.appendChild(esc(prop.values[0] ?? ""));
    contact.appendChild(url);
    description.appendChild(contact);
    return;
  } else {
    const containerName = prop.kind === "seq" ? "Seq" : prop.kind === "bag" ? "Bag" : "Alt";
    const container = doc.createElementNS(XMP_NS.rdf, `rdf:${containerName}`);
    if (prop.kind === "alt") {
      const li = doc.createElementNS(XMP_NS.rdf, "rdf:li");
      li.setAttribute("xml:lang", "x-default");
      li.appendChild(esc(prop.values[0] ?? ""));
      container.appendChild(li);
    } else {
      for (const value of prop.values) {
        const li = doc.createElementNS(XMP_NS.rdf, "rdf:li");
        li.appendChild(esc(value));
        container.appendChild(li);
      }
    }
    tag.appendChild(container);
  }
  description.appendChild(tag);
}

/**
 * Merge requested properties into an existing XMP packet (update mode).
 * Unknown elements/namespaces survive untouched. Returns null when the
 * existing packet is not parseable XML.
 */
export function mergeXmpPacket(existing: string, updates: XmpProperty[], xml: XmlCodec): string | null {
  let doc: Document;
  try {
    doc = xml.parse(existing);
    if (findElements(doc, XMP_NS.rdf, "RDF").length === 0) return null;
  } catch {
    return null;
  }
  try {
    for (const prop of updates) setProperty(doc, prop);
  } catch {
    return null;
  }
  return xml.serialize(doc);
}

/** Read back specific XMP properties (verification + tests). */
export function readXmpProperties(
  packet: string,
  queries: Array<{ ns: string; prop: string }>,
  xml: XmlCodec,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let doc: Document;
  try {
    doc = xml.parse(packet);
  } catch {
    return out;
  }
  for (const query of queries) {
    const values: string[] = [];
    for (const element of findElements(doc, query.ns, query.prop)) {
      // Container properties (Seq/Bag/Alt): read each rdf:li separately so
      // multi-value fields never concatenate into one string.
      const items = findElements(element.ownerDocument ?? doc, XMP_NS.rdf, "li").filter(
        (li) => li.parentNode === element || isDescendantOf(li, element),
      );
      const sources = items.length > 0 ? items : [element];
      for (const source of sources) {
        const text = (source.textContent ?? "").trim().replace(/\s+/g, " ");
        if (text) values.push(text);
      }
    }
    if (values.length > 0) out.set(`${query.ns}#${query.prop}`, values);
  }
  return out;
}

function isDescendantOf(node: Element, ancestor: Element): boolean {
  let current = node.parentNode as Element | null;
  let steps = 0;
  while (current && steps < 32) {
    if (current === ancestor) return true;
    current = current.parentNode as Element | null;
    steps += 1;
  }
  return false;
}

// ---------------------------------------------------------------- IPTC (JPEG APP13)

export interface IptcDataset {
  record: number;
  dataset: number;
  data: Uint8Array;
}

function readU16BE(bytes: Uint8Array, offset: number): number | null {
  const a = bytes[offset];
  const b = bytes[offset + 1];
  if (a === undefined || b === undefined) return null;
  return (a << 8) | b;
}

function readU32BE(bytes: Uint8Array, offset: number): number | null {
  const a = bytes[offset];
  const b = bytes[offset + 1];
  const c = bytes[offset + 2];
  const d = bytes[offset + 3];
  if (a === undefined || b === undefined || c === undefined || d === undefined) return null;
  return ((a * 0x1000000 + (b << 16) + (c << 8) + d) >>> 0) >>> 0;
}

/**
 * Parse IPTC-NAA datasets from a JPEG APP13 payload, preserving every
 * non-IPTC Photoshop resource verbatim (returned as opaque `kept`).
 */
export function parseApp13(payload: Uint8Array): { iptc: IptcDataset[]; kept: Uint8Array[] } {
  const iptc: IptcDataset[] = [];
  const kept: Uint8Array[] = [];
  const header = "Photoshop 3.0\x00";
  let start = 0;
  for (let i = 0; i < header.length; i += 1) {
    if ((payload[i] ?? -1) !== header.charCodeAt(i)) return { iptc, kept };
  }
  start = header.length;
  while (start + 12 <= payload.length) {
    if (
      payload[start] !== 0x38 || payload[start + 1] !== 0x42 ||
      payload[start + 2] !== 0x49 || payload[start + 3] !== 0x4d
    ) {
      break;
    }
    const resourceId = readU16BE(payload, start + 4);
    const nameLen = payload[start + 6] ?? 0;
    const nameField = 1 + nameLen + (nameLen % 2 === 0 ? 1 : 0);
    const sizeOff = start + 6 + nameField;
    const size = readU32BE(payload, sizeOff);
    if (resourceId === null || size === null) break;
    const dataOff = sizeOff + 4;
    if (dataOff + size > payload.length) break;
    const data = payload.slice(dataOff, dataOff + size);
    const raw = payload.slice(start, dataOff + size + (size % 2));
    if (resourceId === 0x0404) {
      let cursor = 0;
      while (cursor + 5 <= data.length) {
        if (data[cursor] !== 0x1c) break;
        const record = data[cursor + 1] ?? 0;
        const dataset = data[cursor + 2] ?? 0;
        const length = ((data[cursor + 3] ?? 0) << 8) | (data[cursor + 4] ?? 0);
        if (cursor + 5 + length > data.length) break;
        iptc.push({ record, dataset, data: data.slice(cursor + 5, cursor + 5 + length) });
        cursor += 5 + length;
      }
    } else {
      kept.push(raw);
    }
    start = dataOff + size + (size % 2);
  }
  return { iptc, kept };
}

function encodeIptcDataset(record: number, dataset: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + data.length);
  out[0] = 0x1c;
  out[1] = record;
  out[2] = dataset;
  out[3] = (data.length >> 8) & 0xff;
  out[4] = data.length & 0xff;
  out.set(data, 5);
  return out;
}

/** Build an APP13 payload: kept foreign resources + merged IPTC record. */
export function buildApp13(kept: Uint8Array[], datasets: IptcDataset[]): Uint8Array {
  const header = new TextEncoder().encode("Photoshop 3.0\x00");
  const iptcBody = concatBytes(datasets.map((d) => encodeIptcDataset(d.record, d.dataset, d.data)));
  const resource = concatBytes([
    new Uint8Array([0x38, 0x42, 0x49, 0x4d, 0x04, 0x04, 0x00, 0x00]),
    (() => {
      const size = new Uint8Array(4);
      new DataView(size.buffer).setUint32(0, iptcBody.length);
      return size;
    })(),
    iptcBody,
    ...(iptcBody.length % 2 === 1 ? [new Uint8Array([0])] : []),
  ]);
  return concatBytes([header, ...kept, resource]);
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
