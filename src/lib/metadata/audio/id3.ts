/**
 * MP3 probe + ID3 parser (Phases 07–10) — browser-only, allocation-bounded,
 * defensive against malicious/malformed tags. Parsing NEVER modifies bytes.
 *
 * Honesty rules encoded here:
 * - A valid `ID3` header alone does not prove playable audio: the MPEG
 *   stream is validated separately (frame-sync walk) and failures are
 *   reported, not guessed around.
 * - Unsupported structures (APEv2, Lyrics3, unsynchronisation quirks,
 *   unknown frames) are DETECTED and labeled — never silently dropped or
 *   mis-parsed as audio.
 * - Duration/bitrate are marked estimated unless derived from a Xing/Info
 *   header or an exact frame count.
 */

export type Id3Version = "v2.2" | "v2.3" | "v2.4";

export interface Id3FrameView {
  id: string;
  label: string;
  kind: "text" | "comment" | "lyrics" | "artwork" | "url" | "geob" | "priv" | "custom" | "unknown";
  values: string[];
  size: number;
  /** Artwork payload (local object URLs are created by the UI layer). */
  artwork?: { mime: string; bytes: Uint8Array };
  warning?: string;
}

export interface Id3TagInfo {
  version: Id3Version;
  major: number;
  unsynchronisation: boolean;
  extendedHeader: boolean;
  experimental: boolean;
  footer: boolean;
  size: number;
  frames: Id3FrameView[];
  warnings: string[];
}

export interface Id3v1Info {
  title: string;
  artist: string;
  album: string;
  year: string;
  comment: string;
  track: number | null;
  genre: number | null;
}

export interface Mp3StreamInfo {
  firstFrameOffset: number;
  frameCount: number;
  sampleRate: number | null;
  channelMode: string | null;
  bitrateKbps: number | null;
  /** Estimated duration (seconds) — exact when Xing/Info provides frames. */
  durationSeconds: number | null;
  durationExact: boolean;
  xing: boolean;
  /** MPEG version of the validated stream ("1" | "2" | "2.5"). */
  mpegVersion: "1" | "2" | "2.5" | null;
  /** Byte offset just past the last COMPLETE validated frame — the true
   *  audio end, derived from frame boundaries (SOL-007), never from
   *  file length minus footer guesses. */
  streamEnd: number;
}

export interface TrailingStructure {
  kind: "APEv2" | "Lyrics3";
  /** Inclusive start of the FULL structure (header/items/body included). */
  start: number;
  /** Exclusive end of the FULL structure (past the footer). */
  end: number;
  /** end - start, for display. */
  size: number;
}

export interface Mp3Probe {
  ok: boolean;
  unsupportedReason: string | null;
  /** Byte offset where the ID3v2 tag ends (audio starts after it). */
  audioStart: number;
  tag: Id3TagInfo | null;
  id3v1: Id3v1Info | null;
  trailing: TrailingStructure[];
  stream: Mp3StreamInfo | null;
  warnings: string[];
}

const FRAME_LABELS: Record<string, string> = {
  TIT2: "Title", TPE1: "Artist", TALB: "Album", TPE2: "Album Artist",
  TCON: "Genre", TYER: "Year", TDRC: "Date", TRCK: "Track", TPOS: "Disc",
  TCOM: "Composer", TPUB: "Publisher", TCOP: "Copyright", TOWN: "File Owner",
  TENC: "Encoded By", TBPM: "BPM", TLEN: "Length", TKEY: "Initial Key",
  TIT1: "Content Group", TIT3: "Subtitle", TMED: "Media Type", TLAN: "Language",
  TSSE: "Software/Hardware", TEXT: "Lyricist", IPLS: "Involved People",
  COMM: "Comment", USLT: "Lyrics", APIC: "Attached Picture",
  TXXX: "Custom Text", WXXX: "Custom URL", GEOB: "General Encapsulated Object",
  PRIV: "Private Frame", WOAR: "Artist URL", WOAS: "Source URL", WORS: "Radio URL",
  WPAY: "Payment URL", WPUB: "Publisher URL", WCOP: "Copyright URL",
  ETCO: "Event Timing", SYLT: "Synchronised Lyrics", MCDI: "Music CD Identifier",
  PCNT: "Play Counter", POPM: "Popularimeter", RVAD: "Relative Volume",
  EQUA: "Equalization", RVRB: "Reverb", UFID: "Unique File ID", LINK: "Linked Information",
  OWNE: "Ownership", COMR: "Commercial", ENCR: "Encryption", GRID: "Group ID",
  TT2: "Title", TP1: "Artist", TAL: "Album", TYE: "Year", TCO: "Genre",
  TRK: "Track", TCM: "Composer", TPB: "Publisher", TCR: "Copyright",
  COM: "Comment", ULT: "Lyrics", TXD: "Custom Text",
};

const MAX_TAG_BYTES = 8 * 1024 * 1024; // defensive: refuse absurd tags
const MAX_FRAMES = 512;

function synchsafeToNumber(b: Uint8Array, offset: number): number {
  return ((b[offset] & 0x7f) << 21) | ((b[offset + 1] & 0x7f) << 14) | ((b[offset + 2] & 0x7f) << 7) | (b[offset + 3] & 0x7f);
}

function uint32(b: Uint8Array, offset: number): number {
  return (b[offset] << 24) | (b[offset + 1] << 16) | (b[offset + 2] << 8) | b[offset + 3];
}

/** Little-endian u32 (APEv2 footer fields are LE per the APEv2 spec). */
function uint32LE(b: Uint8Array, offset: number): number {
  return ((b[offset] | (b[offset + 1] << 8) | (b[offset + 2] << 16) | (b[offset + 3] << 24)) >>> 0);
}

function uint24(b: Uint8Array, offset: number): number {
  return (b[offset] << 16) | (b[offset + 1] << 8) | b[offset + 2];
}

/** Decode ID3 text payload per its encoding byte (0 latin1, 1 UTF-16 w/ BOM,
 *  2 UTF-16BE, 3 UTF-8). Falls back to replacement characters, never throws. */
export function decodeText(bytes: Uint8Array, encoding: number): string {
  try {
    if (encoding === 1) {
      // UTF-16 with BOM: honor the BOM explicitly (decoder BOM handling
      // varies by runtime); FF FE → LE, FE FF → BE, none → LE per spec.
      if (bytes[0] === 0xff && bytes[1] === 0xfe) {
        return new TextDecoder("utf-16le").decode(bytes.subarray(2));
      }
      if (bytes[0] === 0xfe && bytes[1] === 0xff) {
        return new TextDecoder("utf-16be").decode(bytes.subarray(2));
      }
      return new TextDecoder("utf-16le").decode(bytes);
    }
    if (encoding === 2) {
      return new TextDecoder("utf-16be").decode(bytes);
    }
    if (encoding === 3) {
      return new TextDecoder("utf-8").decode(bytes);
    }
    return new TextDecoder("iso-8859-1").decode(bytes);
  } catch {
    return "";
  }
}

function latin1(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
}

function findTerminator(bytes: Uint8Array, start: number, encoding: number): number {
  // Returns the offset of the terminator: 0x00 (single-byte encodings) or
  // 0x00 0x00 aligned for UTF-16.
  if (encoding === 1 || encoding === 2) {
    for (let i = start; i + 1 < bytes.length; i += 2) {
      if (bytes[i] === 0x00 && bytes[i + 1] === 0x00) return i;
    }
    return bytes.length;
  }
  for (let i = start; i < bytes.length; i += 1) {
    if (bytes[i] === 0x00) return i;
  }
  return bytes.length;
}

const MP3_BITRATES_V1_L3: Record<number, number> = {
  1: 32, 2: 40, 3: 48, 4: 56, 5: 64, 6: 80, 7: 96, 8: 112, 9: 128,
  10: 160, 11: 192, 12: 224, 13: 256, 14: 320,
};

/** MPEG-2 and MPEG-2.5 Layer III bitrates (kbit/s). */
const MP3_BITRATES_V2_L3: Record<number, number> = {
  1: 8, 2: 16, 3: 24, 4: 32, 5: 40, 6: 48, 7: 56, 8: 64,
  9: 80, 10: 96, 11: 112, 12: 128, 13: 144, 14: 160,
};

const SAMPLE_RATES_V1: Record<number, number> = { 0: 44100, 1: 48000, 2: 32000 };
const SAMPLE_RATES_V2: Record<number, number> = { 0: 22050, 1: 24000, 2: 16000 };
const SAMPLE_RATES_V25: Record<number, number> = { 0: 11025, 1: 12000, 2: 8000 };

const CHANNEL_MODES = ["Stereo", "Joint stereo", "Dual channel", "Mono"] as const;

interface MpegFrameHeader {
  versionBits: number;
  bitrate: number;
  sampleRate: number;
  padding: number;
  channelBits: number;
  frameLength: number;
  samplesPerFrame: number;
  mpegVersion: "1" | "2" | "2.5";
}

/** Parse one MPEG audio frame header (bytes offset..offset+3). Returns null
 *  when the header is not a plausible Layer III frame. */
function parseMpegHeader(bytes: Uint8Array, offset: number): MpegFrameHeader | null {
  if (offset + 4 > bytes.length) return null;
  if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) return null;
  const b1 = bytes[offset + 1];
  const b2 = bytes[offset + 2];
  const versionBits = (b1 >> 3) & 0x03; // 11 = MPEG1, 10 = MPEG2, 00 = MPEG2.5
  const layerBits = (b1 >> 1) & 0x03;   // 01 = Layer III
  if (layerBits !== 1) return null;
  if (versionBits === 1) return null;   // reserved version
  const bitrateIndex = (b2 >> 4) & 0x0f;
  const sampleIndex = (b2 >> 2) & 0x03;
  const padding = (b2 >> 1) & 0x01;
  if (bitrateIndex === 0 || bitrateIndex === 15 || sampleIndex === 3) return null;
  const channelBits = (bytes[offset + 3] >> 6) & 0x03;
  let bitrate: number;
  let sampleRate: number;
  let samplesPerFrame: number;
  let frameLength: number;
  if (versionBits === 3) {
    bitrate = MP3_BITRATES_V1_L3[bitrateIndex];
    sampleRate = SAMPLE_RATES_V1[sampleIndex];
    samplesPerFrame = 1152;
    frameLength = Math.floor((144 * bitrate * 1000) / sampleRate) + padding;
  } else {
    // MPEG-2 and MPEG-2.5 Layer III: half-rate table, 72-byte formula,
    // 576 samples per frame.
    bitrate = MP3_BITRATES_V2_L3[bitrateIndex];
    sampleRate = versionBits === 2 ? SAMPLE_RATES_V2[sampleIndex] : SAMPLE_RATES_V25[sampleIndex];
    samplesPerFrame = 576;
    frameLength = Math.floor((72 * bitrate * 1000) / sampleRate) + padding;
  }
  if (frameLength < 24) return null;
  return {
    versionBits,
    bitrate,
    sampleRate,
    padding,
    channelBits,
    frameLength,
    samplesPerFrame,
    mpegVersion: versionBits === 3 ? "1" : versionBits === 2 ? "2" : "2.5",
  };
}

/**
 * Walk MPEG frame syncs from `start` and validate the stream. The stream
 * end is derived from COMPLETE frames (offset after the last whole frame
 * that stays in bounds) — never from file length minus footer guesses.
 * `firstFrameOffset` is the ACTUAL post-resynchronization sync offset.
 * A lone plausible header is not enough: at least one complete frame must
 * parse and the next frame boundary (when in bounds) must also carry a
 * plausible header — arbitrary bytes with one false sync are refused.
 */
function scanMpegStream(bytes: Uint8Array, start: number): Mp3StreamInfo | null {
  // Scan the complete materialized input.  A fixed prefix cap is unsafe here:
  // it can make a long, valid stream look complete at the cap boundary and
  // cause cleaning/rewrite to silently discard the remaining MPEG frames.
  // Callers enforce the browser memory budget before materializing bytes; this
  // walker itself uses constant auxiliary memory and refuses malformed tails.
  const scannedEnd = bytes.length;
  let offset = start;
  // Resynchronize to the first sync candidate; that offset IS the true
  // first frame offset (junk before it belongs to no frame).
  while (offset + 4 <= scannedEnd) {
    if (bytes[offset] === 0xff && (bytes[offset + 1] & 0xe0) === 0xe0 && parseMpegHeader(bytes, offset) !== null) break;
    offset += 1;
  }
  if (offset + 4 > scannedEnd) return null;
  const firstOffset = offset;

  let frames = 0;
  let firstRate: number | null = null;
  let firstBitrate: number | null = null;
  let firstMode: string | null = null;
  let firstVersion: Mp3StreamInfo["mpegVersion"] | null = null;
  let xing = false;
  let xingFrames: number | null = null;
  let streamEnd = offset; // end of the last COMPLETE frame
  while (offset + 4 <= scannedEnd) {
    const header = parseMpegHeader(bytes, offset);
    if (header === null) break;
    // The complete frame must fit inside the scanned file region.
    if (offset + header.frameLength > scannedEnd) break;
    if (frames === 0) {
      firstRate = header.sampleRate;
      firstBitrate = header.bitrate;
      firstMode = CHANNEL_MODES[header.channelBits];
      firstVersion = header.mpegVersion;
      // Xing/Info header lives in the first frame's side info area
      // (MPEG1: 17 mono / 32 multichannel; MPEG2/2.5: 9 / 17).
      const sideInfo = header.versionBits === 3
        ? 17 + (header.channelBits === 3 ? 0 : 15)
        : 9 + (header.channelBits === 3 ? 0 : 8);
      const tagStart = offset + 4 + sideInfo;
      const tag = latin1(bytes.subarray(tagStart, Math.min(tagStart + 4, bytes.length)));
      if (tag === "Xing" || tag === "Info") {
        xing = true;
        if (bytes[tagStart + 7] & 0x01 && tagStart + 12 <= scannedEnd) {
          xingFrames = uint32(bytes, tagStart + 8);
        }
      }
    }
    frames += 1;
    offset += header.frameLength;
    streamEnd = offset;
  }
  if (frames === 0) return null;
  // Corroboration rule (SOL-007): a lone plausible header in arbitrary
  // bytes must not classify a file. Require at least two consecutive
  // frames, or exactly one frame that fills the scanned region (a valid
  // single-frame file).
  if (frames === 1 && streamEnd !== scannedEnd) return null;
  const sampleRate = firstRate;
  const bitrate = firstBitrate;
  let duration: number | null = null;
  let exact = false;
  if (xing && xingFrames !== null && sampleRate) {
    duration = (xingFrames * (firstVersion === "1" ? 1152 : 576)) / sampleRate;
    exact = true;
  } else if (sampleRate) {
    duration = (frames * (firstVersion === "1" ? 1152 : 576)) / sampleRate;
  }
  return {
    firstFrameOffset: firstOffset,
    frameCount: frames,
    sampleRate,
    channelMode: firstMode,
    bitrateKbps: bitrate,
    durationSeconds: duration,
    durationExact: exact,
    xing,
    mpegVersion: firstVersion,
    streamEnd,
  };
}

/**
 * Detect trailing APEv2 / Lyrics3 structures with FULL validated byte
 * boundaries (SOL-001).
 *
 * APEv2 layout: [optional 32-byte header][items][32-byte footer]. The
 * little-endian 32-bit size field in the footer counts the footer itself
 * plus items (and the header when the header flag is set). The full tag
 * therefore starts at `footerPos + 32 - size` when the header flag is 0,
 * or `footerPos + 32 - size` as well when the flag is 1 (size already
 * includes the header) — in both cases start = footerPos + 32 - size,
 * end = footerPos + 32. All bounds are validated; ambiguous, overlapping,
 * or out-of-range structures are REFUSED (not guessed).
 *
 * Lyrics3 v2 layout: "LYRICS200"(9) + body + "LYRICS200"(9) + 6-digit
 * decimal length L, where L counts the entire tag from the FIRST
 * "LYRICS200" through the end of the length field (i.e. footerPos + 15).
 * Tag start = footerPos + 15 - L.
 *
 * `mpegStreamEnd` is the independently derived end of validated MPEG
 * frames: any structure whose computed start precedes it overlaps audio
 * and is refused (never stripped into the audio).
 */
function scanTrailing(bytes: Uint8Array, mpegStreamEnd: number): TrailingStructure[] {
  const found: TrailingStructure[] = [];
  const MAX_TRAILING = 4 * 1024 * 1024;

  // APEv2: search the footer within the last 512 bytes after the audio.
  const apeSearchStart = Math.max(mpegStreamEnd, bytes.length - 512);
  for (let i = bytes.length - 32; i >= apeSearchStart; i -= 1) {
    if (latin1(bytes.subarray(i, i + 8)) !== "APETAGEX") continue;
    const footerPos = i;
    const tagEnd = footerPos + 32;
    if (tagEnd > bytes.length) break; // truncated footer
    const size = uint32LE(bytes, footerPos + 12);
    const version = uint32LE(bytes, footerPos + 8);
    if (version < 2000 || version > 3000) break; // not a supported APE tag
    if (size < 32 || size > MAX_TRAILING) break; // implausible declared size
    const start = tagEnd - size;
    if (start < mpegStreamEnd) break; // would overlap the audio payload
    if (found.length > 0 && start < found[found.length - 1].end) break; // overlap
    found.push({ kind: "APEv2", start, end: tagEnd, size });
    break;
  }

  // Lyrics3 v2: "LYRICS200" + 6-digit length at the structure's end. The
  // tag may be followed by another trailing structure (APE) or a 128-byte
  // ID3v1 tail, so both candidate ends are probed (before APE start if
  // found, else EOF, and EOF-128 when an ID3v1 tail is present).
  const candidateEnds: number[] = [];
  if (found.length > 0) candidateEnds.push(found[found.length - 1].start);
  candidateEnds.push(bytes.length);
  if (bytes.length >= 128) candidateEnds.push(bytes.length - 128);
  for (const candidateEnd of candidateEnds) {
    const footerPos = candidateEnd - 15;
    if (footerPos <= mpegStreamEnd) continue;
    if (latin1(bytes.subarray(footerPos, footerPos + 9)) !== "LYRICS200") continue;
    const lengthField = latin1(bytes.subarray(footerPos + 9, footerPos + 15));
    if (!/^\d{6}$/.test(lengthField)) continue;
    const declared = Number.parseInt(lengthField, 10);
    if (declared < 15 || declared > MAX_TRAILING) continue;
    const start = candidateEnd - declared;
    if (start < mpegStreamEnd) continue; // would overlap the audio payload
    const overlapsApe = found.some((structure) => start < structure.end && candidateEnd > structure.start);
    if (overlapsApe) continue;
    found.push({ kind: "Lyrics3", start, end: candidateEnd, size: declared });
    break;
  }
  return found;
}

function parseId3v1(bytes: Uint8Array, offset: number): Id3v1Info | null {
  if (offset + 128 > bytes.length) return null;
  if (latin1(bytes.subarray(offset, offset + 3)) !== "TAG") return null;
  const clean = (start: number, length: number) => latin1(bytes.subarray(start, start + length)).replace(/\0[\s\S]*$/, "").trim();
  const trackByte = bytes[offset + 126];
  return {
    title: clean(offset + 3, 30),
    artist: clean(offset + 33, 30),
    album: clean(offset + 63, 30),
    year: clean(offset + 93, 4),
    comment: clean(offset + 97, 30),
    track: bytes[offset + 125] === 0x00 && trackByte !== 0 ? trackByte : null,
    genre: bytes[offset + 127] !== 255 ? bytes[offset + 127] : null,
  };
}

function decodeFrameBody(id: string, body: Uint8Array, version: number): Id3FrameView {
  const base = (kind: Id3FrameView["kind"], values: string[]): Id3FrameView => ({
    id, label: FRAME_LABELS[id] ?? `Unknown frame ${id}`, kind, values, size: body.length,
  });
  const isText = id.startsWith("T") && id !== "TXXX";
  if (isText && body.length >= 1) {
    const encoding = body[0];
    const text = decodeText(body.subarray(1), encoding);
    // v2.4 lists may be null-separated.
    const values = version === 4 && text.includes("\0") ? text.split("\0").filter((part) => part !== "") : [text];
    return base("text", values.map((value) => value.replace(/\0/g, "").trim()).filter((value) => value !== ""));
  }
  if (id === "TXXX" && body.length >= 1) {
    const encoding = body[0];
    const descEnd = findTerminator(body, 1, encoding);
    const description = decodeText(body.subarray(1, descEnd), encoding);
    const value = decodeText(body.subarray(descEnd + (encoding === 1 || encoding === 2 ? 2 : 1)), encoding);
    return { ...base("custom", [value.replace(/\0/g, "").trim()]), label: `Custom Text: ${description.trim()}` };
  }
  if ((id === "COMM" || id === "COM") && body.length >= 4) {
    const encoding = body[0];
    const language = latin1(body.subarray(1, 4));
    const descEnd = findTerminator(body, 4, encoding);
    const textStart = descEnd + (encoding === 1 || encoding === 2 ? 2 : 1);
    const text = decodeText(body.subarray(textStart), encoding);
    return { ...base("comment", [text.replace(/\0/g, "").trim()]), label: `Comment (${language})` };
  }
  if ((id === "USLT" || id === "ULT") && body.length >= 4) {
    const encoding = body[0];
    const descEnd = findTerminator(body, 4, encoding);
    const textStart = descEnd + (encoding === 1 || encoding === 2 ? 2 : 1);
    const text = decodeText(body.subarray(textStart), encoding);
    return base("lyrics", [text.replace(/\0/g, "").trim()]);
  }
  if ((id === "APIC" || id === "PIC") && body.length >= 4) {
    if (id === "APIC") {
      const mimeEnd = body.indexOf(0x00, 1);
      if (mimeEnd < 0) return { ...base("artwork", []), warning: "Malformed artwork frame (no MIME terminator)." };
      const mime = latin1(body.subarray(1, mimeEnd));
      const picType = body[mimeEnd + 1];
      const descEnd = body.indexOf(0x00, mimeEnd + 2);
      if (descEnd < 0) return { ...base("artwork", []), warning: "Malformed artwork frame (no description terminator)." };
      return {
        ...base("artwork", [picType === 3 ? "front cover" : `picture type ${picType}`]),
        artwork: { mime, bytes: body.subarray(descEnd + 1) },
      };
    }
    // v2.2 PIC: 3-byte image format instead of MIME.
    const format = latin1(body.subarray(1, 4));
    const picType = body[4];
    const descEnd = body.indexOf(0x00, 5);
    return {
      ...base("artwork", [picType === 3 ? "front cover" : `picture type ${picType}`]),
      artwork: { mime: `image/${format.toLowerCase()}`, bytes: body.subarray(descEnd + 1) },
    };
  }
  if (id === "WXXX" && body.length >= 1) {
    const encoding = body[0];
    const descEnd = findTerminator(body, 1, encoding);
    const url = decodeText(body.subarray(descEnd + (encoding === 1 || encoding === 2 ? 2 : 1)), encoding === 1 || encoding === 2 ? 0 : 0);
    return { ...base("url", [url.replace(/\0/g, "").trim()]), label: "Custom URL" };
  }
  if (id.startsWith("W")) return base("url", [latin1(body).replace(/\0/g, "").trim()]);
  if (id === "GEOB" && body.length >= 4) {
    const mimeEnd = body.indexOf(0x00, 1);
    const filenameEnd = mimeEnd >= 0 ? body.indexOf(0x00, mimeEnd + 1) : -1;
    const descEnd = filenameEnd >= 0 ? body.indexOf(0x00, filenameEnd + 1) : -1;
    if (descEnd < 0) return { ...base("geob", []), warning: "Malformed GEOB frame." };
    const mime = latin1(body.subarray(1, mimeEnd));
    const filename = latin1(body.subarray(mimeEnd + 1, filenameEnd));
    return {
      ...base("geob", [`${filename || "(unnamed)"} · ${mime || "unknown type"} · ${body.length - descEnd - 1} bytes`]),
      size: body.length,
    };
  }
  if (id === "PRIV") {
    const ownerEnd = body.indexOf(0x00, 0);
    return { ...base("priv", [ownerEnd >= 0 ? latin1(body.subarray(0, ownerEnd)) : ""]) };
  }
  return base("unknown", []);
}

/** Full ID3v2 parse with defensive bounds.
 *  Returns `{ tag: null, corruptHeader: true }` when an `ID3` signature is
 *  present but the header is unusable (absurd/truncated size) — callers
 *  must refuse rather than guess. */
export function parseId3v2(bytes: Uint8Array, offset: number): { tag: Id3TagInfo | null; end: number; corruptHeader: boolean } {
  if (offset + 10 > bytes.length) return { tag: null, end: offset, corruptHeader: false };
  if (latin1(bytes.subarray(offset, offset + 3)) !== "ID3") return { tag: null, end: offset, corruptHeader: false };
  const major = bytes[offset + 3];
  if (major < 2 || major > 4) return { tag: null, end: offset, corruptHeader: false };
  // Layout: "ID3"(3) + major(1) + revision(1) + flags(1) + synchsafe size(4).
  const flags = bytes[offset + 5];
  const size = synchsafeToNumber(bytes, offset + 6);
  const warnings: string[] = [];
  if (size <= 0 || size > MAX_TAG_BYTES || offset + 10 + size > bytes.length) {
    return { tag: null, end: offset, corruptHeader: true };
  }
  const bodyStart = offset + 10;
  // SOL-007: an ID3v2.4 tag with the footer flag carries a 10-byte footer
  // ("3DI" + version/flags + synchsafe size) immediately after the body —
  // it is part of the TAG, never part of the audio.
  const footerFlag = (flags & 0x10) !== 0;
  let tagEnd = bodyStart + size;
  if (footerFlag && major === 4) {
    const footerOk = tagEnd + 10 <= bytes.length
      && bytes[tagEnd] === 0x33 && bytes[tagEnd + 1] === 0x44 && bytes[tagEnd + 2] === 0x49; // "3DI"
    if (!footerOk) {
      warnings.push("ID3v2.4 footer flag is set but the footer is missing or malformed — the declared region is still treated as the tag end.");
    } else {
      tagEnd += 10;
    }
  }
  const frames: Id3FrameView[] = [];
  const unsynchronisation = (flags & 0x80) !== 0;
  const extendedHeader = (flags & 0x40) !== 0;
  let cursor = bodyStart;

  if (extendedHeader) {
    if (major === 3) {
      // v2.3: 4-byte size EXCLUDES the size field itself.
      const declared = uint32(bytes, cursor);
      const extSize = declared + 4;
      if (declared <= 0 || declared > MAX_TAG_BYTES || cursor + extSize > tagEnd) {
        warnings.push("ID3v2.3 extended header declares an invalid size — frame parsing stopped (data disclosed, never guessed).");
        cursor = tagEnd;
      } else {
        cursor += extSize;
      }
    } else if (major === 4) {
      // v2.4: synchsafe size INCLUDES the size field itself.
      const extSize = synchsafeToNumber(bytes, cursor);
      if (extSize < 6 || extSize > MAX_TAG_BYTES || cursor + extSize > tagEnd) {
        warnings.push("ID3v2.4 extended header declares an invalid size — frame parsing stopped (data disclosed, never guessed).");
        cursor = tagEnd;
      } else {
        cursor += extSize;
      }
    } else {
      warnings.push("Extended header in v2.2 is not supported — frame listing may be incomplete.");
    }
  }

  const idLength = major === 2 ? 3 : 4;
  const headerLength = major === 2 ? 6 : 10;
  while (cursor + headerLength <= tagEnd && frames.length < MAX_FRAMES) {
    const id = latin1(bytes.subarray(cursor, cursor + idLength));
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break; // padding reached
    let frameSize: number;
    if (major === 2) {
      frameSize = uint24(bytes, cursor + 3);
    } else if (major === 4) {
      frameSize = synchsafeToNumber(bytes, cursor + 4);
    } else {
      frameSize = uint32(bytes, cursor + 4);
    }
    // SOL-007: the frame must END within the tag — the previous `tagEnd + 1`
    // tolerance allowed one byte of bleed into the audio payload.
    if (frameSize <= 0 || cursor + headerLength + frameSize > tagEnd) {
      warnings.push(`Frame ${id} declares an invalid size — frame parsing stopped (retained data is disclosed, never guessed).`);
      break;
    }
    const body = bytes.subarray(cursor + headerLength, cursor + headerLength + frameSize);
    frames.push(decodeFrameBody(id, body, major));
    cursor += headerLength + frameSize;
  }

  if (unsynchronisation) {
    warnings.push("Unsynchronisation flag set — frames were NOT de-unsynchronised; displayed text values may be incomplete and targeted tag surgery is refused (raw bytes preserved).");
  }
  if (frames.length >= MAX_FRAMES) warnings.push("Frame count cap reached — additional frames are not listed.");

  return {
    tag: {
      version: major === 2 ? "v2.2" : major === 3 ? "v2.3" : "v2.4",
      major,
      unsynchronisation,
      extendedHeader,
      experimental: (flags & 0x20) !== 0,
      footer: footerFlag,
      size: size + 10 + (footerFlag && tagEnd !== bodyStart + size ? 10 : 0),
      frames,
      warnings,
    },
    end: tagEnd,
    corruptHeader: false,
  };
}

/** Full MP3 probe: ID3v2 + MPEG stream + ID3v1 + trailing structures. */
export function probeMp3(bytes: Uint8Array): Mp3Probe {
  const warnings: string[] = [];
  const { tag, end, corruptHeader } = parseId3v2(bytes, 0);
  if (corruptHeader) {
    // Refuse safely: the tag header exists but is unusable — never guess
    // where audio starts or pretend the tag is absent.
    return {
      ok: false,
      unsupportedReason: "The ID3v2 tag header is corrupt (invalid or truncated size) — refusing to parse rather than guessing.",
      audioStart: 0,
      tag: null,
      id3v1: null,
      trailing: [],
      stream: null,
      warnings,
    };
  }
  if (!tag) {
    // No ID3v2: maybe a bare MPEG stream (or not an MP3 at all).
    const stream = scanMpegStream(bytes, 0);
    if (!stream) {
      return {
        ok: false,
        unsupportedReason: "No valid ID3v2 tag and no MPEG audio frames found — this is not a readable MP3.",
        audioStart: 0,
        tag: null,
        id3v1: null,
        trailing: [],
        stream: null,
        warnings,
      };
    }
    return {
      ok: true,
      unsupportedReason: null,
      audioStart: 0,
      tag: null,
      id3v1: parseId3v1(bytes, bytes.length - 128),
      trailing: scanTrailing(bytes, stream.streamEnd),
      stream,
      warnings,
    };
  }
  const stream = scanMpegStream(bytes, end);
  if (!stream) {
    warnings.push("No valid MPEG audio frames after the ID3 tag — the audio payload is missing or corrupt.");
  }
  const id3v1 = parseId3v1(bytes, bytes.length - 128);
  // SOL-001: trailing boundaries are validated against the FRAME-DERIVED
  // audio end (streamEnd), never against file length minus footer guesses.
  const trailing = scanTrailing(bytes, stream ? stream.streamEnd : end);
  if (id3v1) warnings.push("ID3v1 tag present at end-of-file — its values may shadow or conflict with ID3v2 (disclosed, not resolved automatically).");
  for (const structure of trailing) {
    warnings.push(`${structure.kind} trailing structure detected (${structure.size} bytes) — read-only/unsupported, retained unchanged.`);
  }
  return {
    ok: true,
    unsupportedReason: null,
    audioStart: end,
    tag,
    id3v1,
    trailing,
    stream,
    warnings,
  };
}

/**
 * Return the independently frame-bounded MPEG payload for integrity checks.
 * A caller must treat null as a hard verification failure; falling back to
 * file-length arithmetic would reintroduce the truncation class this helper
 * exists to prevent.
 */
export function extractMp3Audio(bytes: Uint8Array): { payload: Uint8Array; frameCount: number } | null {
  const probe = probeMp3(bytes);
  if (!probe.ok || !probe.stream) return null;
  return {
    payload: bytes.subarray(probe.audioStart, probe.stream.streamEnd),
    frameCount: probe.stream.frameCount,
  };
}

/** Compare two complete MP3 payloads without relying on file-size equality. */
export function compareMp3AudioPayloads(
  beforeBytes: Uint8Array,
  afterBytes: Uint8Array,
): { ok: boolean; reason?: string } {
  const before = extractMp3Audio(beforeBytes);
  const after = extractMp3Audio(afterBytes);
  if (!before || !after) return { ok: false, reason: "MPEG stream could not be independently bounded." };
  if (before.frameCount !== after.frameCount) return { ok: false, reason: "MPEG frame count changed." };
  if (before.payload.length !== after.payload.length) return { ok: false, reason: "MPEG payload length changed." };
  for (let index = 0; index < before.payload.length; index += 1) {
    if (before.payload[index] !== after.payload[index]) return { ok: false, reason: "MPEG payload bytes changed." };
  }
  return { ok: true };
}
