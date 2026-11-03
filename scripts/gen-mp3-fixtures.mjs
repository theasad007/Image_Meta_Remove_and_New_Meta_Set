/**
 * MP3 fixture generator (Phases 07–11) — writes small, locally playable
 * MPEG-1 Layer III files with controlled ID3 tag structures into
 * src/test-fixtures/. Run: node scripts/gen-mp3-fixtures.mjs
 *
 * All fixtures are synthesized in-repo (no external downloads, no
 * licensing concerns): silent MPEG Layer III frames (44.1 kHz, 128 kbps,
 * mono) plus hand-built ID3v1 / ID3v2.2 / v2.3 / v2.4 tags, artwork,
 * lyrics, AI-evidence frames, a GEOB carrier, trailing APEv2, and
 * corrupted/truncated cases for honest failure paths.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "test-fixtures");
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- MPEG frames

/** One silent MPEG-1 Layer III frame: 44.1 kHz, 128 kbps, mono → 417 B.
 *  Byte 2: bitrate index 9 (128 kbps) + sample rate 00 (44.1 kHz).
 *  Byte 3: channel mode 11 = mono. */
function mpegFrame() {
  const header = Buffer.from([0xff, 0xfb, 0x90, 0xc0]);
  const body = Buffer.alloc(417 - 4, 0);
  return Buffer.concat([header, body]);
}

function audioPayload(frames = 24) {
  return Buffer.concat(Array.from({ length: frames }, mpegFrame));
}

// ---------------------------------------------------------------- ID3 builders

/** Synchsafe integer (4 × 7-bit). */
function synchsafe(value) {
  return Buffer.from([
    (value >> 21) & 0x7f,
    (value >> 14) & 0x7f,
    (value >> 7) & 0x7f,
    value & 0x7f,
  ]);
}

function textFrame(id, text, encoding = 0x00) {
  // Encoding 0 = ISO-8859-1, 1 = UTF-16 w/ BOM, 3 = UTF-8 (v2.4 only).
  const textBytes = encoding === 1
    ? Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")])
    : encoding === 3
      ? Buffer.from(text, "utf8")
      : Buffer.from(text, "latin1");
  const payload = Buffer.concat([Buffer.from([encoding]), textBytes]);
  return frameFor(id, payload);
}

function frameFor(id, payload, version = 3) {
  if (version === 2) {
    // v2.2: 3-byte id + 3-byte size (not synchsafe).
    const size = Buffer.from([(payload.length >> 16) & 0xff, (payload.length >> 8) & 0xff, payload.length & 0xff]);
    return Buffer.concat([Buffer.from(id, "latin1"), size, payload]);
  }
  const size = version === 4 ? synchsafe(payload.length) : Buffer.from([(payload.length >> 24) & 0xff, (payload.length >> 16) & 0xff, (payload.length >> 8) & 0xff, payload.length & 0xff]);
  const flags = Buffer.from([0x00, 0x00]);
  return Buffer.concat([Buffer.from(id, "latin1"), size, flags, payload]);
}

function commFrame(text, version = 3) {
  const enc = Buffer.from([0x00]);
  const lang = Buffer.from("eng", "latin1");
  const desc = Buffer.from([0x00]);
  return frameFor("COMM", Buffer.concat([enc, lang, desc, Buffer.from(text, "latin1")]), version);
}

function usltFrame(text, version = 3) {
  const enc = Buffer.from([0x00]);
  const lang = Buffer.from("eng", "latin1");
  const desc = Buffer.from([0x00]);
  return frameFor("USLT", Buffer.concat([enc, lang, desc, Buffer.from(text, "latin1")]), version);
}

function txxxFrame(description, value, version = 3) {
  const enc = Buffer.from([0x00]);
  return frameFor("TXXX", Buffer.concat([enc, Buffer.from(description, "latin1"), Buffer.from([0x00]), Buffer.from(value, "latin1")]), version);
}

function apicFrame({ mime = "image/png", description = "cover", png = null, version = 3 } = {}) {
  // 1×1 transparent PNG.
  const art = png ?? Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  );
  const enc = Buffer.from([0x00]);
  const mimeBytes = Buffer.from(mime, "latin1");
  const zero = Buffer.from([0x00]);
  const picType = Buffer.from([0x03]); // front cover
  const desc = Buffer.from(description, "latin1");
  return frameFor(version === 2 ? "PIC" : "APIC", Buffer.concat([enc, mimeBytes, zero, picType, desc, zero, art]), version);
}

function geobFrame(mime, filename, description, content, version = 3) {
  const enc = Buffer.from([0x00]);
  return frameFor("GEOB", Buffer.concat([
    enc,
    Buffer.from(mime, "latin1"), Buffer.from([0x00]),
    Buffer.from(filename, "latin1"), Buffer.from([0x00]),
    Buffer.from(description, "latin1"), Buffer.from([0x00]),
    content,
  ]), version);
}

function id3v2({ version = 3, frames, unsynchronisation = false, extendedHeader = false }) {
  const body = Buffer.concat(frames);
  const flags = (unsynchronisation ? 0x80 : 0x00) | (extendedHeader ? 0x40 : 0x00);
  const ext = extendedHeader
    ? (version === 4
        // v2.4: ext size is synchsafe and INCLUDES itself → exactly 6 bytes:
        // size(4, synchsafe 6) + flags(1) + padding-size(1).
        ? Buffer.concat([synchsafe(6), Buffer.from([0x01, 0x00])])
        // v2.3: ext size EXCLUDES itself (4-byte int) → 6 + 4 = 10 bytes:
        // size(4) + flags(2) + padding-size(4).
        : Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x06]), Buffer.from([0x01, 0x00]), Buffer.from([0x00, 0x00, 0x00, 0x00])]))
    : Buffer.alloc(0);
  const fullBody = Buffer.concat([ext, body]);
  return Buffer.concat([
    Buffer.from("ID3"),
    Buffer.from([version, 0x00, flags]),
    synchsafe(fullBody.length),
    fullBody,
  ]);
}

function id3v1({ title, artist, album, year, comment, track, genre = 255 }) {
  const tag = Buffer.alloc(128, 0x00);
  tag.write("TAG", 0, "latin1");
  tag.write(title.slice(0, 30), 3, "latin1");
  tag.write(artist.slice(0, 30), 33, "latin1");
  tag.write(album.slice(0, 30), 63, "latin1");
  tag.write(year.slice(0, 4), 93, "latin1");
  tag.write(comment.slice(0, 28), 97, "latin1");
  tag[125] = 0x00;
  tag[126] = track;
  tag[127] = genre;
  return tag;
}

function apeItems({ title, artist }) {
  const item = (key, value) => {
    const keyBuf = Buffer.from(key, "latin1");
    const valBuf = Buffer.from(value, "latin1");
    const size = Buffer.alloc(4);
    size.writeUInt32LE(valBuf.length, 0);
    const flags = Buffer.alloc(4);
    flags.writeUInt32LE(0, 0);
    return Buffer.concat([size, flags, keyBuf, Buffer.from([0x00]), valBuf]);
  };
  return Buffer.concat([item("Title", title), item("Artist", artist)]);
}

/** APEv2 tag per the APEv2 spec. The size field counts items + footer
 *  (+ the 32-byte header when `withHeader`). Flags: bit31 = contains a
 *  header, bit29 = this copy is the header (0 for the footer). */
function apeTag({ title, artist, withHeader = false }) {
  const items = apeItems({ title, artist });
  const header = Buffer.alloc(32);
  const footer = Buffer.alloc(32);
  const size = 32 + items.length + (withHeader ? 32 : 0);
  for (const [buf, isHeader] of [[header, true], [footer, false]]) {
    buf.write("APETAGEX", 0, "latin1");
    buf.writeUInt32LE(2000, 8); // version 2000
    buf.writeUInt32LE(size, 12);
    buf.writeUInt32LE(2, 16); // item count
    buf.writeUInt32LE(((withHeader ? 0x80000000 : 0) | (isHeader ? 0x20000000 : 0)) >>> 0, 20);
  }
  return Buffer.concat([...(withHeader ? [header] : []), items, footer]);
}

/** Lyrics3 v2 tag: "LYRICS200"(9) + body + "LYRICS200"(9) + 6-digit size.
 *  The 6-digit size counts the ENTIRE tag from the first "LYRICS200"
 *  through the end of the size field itself. */
function lyrics3v2(body) {
  const marker = Buffer.from("LYRICS200", "latin1");
  const declared = 9 + body.length + 9 + 6;
  return Buffer.concat([marker, body, marker, Buffer.from(String(declared).padStart(6, "0"), "latin1")]);
}

// ---------------------------------------------------------------- fixtures

const write = (name, buffer) => {
  fs.writeFileSync(path.join(OUT, name), buffer);
  console.log(`✓ ${name} (${buffer.length} bytes)`);
};

const AUDIO = audioPayload(24);

// 1. Bare, untagged audio.
write("mp3-untagged.mp3", AUDIO);

// 2. ID3v1 only.
write("mp3-id3v1.mp3", Buffer.concat([AUDIO, id3v1({ title: "Legacy Tail", artist: "V1 Artist", album: "V1 Album", year: "1999", comment: "v1 comment", track: 7 })]));

// 3. ID3v2.3 with full text set + artwork + comment + custom TXXX.
write("mp3-id3v2.3.mp3", Buffer.concat([
  id3v2({
    version: 3,
    frames: [
      textFrame("TIT2", "V2.3 Harbor Noon"),
      textFrame("TPE1", "Demo Artist"),
      textFrame("TALB", "Demo Album"),
      textFrame("TCON", "Ambient"),
      textFrame("TYER", "2024"),
      textFrame("TRCK", "3/12"),
      textFrame("TPE2", "Demo Album Artist"),
      textFrame("TCOM", "Demo Composer"),
      textFrame("TPUB", "Demo Publisher"),
      textFrame("TCOP", "© 2024 Demo"),
      commFrame("A demo comment for verification."),
      txxxFrame("SERIAL", "DEMO-123"),
      apicFrame({}),
    ],
  }),
  AUDIO,
]));

// 4. ID3v2.4 with UTF-8, TDRC date, lyrics and an extended header.
write("mp3-id3v2.4.mp3", Buffer.concat([
  id3v2({
    version: 4,
    extendedHeader: true,
    frames: [
      textFrame("TIT2", "V2.4 Unicode – Hafen", 3),
      textFrame("TPE1", "Ünïcode Ärçst", 3),
      textFrame("TALB", "Album – ö", 3),
      textFrame("TDRC", "2024-06-01", 3),
      textFrame("TRCK", "5", 3),
      textFrame("TCON", "Electronic", 3),
      usltFrame("Verse lines for the demo lyrics.", 4),
      apicFrame({ version: 4 }),
    ],
  }),
  AUDIO,
]));

// 5. ID3v2.2 (3-byte frame ids: TT2/TP1/TAL/TYE/TCO).
write("mp3-id3v2.2.mp3", Buffer.concat([
  id3v2({
    version: 2,
    frames: [
      frameFor("TT2", Buffer.concat([Buffer.from([0x00]), Buffer.from("V2.2 Title", "latin1")]), 2),
      frameFor("TP1", Buffer.concat([Buffer.from([0x00]), Buffer.from("V2.2 Artist", "latin1")]), 2),
      frameFor("TAL", Buffer.concat([Buffer.from([0x00]), Buffer.from("V2.2 Album", "latin1")]), 2),
      frameFor("TYE", Buffer.concat([Buffer.from([0x00]), Buffer.from("2001", "latin1")]), 2),
      frameFor("PIC", apicFrame({ version: 2 }).subarray(10), 2),
    ],
  }),
  AUDIO,
]));

// 6. AI-evidence tags (qualified tool identifiers in TXXX/COMM).
write("mp3-ai-tags.mp3", Buffer.concat([
  id3v2({
    version: 3,
    frames: [
      textFrame("TIT2", "Synth Track"),
      txxxFrame("AI_GENERATOR", "stable-diffusion-audio v2"),
      txxxFrame("DigitalSourceType", "trainedAlgorithmicMedia"),
      commFrame("Generated with comfyui pipeline 7"),
      textFrame("TPE1", "Regular Artist"),
    ],
  }),
  AUDIO,
]));

// 7. GEOB carrier with a C2PA-shaped manifest (detection only — this is
// NOT a cryptographically signed fixture and must never claim validation).
const fakeManifest = Buffer.from(JSON.stringify({
  manifests: { "urn:c2pa:not-signed": { claim_generator: "demo/1.0", signature: "not-a-real-signature" } },
}), "utf8");
write("mp3-geob-c2pa.mp3", Buffer.concat([
  id3v2({
    version: 3,
    frames: [
      geobFrame("application/rdf+xml", "c2pa", "manifest", fakeManifest),
      textFrame("TIT2", "GEOB Carrier"),
    ],
  }),
  AUDIO,
]));

// 8. Non-C2PA GEOB (unrelated encapsulated object).
write("mp3-geob-other.mp3", Buffer.concat([
  id3v2({
    version: 3,
    frames: [
      geobFrame("application/x-demo", "packet.bin", "demo packet", Buffer.from("binary-ish payload", "latin1")),
      textFrame("TIT2", "Other GEOB"),
    ],
  }),
  AUDIO,
]));

// 9. APEv2 trailing tag, footer-only form (spec-correct: size = items+footer).
write("mp3-ape-trailing.mp3", Buffer.concat([
  id3v2({ version: 3, frames: [textFrame("TIT2", "APE Tail")] }),
  AUDIO,
  apeTag({ title: "APE Title", artist: "APE Artist" }),
]));

// 9b. APEv2 with header AND footer (size includes both copies).
write("mp3-ape-header-footer.mp3", Buffer.concat([
  id3v2({ version: 3, frames: [textFrame("TIT2", "APE Both")] }),
  AUDIO,
  apeTag({ title: "APE Headered", artist: "APE Artist", withHeader: true }),
]));

// 9c. Lyrics3 v2 body + footer.
write("mp3-lyrics3.mp3", Buffer.concat([
  id3v2({ version: 3, frames: [textFrame("TIT2", "Lyrics3 Tail")] }),
  AUDIO,
  lyrics3v2(Buffer.from("[00:12]First lyric line\n[00:25]Second lyric line", "latin1")),
]));

// 9d. Lyrics3 v2 + stale ID3v1 tail (body must not leak through as audio).
write("mp3-lyrics3-id3v1.mp3", Buffer.concat([
  id3v2({ version: 3, frames: [textFrame("TIT2", "Lyrics3 + V1")] }),
  AUDIO,
  lyrics3v2(Buffer.from("[01:00]Combined tag lyrics", "latin1")),
  id3v1({ title: "After Lyrics3", artist: "V1 Artist", album: "V1", year: "2002", comment: "", track: 2 }),
]));

// 9e. ADVERSARIAL APEv2: footer declares an oversized tag size (would
// overlap the audio). The parser must REFUSE, never strip audio bytes.
{
  const audio = audioPayload(12);
  const items = apeItems({ title: "Evil APE", artist: "Evil" });
  const footer = Buffer.alloc(32);
  footer.write("APETAGEX", 0, "latin1");
  footer.writeUInt32LE(2000, 8);
  footer.writeUInt32LE(audio.length + 4096, 12); // oversized declared size
  footer.writeUInt32LE(2, 16);
  footer.writeUInt32LE(0x80000000, 20);
  write("mp3-ape-oversized.mp3", Buffer.concat([audio, items, footer]));
}

// 9f. ADVERSARIAL APEv2: version 1997 (unsupported) → refused, not stripped.
{
  const audio = audioPayload(12);
  const footer = Buffer.alloc(32);
  footer.write("APETAGEX", 0, "latin1");
  footer.writeUInt32LE(1997, 8);
  footer.writeUInt32LE(32, 12);
  footer.writeUInt32LE(0, 16);
  footer.writeUInt32LE(0x80000000, 20);
  write("mp3-ape-oldversion.mp3", Buffer.concat([audio, footer]));
}

// 15. False sync: junk bytes + one plausible frame header + random bytes.
//     The lone header must NOT classify this as MP3 audio (corroboration).
{
  const header = Buffer.from([0xff, 0xfb, 0x90, 0xc0]);
  const junk = Buffer.from([0x11, 0x22, 0x33, 0x44]);
  const noise = Buffer.alloc(300);
  for (let i = 0; i < noise.length; i += 1) noise[i] = (i * 37 + 11) & 0xff;
  write("mp3-false-sync.mp3", Buffer.concat([junk, header, noise]));
}

// 10. ID3v2.3 + ID3v1 both present (v1 shadows/stale conflict case).
write("mp3-v2-and-v1.mp3", Buffer.concat([
  id3v2({ version: 3, frames: [textFrame("TIT2", "V2 Wins"), textFrame("TPE1", "V2 Artist")] }),
  AUDIO,
  id3v1({ title: "Stale V1", artist: "Stale Artist", album: "Stale", year: "1990", comment: "", track: 1 }),
]));

// 11. Corrupted ID3 size (declares more data than exists → unsupported).
const corrupt = Buffer.concat([
  Buffer.from("ID3"),
  Buffer.from([3, 0, 0]),
  Buffer.from([0x7f, 0x7f, 0x7f, 0x7f]), // absurd synchsafe size
  AUDIO,
]);
write("mp3-corrupted-size.mp3", corrupt);

// 12. Truncated mid-frame.
write("mp3-truncated.mp3", AUDIO.subarray(0, 200));

// 13. Unsynchronisation flag set (v2.3) — parser must report it honestly.
{
  const frames = Buffer.concat([textFrame("TIT2", "Unsynced")]);
  // Apply unsynchronisation: FF 00 → FF 00 00.
  const unsynced = [];
  for (const byte of frames) {
    unsynced.push(byte);
    if (byte === 0xff) unsynced.push(0x00);
  }
  const body = Buffer.from(unsynced);
  const header = Buffer.concat([
    Buffer.from("ID3"),
    Buffer.from([3, 0, 0x80]),
    synchsafe(body.length),
  ]);
  write("mp3-unsynchronised.mp3", Buffer.concat([header, body, AUDIO]));
}

// 14. Non-MP3 bytes with an .mp3 extension (spoof attempt → must be rejected).
write("mp3-spoofed.mp3", Buffer.concat([Buffer.from("RIFF0000WAVEfmt "), Buffer.alloc(64, 0x00)]));

console.log("\nMP3 fixtures written to", OUT);
