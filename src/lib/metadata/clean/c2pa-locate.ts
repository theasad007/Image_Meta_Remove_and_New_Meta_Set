import { C2PA_STORE_UUID } from "../inspect/c2pa";

/**
 * Shared structural C2PA carrier locator (C2PA removal milestone).
 *
 * Identifies embedded Content Credentials carriers by container structure —
 * never by a global UUID substring or by deleting every APP11/uuid block.
 * Rules mirror the official reader behavior (c2pa-rs asset handlers) plus
 * one extra guard (JPEG LBOX/TBOX duplication, required by ISO 19566-5):
 *
 * - JPEG APP11: CI[0..2], EN[2..4] box-instance id, Z[4..8] BE packet
 *   sequence, then JUMBF content. A group starts where payload[24..28] is
 *   the `c2pa` marker; continuations share EN with strictly increasing Z
 *   and repeat the store's first 8 bytes (LBOX+TBOX). A same-EN segment
 *   that breaks the chain is skipped as unrelated (never deleted).
 * - PNG `caBX` / WebP `C2PA`: single-chunk JUMBF store. Proven only when
 *   the payload opens with a sane `jumb` header and carries the exact C2PA
 *   Manifest Store UUID at the fixed `jumd` position (+16).
 * - ISOBMFF top-level `uuid`: extended type must equal the C2PA box UUID
 *   (spec A.5 — distinct from the inner JUMBF store UUID), purpose must be
 *   a known C2PA purpose, and the store UUID must occur within the box
 *   content. A generic `uuid` box is NEVER automatically C2PA.
 *
 * All functions are total: hostile/truncated sub-structure yields
 * "not identified" (retain + partial downstream), never a throw and never
 * a false identification.
 */

/** C2PA extended (box) UUID for BMFF `uuid` carriers (spec A.5). */
export const C2PA_BMFF_UUID = new Uint8Array([
  0xd8, 0xfe, 0xc3, 0xd6, 0x1b, 0x0e, 0x48, 0x3c,
  0x92, 0x97, 0x58, 0x28, 0x87, 0x7e, 0xc4, 0x81,
]);

const JPEG_C2PA_MARKER = [0x63, 0x32, 0x70, 0x61]; // "c2pa"

const KNOWN_BMFF_PURPOSES = new Set(["manifest", "merkle", "original", "update"]);

function bytesEqual(a: Uint8Array, aStart: number, b: Uint8Array, bStart: number, length: number): boolean {
  for (let i = 0; i < length; i += 1) {
    if ((a[aStart + i] ?? -1) !== (b[bStart + i] ?? -2)) return false;
  }
  return true;
}

function readU32BE(bytes: Uint8Array, offset: number): number | null {
  const a = bytes[offset];
  const b = bytes[offset + 1];
  const c = bytes[offset + 2];
  const d = bytes[offset + 3];
  if (a === undefined || b === undefined || c === undefined || d === undefined) return null;
  return (a * 0x1000000 + (b << 16) + (c << 8) + d) >>> 0;
}

export interface JpegC2paGroup {
  /** APP11 indices (into the caller's array) forming one manifest store. */
  indices: number[];
  /** Box-instance id (EN bytes) as hex, for change records. */
  enHex: string;
}

/**
 * Group JPEG APP11 payloads (segment bytes AFTER marker+length) into C2PA
 * manifest stores. Returns only positively identified groups; every other
 * segment index is unrelated and must be retained.
 */
export function locateJpegC2pa(payloads: Uint8Array[]): JpegC2paGroup[] {
  const groups: JpegC2paGroup[] = [];
  let open: { en: string; lastZ: number; first8: Uint8Array; indices: number[] } | null = null;
  for (let index = 0; index < payloads.length; index += 1) {
    const payload = payloads[index] ?? new Uint8Array(0);
    const enHex =
      payload.length >= 4
        ? `${(payload[2] ?? 0).toString(16).padStart(2, "0")}${(payload[3] ?? 0).toString(16).padStart(2, "0")}`
        : "";
    const hasMarker =
      payload.length > 28 &&
      (payload[24] ?? -1) === JPEG_C2PA_MARKER[0] &&
      (payload[25] ?? -1) === JPEG_C2PA_MARKER[1] &&
      (payload[26] ?? -1) === JPEG_C2PA_MARKER[2] &&
      (payload[27] ?? -1) === JPEG_C2PA_MARKER[3];
    const z = payload.length >= 8 ? readU32BE(payload, 4) : null;
    if (
      open !== null &&
      payload.length > 16 &&
      enHex === open.en &&
      z !== null &&
      z > open.lastZ &&
      bytesEqual(payload, 8, open.first8, 0, 8)
    ) {
      // Continuation of the open group (EN + Z order + duplicated
      // LBOX/TBOX, as official writers emit). Foreign segments between
      // members do not break the chain; a same-EN segment that fails these
      // checks is skipped as unrelated, exactly like the official reader.
      open.indices.push(index);
      open.lastZ = z;
      continue;
    }
    if (hasMarker && payload.length >= 16) {
      const group: JpegC2paGroup = { indices: [index], enHex };
      groups.push(group);
      open = { en: enHex, lastZ: z ?? 0, first8: payload.slice(8, 16), indices: group.indices };
    }
    // Anything else is unrelated and must be retained.
  }
  return groups;
}

function isJumbfStore(data: Uint8Array, exactLength: boolean): boolean {
  // JUMBF manifest store: LBOX(4) + TBOX 'jumb' + jumd box whose UUID field
  // sits at the fixed offset +16 (ISO 19566-5 description-box layout).
  if (data.length < 32) return false;
  const lbox = readU32BE(data, 0);
  if (lbox === null || lbox < 32) return false;
  if (exactLength && lbox !== data.length) return false;
  if ((data[4] ?? -1) !== 0x6a || (data[5] ?? -1) !== 0x75 || (data[6] ?? -1) !== 0x6d || (data[7] ?? -1) !== 0x62) {
    return false;
  }
  return bytesEqual(data, 16, C2PA_STORE_UUID, 0, 16);
}

export interface ChunkLocateResult {
  /** Chunk indices proven to be C2PA stores (safe to remove when in scope). */
  identified: number[];
  /** Same-name chunks that failed structural proof (retain, never drop blindly). */
  unproven: number[];
}

/** PNG `caBX` chunks carrying a proven JUMBF manifest store. */
export function locatePngC2pa(chunks: Array<{ type: string; data: Uint8Array }>): ChunkLocateResult {
  const identified: number[] = [];
  const unproven: number[] = [];
  chunks.forEach((chunk, index) => {
    if (chunk.type !== "caBX") return;
    if (isJumbfStore(chunk.data, true)) identified.push(index);
    else unproven.push(index);
  });
  return { identified, unproven };
}

/** WebP RIFF `C2PA` chunks carrying a proven JUMBF manifest store. */
export function locateWebpC2pa(chunks: Array<{ id: string; size: number; data: Uint8Array }>): ChunkLocateResult {
  const identified: number[] = [];
  const unproven: number[] = [];
  chunks.forEach((chunk, index) => {
    if (chunk.id !== "C2PA") return;
    if (chunk.size !== chunk.data.length) {
      unproven.push(index);
      return;
    }
    if (isJumbfStore(chunk.data, true)) identified.push(index);
    else unproven.push(index);
  });
  return { identified, unproven };
}

export interface IsobmffLocateResult {
  /** Top-level box indices proven to be C2PA stores. */
  identified: number[];
  /** C2PA-typed boxes that failed purpose/content proof (retain + partial). */
  unproven: number[];
}

/**
 * Describe a top-level `uuid` payload for change records: C2PA box UUID +
 * purpose, or null when not C2PA-typed. Never throws.
 */
export function describeIsobmffUuid(payload: Uint8Array): { purpose: string } | null {
  if (payload.length < 16 + 4 + 1) return null;
  if (!bytesEqual(payload, 0, C2PA_BMFF_UUID, 0, 16)) return null;
  let purpose = "";
  for (let i = 20; i < Math.min(payload.length, 20 + 33); i += 1) {
    const byte = payload[i] ?? 0;
    if (byte === 0) {
      return KNOWN_BMFF_PURPOSES.has(purpose) ? { purpose } : null;
    }
    if (byte < 0x20 || byte > 0x7e) return null;
    purpose += String.fromCharCode(byte);
  }
  return null;
}

/**
 * Top-level ISOBMFF `uuid` boxes (spec A.5). Requires the exact C2PA box
 * UUID, a known null-terminated purpose, and the inner store UUID within
 * 256 bytes past the purpose field.
 */
export function locateIsobmffC2pa(
  boxes: Array<{ type: string; size: number; payload: Uint8Array }>,
): IsobmffLocateResult {
  const identified: number[] = [];
  const unproven: number[] = [];
  boxes.forEach((box, index) => {
    if (box.type !== "uuid") return;
    const payload = box.payload;
    if (payload.length < 16 + 4 + 1) return; // not C2PA-assessable; unrelated
    if (!bytesEqual(payload, 0, C2PA_BMFF_UUID, 0, 16)) return; // generic uuid: unrelated
    // C2PA-typed from here on: anything unproven is retained, never dropped.
    const described = describeIsobmffUuid(payload);
    if (!described) {
      unproven.push(index);
      return;
    }
    // Purpose end: rescan for the window start (bounded, total function).
    let purposeEnd = -1;
    for (let i = 20; i < Math.min(payload.length, 20 + 33); i += 1) {
      if ((payload[i] ?? 0) === 0) {
        purposeEnd = i;
        break;
      }
    }
    if (purposeEnd < 0) {
      unproven.push(index);
      return;
    }
    const window = payload.slice(purposeEnd, purposeEnd + 256);
    let found = false;
    for (let i = 0; i + 16 <= window.length; i += 1) {
      if (bytesEqual(window, i, C2PA_STORE_UUID, 0, 16)) {
        found = true;
        break;
      }
    }
    if (found) identified.push(index);
    else unproven.push(index);
  });
  return { identified, unproven };
}
