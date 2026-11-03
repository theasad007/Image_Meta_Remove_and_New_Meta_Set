import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { probeMp3 } from "./id3";
import { cleanMp3 } from "./clean-mp3";
import { verifyCleanedImage } from "../verify/verify";
import { inspectAudio } from "./inspect-audio";
import type { CleaningPolicy } from "../clean/types";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "src", "test-fixtures");
const load = (name: string) => new Uint8Array(fs.readFileSync(path.join(FIXTURES, name)));

const FULL_REMOVAL: CleaningPolicy = { mode: "privacy_safe_default", targets: ["exif_gps", "descriptive"] };
const AI_ONLY: CleaningPolicy = { mode: "privacy_safe_default", targets: ["ai_markers"] };

/** The MPEG audio segment bytes (tag end → trailing structures). */
function audioSegmentOf(bytes: Uint8Array): Uint8Array {
  const probe = probeMp3(bytes);
  const end = probe.stream
    ? probe.stream.streamEnd
    : (() => {
      let tail = bytes.length;
      if (probe.id3v1) tail -= 128;
      return tail;
    })();
  return bytes.subarray(probe.audioStart, end);
}

async function verifyMp3(name: string, policy: CleaningPolicy) {
  const inputBytes = load(name);
  const before = await inspectAudio("before", new Blob([inputBytes]), name);
  return verifyCleanedImage({
    fileId: name,
    inputName: name,
    extension: "mp3",
    kind: "mp3-audio",
    inputBytes,
    before,
    policy,
    inspectOutput: (id, source, outName) => inspectAudio(id, new Blob([new Uint8Array(source as ArrayBuffer)]), outName),
  });
}

describe("MP3 cleaning engine (Phase 09)", () => {
  const longBareStream = (minimumBytes: number): Uint8Array => {
    const fixture = load("mp3-untagged.mp3");
    const tagged = load("mp3-id3v2.3.mp3");
    const tagEnd = probeMp3(tagged).audioStart;
    const tag = tagged.subarray(0, tagEnd);
    const frameBytes = fixture.subarray(0, 417); // MPEG-1 Layer III 128 kbps frame.
    const frameCount = Math.ceil(minimumBytes / frameBytes.length);
    const stream = new Uint8Array(tag.length + frameCount * frameBytes.length);
    stream.set(tag, 0);
    for (let index = 0; index < frameCount; index += 1) {
      stream.set(frameBytes, tag.length + index * frameBytes.length);
    }
    return stream;
  };

  it.each([
    [4 * 1024 * 1024 + 1, "over 4 MiB"],
    [8 * 1024 * 1024 + 1, "over 8 MiB"],
    [16 * 1024 * 1024 + 1, "over 16 MiB"],
  ])("scans and cleans a complete stream %s (%s) without truncation", async (minimumBytes) => {
    const input = longBareStream(minimumBytes);
    const before = probeMp3(input);
    expect(before.ok).toBe(true);
    expect(before.stream?.streamEnd).toBe(input.length);
    const result = cleanMp3(input, FULL_REMOVAL);
    const originalAudio = input.subarray(before.audioStart, before.stream!.streamEnd);
    expect(result.data.length).toBe(originalAudio.length);
    for (let index = 0; index < originalAudio.length; index += 1) {
      expect(result.data[index]).toBe(originalAudio[index]);
    }
    const verified = await verifyCleanedImage({
      fileId: `long-${minimumBytes}`,
      inputName: "long.mp3",
      extension: "mp3",
      kind: "mp3-audio",
      inputBytes: input,
      before: await inspectAudio("long-before", new Blob([new Uint8Array(input).buffer as ArrayBuffer]), "long.mp3"),
      policy: FULL_REMOVAL,
      inspectOutput: (id, source, name) => inspectAudio(id, new Blob([new Uint8Array(source as ArrayBuffer)]), name),
    });
    expect(verified.status).toBe("verified_clean");
    const after = probeMp3(new Uint8Array(await verified.output!.arrayBuffer()));
    expect(after.stream?.frameCount).toBe(before.stream?.frameCount);
  }, 120000);

  it("full removal strips ID3v2 + ID3v1 + trailing structures and preserves MPEG frames byte-for-byte", () => {
    const input = load("mp3-v2-and-v1.mp3");
    const result = cleanMp3(input, FULL_REMOVAL);
    expect(result.data.length).toBe(audioSegmentOf(input).length);
    // Byte-for-byte audio equality.
    const beforeAudio = audioSegmentOf(input);
    for (let i = 0; i < beforeAudio.length; i += 1) {
      expect(result.data[i]).toBe(beforeAudio[i]);
    }
    // The output must probe as a clean bare MPEG stream.
    const after = probeMp3(result.data);
    expect(after.tag).toBeNull();
    expect(after.id3v1).toBeNull();
    expect(after.trailing).toHaveLength(0);
    expect(after.stream?.frameCount).toBeGreaterThan(0);
  });

  it("full removal handles the APEv2 trailing fixture", () => {
    const input = load("mp3-ape-trailing.mp3");
    const result = cleanMp3(input, FULL_REMOVAL);
    const after = probeMp3(result.data);
    expect(after.trailing).toHaveLength(0);
    expect(after.tag).toBeNull();
    expect(after.stream?.frameCount).toBeGreaterThan(0);
    // Audio bytes identical.
    const beforeAudio = audioSegmentOf(input);
    for (let i = 0; i < beforeAudio.length; i += 1) {
      expect(result.data[i]).toBe(beforeAudio[i]);
    }
  });

  it("SOL-001: full removal leaves ZERO APEv2 item bytes in the output (independent re-probe)", () => {
    const input = load("mp3-ape-trailing.mp3");
    const result = cleanMp3(input, FULL_REMOVAL);
    const outputText = Buffer.from(result.data).toString("latin1");
    // Previously-retained bytes (the item region) must be gone.
    expect(outputText).not.toContain("APETAGEX");
    expect(outputText).not.toContain("APE Title");
    expect(outputText).not.toContain("APE Artist");
    // Structural re-probe (independent of the cleaning boundary model).
    const after = probeMp3(result.data);
    expect(after.trailing).toHaveLength(0);
    // Output is EXACTLY the frame-derived audio segment.
    const probe = probeMp3(input);
    expect(result.data.length).toBe(probe.stream!.streamEnd - probe.audioStart);
    // Change ledger claims removal only for the structures it removed.
    const removed = result.changes.filter((change) => change.action === "removed").map((change) => change.group);
    expect(removed).toContain("Trailing");
  });

  it("SOL-001: full removal clears the APEv2 header+footer form completely", () => {
    const input = load("mp3-ape-header-footer.mp3");
    const result = cleanMp3(input, FULL_REMOVAL);
    const outputText = Buffer.from(result.data).toString("latin1");
    expect(outputText).not.toContain("APETAGEX"); // footer AND header copies
    expect(outputText).not.toContain("APE Headered");
    const after = probeMp3(result.data);
    expect(after.trailing).toHaveLength(0);
    // Exact MPEG byte equality against the independent stream end.
    const before = probeMp3(input);
    const audio = input.subarray(before.audioStart, before.stream!.streamEnd);
    expect(result.data.length).toBe(audio.length);
    for (let i = 0; i < audio.length; i += 1) expect(result.data[i]).toBe(audio[i]);
  });

  it("SOL-001: full removal clears the Lyrics3 v2 body completely", () => {
    const input = load("mp3-lyrics3.mp3");
    const result = cleanMp3(input, FULL_REMOVAL);
    const outputText = Buffer.from(result.data).toString("latin1");
    expect(outputText).not.toContain("LYRICS200");
    expect(outputText).not.toContain("First lyric line");
    const after = probeMp3(result.data);
    expect(after.trailing).toHaveLength(0);
    const before = probeMp3(input);
    const audio = input.subarray(before.audioStart, before.stream!.streamEnd);
    expect(result.data.length).toBe(audio.length);
    for (let i = 0; i < audio.length; i += 1) expect(result.data[i]).toBe(audio[i]);
  });

  it("SOL-001: full removal clears Lyrics3 + ID3v1 combined tail", () => {
    const input = load("mp3-lyrics3-id3v1.mp3");
    const result = cleanMp3(input, FULL_REMOVAL);
    const outputText = Buffer.from(result.data).toString("latin1");
    expect(outputText).not.toContain("LYRICS200");
    expect(outputText).not.toContain("Combined tag lyrics");
    expect(outputText).not.toContain("TAG"); // ID3v1 tail
    const after = probeMp3(result.data);
    expect(after.trailing).toHaveLength(0);
    expect(after.id3v1).toBeNull();
    // MPEG payload byte equality.
    const before = probeMp3(input);
    const audio = input.subarray(before.audioStart, before.stream!.streamEnd);
    for (let i = 0; i < audio.length; i += 1) expect(result.data[i]).toBe(audio[i]);
  });

  it("SOL-001: AI-only retains trailing structures byte-verbatim (disclosed, not claimed removed)", () => {
    const input = load("mp3-ape-trailing.mp3");
    const result = cleanMp3(input, AI_ONLY);
    const after = probeMp3(result.data);
    const ape = after.trailing.find((structure) => structure.kind === "APEv2");
    expect(ape).toBeDefined();
    // Retained bytes are byte-identical to the input's APE region.
    const before = probeMp3(input);
    const beforeApe = input.subarray(before.trailing[0].start, before.trailing[0].end);
    const afterApe = result.data.subarray(ape!.start, ape!.end);
    expect(afterApe.length).toBe(beforeApe.length);
    for (let i = 0; i < beforeApe.length; i += 1) expect(afterApe[i]).toBe(beforeApe[i]);
    expect(result.coverageLimited).toBe(true);
  });

  it("SOL-001: adversarial oversized APE never gets its items stripped into the audio", () => {
    const input = load("mp3-ape-oversized.mp3");
    // Parser refused the structure — full removal is still safe: output is
    // the frame-derived audio only, and the refused bytes simply end up
    // removed WITHOUT being claimed as a validated tag removal.
    const result = cleanMp3(input, FULL_REMOVAL);
    const before = probeMp3(input);
    const audio = input.subarray(before.audioStart, before.stream!.streamEnd);
    expect(result.data.length).toBe(audio.length);
    for (let i = 0; i < audio.length; i += 1) expect(result.data[i]).toBe(audio[i]);
    // The ledger must NOT claim "APEv2 removed" (the structure was refused).
    const trailingChanges = result.changes.filter((change) => change.group === "Trailing");
    expect(trailingChanges.every((change) => change.action !== "removed")).toBe(true);
  });

  it("full removal on an untagged file is an honest unchanged no-op", () => {
    const input = load("mp3-untagged.mp3");
    const result = cleanMp3(input, FULL_REMOVAL);
    expect(result.data.length).toBe(input.length);
  });

  it("AI-only removal drops qualified AI frames and RETAINS unrelated tags + artwork byte-verbatim", () => {
    const input = load("mp3-ai-tags.mp3");
    const result = cleanMp3(input, AI_ONLY);
    const after = probeMp3(result.data);
    expect(after.tag).not.toBeNull();
    const ids = after.tag!.frames.map((frame) => frame.id);
    // AI evidence frames are gone.
    expect(ids).not.toContain("TXXX"); // both AI TXXX frames
    expect(ids).not.toContain("COMM"); // generator-signature comment
    // Ordinary tags stay.
    expect(ids).toContain("TIT2");
    expect(ids).toContain("TPE1");
    // Retained frames keep their raw payload bytes (title text survives).
    expect(after.tag!.frames.find((frame) => frame.id === "TIT2")?.values[0]).toBe("Synth Track");
    // Audio untouched.
    const beforeAudio = audioSegmentOf(input);
    const afterProbe = after;
    const afterAudio = result.data.subarray(afterProbe.audioStart);
    for (let i = 0; i < beforeAudio.length; i += 1) {
      expect(afterAudio[i]).toBe(beforeAudio[i]);
    }
  });

  it("AI-only removal keeps artwork frames byte-identical (APIC raw retained)", () => {
    const input = load("mp3-id3v2.3.mp3");
    const result = cleanMp3(input, AI_ONLY);
    const after = probeMp3(result.data);
    // No AI frames existed in this fixture — the file must be UNCHANGED.
    expect(result.data.length).toBe(input.length);
    expect(after.tag!.frames.find((frame) => frame.id === "APIC")).toBeDefined();
  });

  it("AI-only removal strips the C2PA-referencing GEOB carrier and keeps the title", () => {
    const input = load("mp3-geob-c2pa.mp3");
    const result = cleanMp3(input, AI_ONLY);
    const after = probeMp3(result.data);
    expect(after.tag!.frames.some((frame) => frame.kind === "geob")).toBe(false);
    expect(after.tag!.frames.find((frame) => frame.id === "TIT2")?.values[0]).toBe("GEOB Carrier");
  });

  it("AI-only removal refuses unsynchronised tags (no unsafe rebuild)", () => {
    const input = load("mp3-unsynchronised.mp3");
    expect(() => cleanMp3(input, AI_ONLY)).toThrow(/unsynchronisation/i);
  });

  it("AI-only removal discloses APEv2 trailing structures as retained-unsupported", () => {
    const input = load("mp3-ape-trailing.mp3");
    const result = cleanMp3(input, AI_ONLY);
    expect(result.coverageLimited).toBe(true);
    expect(result.changes.some((change) => change.action === "retained_unsupported" && change.group === "APEv2")).toBe(true);
  });

  it("refuses corrupted-tag files instead of guessing", () => {
    const input = load("mp3-corrupted-size.mp3");
    expect(() => cleanMp3(input, FULL_REMOVAL)).toThrow(/corrupt/i);
  });

  it("verifies end-to-end through the shared verify chain (full removal)", async () => {
    const result = await verifyMp3("mp3-v2-and-v1.mp3", FULL_REMOVAL);
    expect(result.status).toBe("verified_clean");
    expect(result.output).toBeInstanceOf(Blob);
    // Independent re-probe of the verified output bytes.
    const outputBytes = new Uint8Array(await result.output!.arrayBuffer());
    const after = probeMp3(outputBytes);
    expect(after.tag).toBeNull();
    expect(after.id3v1).toBeNull();
    expect(after.stream?.frameCount).toBeGreaterThan(0);
  });

  it("verifies end-to-end through the shared verify chain (AI-only removal)", async () => {
    const result = await verifyMp3("mp3-ai-tags.mp3", AI_ONLY);
    expect(result.status).toBe("verified_clean");
    const outputBytes = new Uint8Array(await result.output!.arrayBuffer());
    const after = probeMp3(outputBytes);
    // AI frames gone; ordinary frames + audio intact.
    expect(after.tag!.frames.some((frame) => frame.id === "TXXX")).toBe(false);
    expect(after.tag!.frames.some((frame) => frame.id === "COMM")).toBe(false);
    expect(after.tag!.frames.find((frame) => frame.id === "TIT2")?.values[0]).toBe("Synth Track");
    const originalAudio = audioSegmentOf(load("mp3-ai-tags.mp3"));
    const outputAudio = outputBytes.subarray(after.audioStart);
    expect(outputAudio.length).toBe(originalAudio.length);
  });
});
