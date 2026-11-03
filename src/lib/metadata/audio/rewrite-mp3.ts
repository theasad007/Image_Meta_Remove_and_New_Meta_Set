import type { ProfileField } from "../rewrite/fields";
import type { MetadataChange } from "../clean/types";
import type { RewriteMode } from "../rewrite/rewrite";
import { probeMp3, type Id3FrameView } from "./id3";
import { cleanMp3 } from "./clean-mp3";
import { CleanRefused } from "../clean/types";

/**
 * MP3 metadata rewriting (Phase 10) — free for guests, one file at a time
 * (batch follows the Phase 06 policy). Real ID3 writing with independent
 * read-back verification; the MPEG audio frames are never touched.
 *
 * Field mapping (roadmap §10):
 *   company → TPUB · creator → TPE1 · copyright → TCOP · title → TIT2
 *   description → COMM · keywords → TXXX:"KEYWORDS" · website → WXXX
 *   locationName → TXXX:"LOCATION" (clearly labeled nonstandard)
 * `rightsOwner` and `contact` have no verified ID3 target → reported
 * unsupported, never silently dropped. **GPS is never written to MP3.**
 *
 * Version policy: the ORIGINAL tag version is preserved on rebuild
 * (v2.3 plain sizes + ISO-8859-1/UTF-16; v2.4 synchsafe + UTF-8 allowed).
 * v2.2 sources refuse targeted updates (no safe mixed-version rebuild) —
 * use Replace mode, which writes a fresh v2.3 tag. A stale ID3v1 tail is
 * removed on rewrite so v1 values cannot shadow the verified v2 output.
 */

export interface Mp3WriteResult {
  data: Uint8Array;
  changes: MetadataChange[];
  warnings: string[];
  skipped: Array<{ field: string; channel: string; reason: string }>;
  writtenVersion: "v2.3" | "v2.4";
}

const MULTI_LINE_COMMENT_LIMIT = 2000;

function needsUnicode(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) > 0xff) return true;
  }
  return false;
}

function textPayload(text: string, version: number): { encoding: number; bytes: Uint8Array } {
  if (version === 4 && needsUnicode(text)) {
    return { encoding: 3, bytes: new TextEncoder().encode(text) };
  }
  if (needsUnicode(text)) {
    const encoded = new Uint8Array(2 + text.length * 2);
    encoded[0] = 0xff;
    encoded[1] = 0xfe;
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      encoded[2 + i * 2] = code & 0xff;
      encoded[3 + i * 2] = code >> 8;
    }
    return { encoding: 1, bytes: encoded };
  }
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
  return { encoding: 0, bytes };
}

function buildFrame(id: string, payload: Uint8Array, major: number): Uint8Array {
  const size = payload.length;
  if (major === 2) {
    const frame = new Uint8Array(6 + size);
    for (let i = 0; i < 3; i += 1) frame[i] = id.charCodeAt(i);
    frame[3] = (size >> 16) & 0xff;
    frame[4] = (size >> 8) & 0xff;
    frame[5] = size & 0xff;
    frame.set(payload, 6);
    return frame;
  }
  const frame = new Uint8Array(10 + size);
  for (let i = 0; i < 4; i += 1) frame[i] = id.charCodeAt(i);
  if (major === 4) {
    frame[4] = (size >> 21) & 0x7f;
    frame[5] = (size >> 14) & 0x7f;
    frame[6] = (size >> 7) & 0x7f;
    frame[7] = size & 0x7f;
  } else {
    frame[4] = (size >> 24) & 0xff;
    frame[5] = (size >> 16) & 0xff;
    frame[6] = (size >> 8) & 0xff;
    frame[7] = size & 0xff;
  }
  frame[8] = 0x00;
  frame[9] = 0x00;
  frame.set(payload, 10);
  return frame;
}

function textField(id: string, text: string, major: number): Uint8Array {
  const { encoding, bytes } = textPayload(text, major);
  return buildFrame(id, new Uint8Array([encoding, ...bytes]), major);
}

function txxxFrame(description: string, value: string, major: number): Uint8Array {
  const { encoding, bytes } = textPayload(value, major);
  const desc = textPayload(description, major);
  return buildFrame("TXXX", new Uint8Array([encoding, ...desc.bytes, ...(encoding === 1 || encoding === 2 ? [] : [0x00]), ...bytes]), major);
}

function commFrame(text: string, major: number): Uint8Array {
  const { encoding, bytes } = textPayload(text, major);
  return buildFrame("COMM", new Uint8Array([encoding, 0x65, 0x6e, 0x67, 0x00, ...bytes]), major);
}

function wxxxFrame(description: string, url: string, major: number): Uint8Array {
  const desc = textPayload(description, major);
  const urlBytes = new Uint8Array(url.length);
  for (let i = 0; i < url.length; i += 1) urlBytes[i] = url.charCodeAt(i) & 0xff;
  return buildFrame("WXXX", new Uint8Array([0x00, ...desc.bytes, 0x00, ...urlBytes]), major);
}

function tagHeader(size: number, major: number): Uint8Array {
  const header = new Uint8Array(10);
  header.set([0x49, 0x44, 0x33, major, 0x00, 0x00], 0);
  header[6] = (size >> 21) & 0x7f;
  header[7] = (size >> 14) & 0x7f;
  header[8] = (size >> 7) & 0x7f;
  header[9] = size & 0x7f;
  return header;
}

function latin1(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
}


const TXXX_DESC_RE = (description: string) => new RegExp(`^${description}$`, "i");

function txxxMatches(frame: Id3FrameView, body: Uint8Array, description: string): boolean {
  if (!TXXX_DESC_RE(description).test(frame.label.replace(/^Custom Text:\s*/i, ""))) return false;
  void body;
  return true;
}

export function writeMp3Fields(
  input: Uint8Array,
  requested: Partial<Record<ProfileField, string>>,
  mode: RewriteMode,
): Mp3WriteResult {
  const changes: MetadataChange[] = [];
  const warnings: string[] = [];
  const skipped: Array<{ field: string; channel: string; reason: string }> = [];

  const probe = probeMp3(input);
  if (!probe.ok) {
    throw new CleanRefused("unsupported", probe.unsupportedReason ?? "MP3 could not be safely parsed — rewriting refused.");
  }

  // Supported writable fields from the request.
  const wanted: Array<{ field: ProfileField; frame: string; text: string }> = [];
  for (const [field, raw] of Object.entries(requested) as Array<[ProfileField, string]>) {
    const value = raw.trim();
    if (value === "") continue;
    if (field === "rightsOwner" || field === "contact") {
      skipped.push({ field, channel: "ID3", reason: "No verified ID3 frame for this field — reported unsupported rather than inventing one." });
      continue;
    }
    if (field === "company") wanted.push({ field, frame: "TPUB", text: value });
    else if (field === "creator") wanted.push({ field, frame: "TPE1", text: value });
    else if (field === "copyright") wanted.push({ field, frame: "TCOP", text: value });
    else if (field === "title") wanted.push({ field, frame: "TIT2", text: value });
    else if (field === "description") {
      if (value.length > MULTI_LINE_COMMENT_LIMIT) {
        skipped.push({ field, channel: "COMM", reason: `Comment exceeds ${MULTI_LINE_COMMENT_LIMIT} characters — refused, never truncated.` });
        continue;
      }
      wanted.push({ field, frame: "COMM", text: value });
    } else if (field === "keywords") wanted.push({ field, frame: "TXXX:KEYWORDS", text: value });
    else if (field === "locationName") wanted.push({ field, frame: "TXXX:LOCATION", text: value });
    else if (field === "website") {
      if (!/^https?:\/\/[^\s]+$/i.test(value)) {
        skipped.push({ field, channel: "WXXX", reason: "Website must be an http(s) URL — refused without a verified frame." });
        continue;
      }
      wanted.push({ field, frame: "WXXX", text: value });
    }
  }

  // No validated GPS frame exists for MP3 — a GPS request is an honest skip.
  changes.push({
    group: "GPS",
    action: "unchanged",
    verification: "verified",
    reason: "GPS coordinates are not written to MP3 (no verified interoperable ID3 GPS mapping) — requested GPS, if any, is disclosed as unsupported.",
  });

  const audioSegment = (probe: ReturnType<typeof probeMp3>, input: Uint8Array): Uint8Array => {
    // Frame-derived audio end (SOL-001/007).
    const end = probe.stream
      ? probe.stream.streamEnd
      : (() => {
        let tail = input.length;
        if (probe.id3v1) tail -= 128;
        return tail;
      })();
    return input.subarray(probe.audioStart, end);
  };

  // Replace mode: proven full cleaner first, then a fresh v2.3 tag.
  if (mode === "replace_editable") {
    const cleaned = cleanMp3(input, { mode: "privacy_safe_default", targets: ["exif_gps", "descriptive"] });
    const frames = wanted.map(({ frame, text }) => {
      if (frame === "TXXX:KEYWORDS") return txxxFrame("KEYWORDS", text, 3);
      if (frame === "TXXX:LOCATION") return txxxFrame("LOCATION", text, 3);
      if (frame === "COMM") return commFrame(text, 3);
      if (frame === "WXXX") return wxxxFrame("WEBSITE", text, 3);
      return textField(frame, text, 3);
    });
    const body = concat(frames);
    const tag = concat([tagHeader(body.length, 3), body]);
    changes.push({
      group: "ID3",
      action: "rewritten",
      verification: "not_verified",
      reason: `Fresh ID3v2.3 tag written with ${frames.length} field frame(s); replace mode removed the previous tag (artwork/lyrics included — replace mode is destructive by contract).`,
    });
    return {
      data: concat([tag, cleaned.data]),
      changes,
      warnings,
      skipped,
      writtenVersion: "v2.3",
    };
  }

  // Update mode: rebuild the tag in ITS OWN version, retaining raw frames.
  const tag = probe.tag;
  if (!tag) {
    // No tag: behaves like replace on a fresh v2.3 tag.
    const frames = wanted.map(({ frame, text }) => frame === "TXXX:KEYWORDS" ? txxxFrame("KEYWORDS", text, 3) : frame === "TXXX:LOCATION" ? txxxFrame("LOCATION", text, 3) : frame === "COMM" ? commFrame(text, 3) : frame === "WXXX" ? wxxxFrame("WEBSITE", text, 3) : textField(frame, text, 3));
    const body = concat(frames);
    return {
      data: concat([tagHeader(body.length, 3), body, audioSegment(probe, input)]),
      changes: [{ group: "ID3", action: "rewritten", verification: "not_verified", reason: `Fresh ID3v2.3 tag written with ${frames.length} field frame(s).` }],
      warnings,
      skipped,
      writtenVersion: "v2.3",
    };
  }
  if (tag.major === 2) {
    throw new CleanRefused("unsupported", "This MP3 uses ID3v2.2 — targeted update requires a safe mixed-version rebuild that this writer does not claim. Use Replace mode (fresh v2.3 tag) instead.");
  }
  const major = tag.major;
  const idLength = major === 2 ? 3 : 4;
  const headerLength = major === 2 ? 6 : 10;
  const bodyStart = 10;
  const tagEnd = bodyStart + (tag.size - 10);
  let cursor = bodyStart;
  if (tag.extendedHeader) {
    if (major === 3) cursor += ((input[cursor] << 24) | (input[cursor + 1] << 16) | (input[cursor + 2] << 8) | input[cursor + 3]) + 4;
    else cursor += ((input[cursor] & 0x7f) << 21) | ((input[cursor + 1] & 0x7f) << 14) | ((input[cursor + 2] & 0x7f) << 7) | (input[cursor + 3] & 0x7f);
  }
  const retained: Uint8Array[] = [];
  while (cursor + headerLength <= tagEnd && retained.length < 512) {
    const id = latin1(input.subarray(cursor, cursor + idLength));
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
    let frameSize: number;
    if (major === 2) frameSize = (input[cursor + 3] << 16) | (input[cursor + 4] << 8) | input[cursor + 5];
    else if (major === 4) frameSize = ((input[cursor + 4] & 0x7f) << 21) | ((input[cursor + 5] & 0x7f) << 14) | ((input[cursor + 6] & 0x7f) << 7) | (input[cursor + 7] & 0x7f);
    else frameSize = (input[cursor + 4] << 24) | (input[cursor + 5] << 16) | (input[cursor + 6] << 8) | input[cursor + 7];
    if (frameSize <= 0 || cursor + headerLength + frameSize > tagEnd) break;
    const raw = input.subarray(cursor, cursor + headerLength + frameSize);
    const body = input.subarray(cursor + headerLength, cursor + headerLength + frameSize);
    const decoded = tag.frames.find((frame) => frame.id === id && frame.size === frameSize);
    const rewritten = wanted.some(({ frame }) => {
      if (frame.startsWith("TXXX:")) {
        const description = frame.slice(5);
        return id === "TXXX" && decoded ? txxxMatches(decoded, body, description) : false;
      }
      return id === frame;
    });
    if (!rewritten) retained.push(raw);
    cursor += headerLength + frameSize;
  }

  const newFrames = wanted.map(({ frame, text }) => {
    if (frame === "TXXX:KEYWORDS") return txxxFrame("KEYWORDS", text, major);
    if (frame === "TXXX:LOCATION") return txxxFrame("LOCATION", text, major);
    if (frame === "COMM") return commFrame(text, major);
    if (frame === "WXXX") return wxxxFrame("WEBSITE", text, major);
    return textField(frame, text, major);
  });
  const body = concat([...retained, ...newFrames]);
  const newTag = concat([tagHeader(body.length, major), body]);
  // Retain only validated APEv2/Lyrics3 trailing structures (SOL-001:
  // full tag boundaries, not just footers); the stale ID3v1 tail is
  // REMOVED (its values would shadow the verified v2 output — the change
  // ledger records the removal honestly).
  const trailingStart = probe.trailing.length > 0 ? Math.min(...probe.trailing.map((structure) => structure.start)) : input.length;
  const trailingBytes = input.subarray(trailingStart);
  changes.push({
    group: "ID3",
    action: "rewritten",
    verification: "not_verified",
    reason: `ID3v2.${major} tag rebuilt: ${retained.length} frame(s) retained byte-verbatim, ${newFrames.length} field frame(s) written. Unrelated artwork/lyrics preserved.`,
  });
  if (probe.id3v1) {
    changes.push({
      group: "ID3v1",
      action: "removed",
      verification: "not_verified",
      reason: "Stale ID3v1 tail removed so its values cannot shadow the rewritten ID3v2 output.",
    });
  }
  if (tag.footer) {
    changes.push({
      group: "ID3",
      action: "removed",
      verification: "not_verified",
      reason: "ID3v2.4 tag footer dropped during rebuild (the rebuilt tag carries no footer flag).",
    });
  }
  warnings.push(...probe.trailing.map((structure) => `${structure.kind} trailing structure retained (read-only/unsupported; disclosed).`));

  return {
    data: concat([newTag, audioSegment(probe, input), trailingBytes]),
    changes,
    warnings,
    skipped,
    writtenVersion: major === 4 ? "v2.4" : "v2.3",
  };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
