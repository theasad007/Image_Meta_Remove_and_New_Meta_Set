import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareMp3AudioPayloads, decodeText, parseId3v2, probeMp3 } from "./id3";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "src", "test-fixtures");
const load = (name: string) => new Uint8Array(fs.readFileSync(path.join(FIXTURES, name)));

describe("ID3 parser (Phase 07)", () => {
  it("parses an ID3v2.3 tag with text, comment, custom and artwork frames", () => {
    const probe = probeMp3(load("mp3-id3v2.3.mp3"));
    expect(probe.ok).toBe(true);
    expect(probe.tag?.version).toBe("v2.3");
    const values = (id: string) => probe.tag?.frames.find((frame) => frame.id === id)?.values.join(" | ") ?? "";
    expect(values("TIT2")).toBe("V2.3 Harbor Noon");
    expect(values("TPE1")).toBe("Demo Artist");
    expect(values("TALB")).toBe("Demo Album");
    expect(values("TCON")).toBe("Ambient");
    expect(values("TYER")).toBe("2024");
    expect(values("TRCK")).toBe("3/12");
    expect(values("TPUB")).toBe("Demo Publisher");
    expect(values("TCOP")).toBe("© 2024 Demo");
    expect(values("COMM")).toContain("demo comment");
    const serial = probe.tag?.frames.find((frame) => frame.id === "TXXX");
    expect(serial?.label).toContain("SERIAL");
    expect(serial?.values[0]).toBe("DEMO-123");
    const art = probe.tag?.frames.find((frame) => frame.id === "APIC");
    expect(art?.artwork?.mime).toBe("image/png");
    expect((art?.artwork?.bytes.length ?? 0)).toBeGreaterThan(50);
    // MPEG stream validated: ~24 frames, 44.1 kHz, 128 kbps, mono.
    expect(probe.stream?.frameCount).toBeGreaterThanOrEqual(20);
    expect(probe.stream?.sampleRate).toBe(44100);
    expect(probe.stream?.bitrateKbps).toBe(128);
    expect(probe.stream?.channelMode).toBe("Mono");
    expect(probe.id3v1).toBeNull();
  });

  it("parses v2.4 UTF-8 text, TDRC, lyrics, extended header", () => {
    const probe = probeMp3(load("mp3-id3v2.4.mp3"));
    expect(probe.tag?.version).toBe("v2.4");
    const value = (id: string) => probe.tag?.frames.find((frame) => frame.id === id)?.values[0] ?? "";
    expect(value("TIT2")).toBe("V2.4 Unicode – Hafen");
    expect(value("TPE1")).toBe("Ünïcode Ärçst");
    expect(value("TDRC")).toBe("2024-06-01");
    expect(value("USLT")).toContain("Verse lines");
    expect(probe.tag?.extendedHeader).toBe(true);
  });

  it("parses legacy v2.2 3-byte frames", () => {
    const probe = probeMp3(load("mp3-id3v2.2.mp3"));
    expect(probe.tag?.version).toBe("v2.2");
    const title = probe.tag?.frames.find((frame) => frame.id === "TT2");
    expect(title?.values[0]).toBe("V2.2 Title");
    expect(probe.tag?.frames.some((frame) => frame.id === "PIC" && frame.kind === "artwork")).toBe(true);
  });

  it("detects an ID3v1 tail and discloses the v1/v2 coexistence", () => {
    const v1Only = probeMp3(load("mp3-id3v1.mp3"));
    expect(v1Only.tag).toBeNull();
    expect(v1Only.id3v1?.title).toBe("Legacy Tail");
    expect(v1Only.id3v1?.track).toBe(7);
    expect(v1Only.stream?.frameCount).toBeGreaterThan(0);

    const both = probeMp3(load("mp3-v2-and-v1.mp3"));
    expect(both.tag?.frames.find((frame) => frame.id === "TIT2")?.values[0]).toBe("V2 Wins");
    expect(both.id3v1?.title).toBe("Stale V1");
    expect(both.warnings.join(" ")).toMatch(/ID3v1/);
  });

  it("reports APEv2 trailing structures as read-only/unsupported", () => {
    const probe = probeMp3(load("mp3-ape-trailing.mp3"));
    expect(probe.trailing.some((structure) => structure.kind === "APEv2")).toBe(true);
    expect(probe.warnings.join(" ")).toMatch(/APEv2/);
    expect(probe.stream?.frameCount).toBeGreaterThan(0);
  });

  it("SOL-001: APEv2 full-tag boundaries include items, not just the footer", () => {
    const probe = probeMp3(load("mp3-ape-trailing.mp3"));
    const ape = probe.trailing.find((structure) => structure.kind === "APEv2");
    expect(ape).toBeDefined();
    const bytes = load("mp3-ape-trailing.mp3");
    // The claimed region contains the item text.
    const region = Buffer.from(bytes.subarray(ape!.start, ape!.end)).toString("latin1");
    expect(region).toContain("APE Title");
    expect(region).toContain("APE Artist");
    // The tag ends exactly at EOF and starts at/after the audio end.
    expect(ape!.end).toBe(bytes.length);
    expect(ape!.start).toBeGreaterThanOrEqual(probe.stream!.streamEnd);
  });

  it("SOL-001: APEv2 header+footer form covers both copies in one structure", () => {
    const bytes = load("mp3-ape-header-footer.mp3");
    const probe = probeMp3(bytes);
    const ape = probe.trailing.find((structure) => structure.kind === "APEv2");
    expect(ape).toBeDefined();
    // Declared size (header + items + footer) matches the byte span and
    // the tag ends exactly at EOF.
    expect(ape!.size).toBe(bytes.length - ape!.start);
    expect(ape!.end).toBe(bytes.length);
    // The header copy's APETAGEX signature lies inside the claimed region.
    const region = Buffer.from(bytes.subarray(ape!.start, ape!.end)).toString("latin1");
    expect(region.indexOf("APETAGEX")).toBeGreaterThan(-1);
  });

  it("SOL-001: Lyrics3 v2 body start is derived from the 6-digit length field", () => {
    const bytes = load("mp3-lyrics3.mp3");
    const probe = probeMp3(bytes);
    const lyrics = probe.trailing.find((structure) => structure.kind === "Lyrics3");
    expect(lyrics).toBeDefined();
    const region = Buffer.from(bytes.subarray(lyrics!.start, lyrics!.end)).toString("latin1");
    // The full body (including the BEGINNING marker) is inside the structure.
    expect(region.startsWith("LYRICS200")).toBe(true);
    expect(region).toContain("First lyric line");
    expect(lyrics!.end).toBe(bytes.length);
    expect(lyrics!.start).toBeGreaterThanOrEqual(probe.stream!.streamEnd);
  });

  it("SOL-001: Lyrics3 + ID3v1 combined tail is fully bounded (body not read as audio)", () => {
    const bytes = load("mp3-lyrics3-id3v1.mp3");
    const probe = probeMp3(bytes);
    expect(probe.trailing.find((structure) => structure.kind === "Lyrics3")).toBeDefined();
    expect(probe.id3v1?.title).toBe("After Lyrics3");
    // The MPEG stream ends BEFORE the Lyrics3 body: no lyric bytes in audio.
    const audioText = Buffer.from(bytes.subarray(probe.audioStart, probe.stream!.streamEnd)).toString("latin1");
    expect(audioText).not.toContain("LYRICS200");
    expect(audioText).not.toContain("Combined tag lyrics");
  });

  it("SOL-001: oversized APEv2 declared size is refused, never stripped into audio", () => {
    const bytes = load("mp3-ape-oversized.mp3");
    const probe = probeMp3(bytes);
    expect(probe.trailing).toHaveLength(0);
    // Audio payload (12 frames × 417 B) is still fully intact.
    expect(probe.stream?.frameCount).toBe(12);
    expect(probe.stream!.streamEnd).toBe(probe.audioStart + 12 * 417);
  });

  it("SOL-001: unsupported APE version (1997) is refused, not claimed removed", () => {
    const probe = probeMp3(load("mp3-ape-oldversion.mp3"));
    expect(probe.trailing).toHaveLength(0);
    expect(probe.stream?.frameCount).toBe(12);
  });

  it("SOL-007: a lone false sync in arbitrary bytes does not classify as MP3", () => {
    const probe = probeMp3(load("mp3-false-sync.mp3"));
    expect(probe.ok).toBe(false);
    expect(probe.stream).toBeNull();
    expect(probe.unsupportedReason ?? "").toMatch(/No valid ID3v2 tag and no MPEG/);
  });

  it("SOL-007: MPEG-2 and MPEG-2.5 Layer III streams are validated with correct frame lengths", () => {
    // MPEG-2 Layer III: version bits 10 → b1 = 0xf3; 22050 Hz (sr idx 00),
    // 32 kbps (bitrate idx 4 in the halved table) → 72*32000/22050 = 104 B.
    const len2 = Math.floor((72 * 32000) / 22050);
    const f2 = Buffer.concat([Buffer.from([0xff, 0xf3, 0x40, 0xc0]), Buffer.alloc(len2 - 4, 0)]);
    const p2 = probeMp3(Buffer.concat(Array.from({ length: 8 }, () => f2)));
    expect(p2.ok).toBe(true);
    expect(p2.stream?.frameCount).toBe(8);
    expect(p2.stream?.mpegVersion).toBe("2");
    expect(p2.stream?.sampleRate).toBe(22050);

    // MPEG-2.5 Layer III: version bits 00 → b1 = 0xe3; 11025 Hz, 32 kbps.
    const len25 = Math.floor((72 * 32000) / 11025);
    const f25 = Buffer.concat([Buffer.from([0xff, 0xe3, 0x40, 0xc0]), Buffer.alloc(len25 - 4, 0)]);
    const p25 = probeMp3(Buffer.concat(Array.from({ length: 8 }, () => f25)));
    expect(p25.ok).toBe(true);
    expect(p25.stream?.mpegVersion).toBe("2.5");
    expect(p25.stream?.sampleRate).toBe(11025);
  });

  it("SOL-007: streamEnd comes from complete frames, junk after the last frame is not audio", () => {
    const bytes = load("mp3-untagged.mp3");
    const probe = probeMp3(bytes);
    expect(probe.stream!.streamEnd).toBe(24 * 417);
    expect(probe.stream!.firstFrameOffset).toBe(0);
  });

  it("independent integrity comparison detects a missing complete MPEG frame", () => {
    const input = load("mp3-untagged.mp3");
    const truncated = input.subarray(0, input.length - 417);
    const comparison = compareMp3AudioPayloads(input, truncated);
    expect(comparison.ok).toBe(false);
    expect(comparison.reason).toMatch(/frame count|payload length/i);
  });

  it("SOL-007: junk prefix before a valid stream yields the actual first frame offset", () => {
    const junk = new Uint8Array([0x00, 0x13, 0x66, 0x54, 0x11, 0x22]);
    const audio = load("mp3-untagged.mp3");
    const padded = new Uint8Array(junk.length + audio.length);
    padded.set(junk, 0);
    padded.set(audio, junk.length);
    const probe = probeMp3(padded);
    expect(probe.ok).toBe(true);
    expect(probe.stream!.firstFrameOffset).toBe(junk.length);
    expect(probe.stream!.frameCount).toBe(24);
    expect(probe.stream!.streamEnd).toBe(junk.length + 24 * 417);
  });

  it("SOL-007: fuzz corpus (random + signature-bearing bytes) never throws or misclassifies", () => {
    // Deterministic PRNG for reproducibility.
    let seed = 0x2f6e2b1;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const signatures = ["ID3", "APETAGEX", "LYRICS200", "TAG", "3DI"];
    for (let round = 0; round < 200; round += 1) {
      const size = 8 + Math.floor(next() * 2048);
      const bytes = new Uint8Array(size);
      for (let i = 0; i < size; i += 1) bytes[i] = Math.floor(next() * 256);
      // Sprinkle signature fragments.
      for (const sig of signatures) {
        if (next() < 0.3) {
          const pos = Math.floor(next() * Math.max(1, size - sig.length));
          for (let i = 0; i < sig.length && pos + i < size; i += 1) bytes[pos + i] = sig.charCodeAt(i);
        }
      }
      // Must never throw; result classification must be internally consistent.
      const probe = probeMp3(bytes);
      if (probe.ok && probe.stream) {
        expect(probe.stream.streamEnd).toBeLessThanOrEqual(bytes.length);
        expect(probe.stream.firstFrameOffset).toBeLessThanOrEqual(probe.stream.streamEnd);
      } else {
        expect(probe.unsupportedReason).toBeTruthy();
      }
    }
  });

  it("fails honestly on corrupted tag sizes, truncation and spoofed files", () => {
    const corrupt = probeMp3(load("mp3-corrupted-size.mp3"));
    expect(corrupt.ok).toBe(false);
    expect(corrupt.unsupportedReason).toMatch(/corrupt/i);
    expect(corrupt.stream).toBeNull();

    const truncated = probeMp3(load("mp3-truncated.mp3"));
    // 200 raw bytes may still contain partial syncs — must never claim a healthy full stream.
    if (truncated.stream) {
      expect(truncated.stream.frameCount).toBeLessThan(24);
    }

    const spoof = probeMp3(load("mp3-spoofed.mp3"));
    expect(spoof.ok).toBe(false);
    expect(spoof.unsupportedReason).toMatch(/not a readable MP3|No valid/);
    // Corrupt ID3 header: refuse with an actionable reason (never guess).
    expect(corrupt.unsupportedReason).toMatch(/corrupt/i);
    expect(corrupt.stream).toBeNull();
  });

  it("flags the unsynchronisation flag honestly", () => {
    const probe = probeMp3(load("mp3-unsynchronised.mp3"));
    expect(probe.tag?.unsynchronisation).toBe(true);
    expect(probe.tag?.warnings.join(" ")).toMatch(/Unsynchronisation/);
    // The title survives de-unsynchronisation.
    expect(probe.tag?.frames.find((frame) => frame.id === "TIT2")?.values[0]).toBe("Unsynced");
  });

  it("surfaces GEOB carriers for the AI/C2PA phase", () => {
    const c2pa = probeMp3(load("mp3-geob-c2pa.mp3"));
    const geob = c2pa.tag?.frames.find((frame) => frame.id === "GEOB");
    expect(geob?.kind).toBe("geob");
    expect(geob?.values[0]).toMatch(/c2pa/i);

    const other = probeMp3(load("mp3-geob-other.mp3"));
    expect(other.tag?.frames.find((frame) => frame.id === "GEOB")?.values[0]).toMatch(/x-demo/);
  });

  it("decodes ID3 text encodings without throwing on bad input", () => {
    expect(decodeText(new Uint8Array([0x48, 0x69]), 0)).toBe("Hi");
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x48, 0x00, 0x69, 0x00]), 1)).toBe("Hi");
    expect(decodeText(new Uint8Array([0x00, 0x48, 0x00, 0x69]), 2)).toBe("Hi");
    expect(decodeText(new Uint8Array([0x48, 0xc3, 0xa9]), 3)).toBe("Hé");
    expect(decodeText(new Uint8Array([0xff, 0xff]), 0)).not.toBeNull();
  });

  it("does not misread a v2.3 size as synchsafe", () => {
    // A frame of size 0x01000000 would corrupt synchsafe parsing.
    const bytes = load("mp3-id3v2.3.mp3");
    const { tag } = parseId3v2(bytes, 0);
    expect(tag).not.toBeNull();
    expect(tag?.frames.length).toBeGreaterThan(10);
  });
});
