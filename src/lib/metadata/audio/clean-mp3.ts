import {
  probeMp3,
  type Id3FrameView,
} from "./id3";
import type { CleaningPolicy, MetadataChange } from "../clean/types";
import { CleanRefused } from "../clean/types";

/**
 * MP3 metadata cleaning (Phase 09) — audio-payload-preserving by design:
 *
 * - Full removal (`Remove Metadata`): strips the ID3v2 tag (header +
 *   frames + footer when flagged), the ID3v1 tail, and footer-located
 *   trailing structures (APEv2/Lyrics3). The MPEG audio frames between
 *   tag end and trailing start are copied BYTE-FOR-BYTE.
 * - AI-only removal (`Remove AI Metadata`): rebuilds the ID3v2 tag WITHOUT
 *   qualified AI frames (AI/provenance TXXX, generator-signature COMM,
 *   AI-related PRIV, C2PA-referencing GEOB) while retaining every other
 *   frame's RAW bytes verbatim (artwork, lyrics, title, artist…).
 *
 * Refusals (never guess): corrupt ID3 headers, unsynchronised tags for
 * targeted removal (de-unsynchronised rebuild risks byte corruption),
 * files without a valid MPEG stream, and APEv2/Lyrics3 items under
 * AI-only mode (no verified item-level writer — disclosed as retained).
 */

export interface Mp3CleanOutput {
  data: Uint8Array;
  changes: MetadataChange[];
  warnings: string[];
  coverageLimited: boolean;
  /** FNV-1a over the preserved MPEG audio segment. */
  audioFingerprint: string;
  removedTagBytes: number;
}

const AI_TXXX_DESCRIPTION = /^(ai[_-]?generator|ai[_-]?tool|ai[_-]?model|ai[_-]?provenance)$/i;
const C2PA_HINT = /c2pa|contentcredential|content-credential/i;

function fnv1a(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function latin1(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
}

/** Which raw frames count as AI evidence for targeted removal. */
function isAiFrame(frame: Id3FrameView): boolean {
  if (frame.kind === "custom") {
    const description = frame.label.replace(/^Custom Text:\s*/i, "");
    if (AI_TXXX_DESCRIPTION.test(description)) return true;
    if (/^digital[\s_-]?source[\s_-]?type$/i.test(description) && /trainedalgorithmicmedia/i.test(frame.values.join(" "))) return true;
    return false;
  }
  if (frame.kind === "comment") {
    const value = frame.values.join(" ").toLowerCase();
    return /stable[\s-]?diffusion|sdxl|comfyui|automatic1111|a1111|midjourney|dall-e|dalle|openai|sora|firefly|flux|leonardo/.test(value);
  }
  if (frame.kind === "geob") {
    return C2PA_HINT.test(`${frame.label} ${frame.values.join(" ")}`);
  }
  if (frame.kind === "priv") {
    const owner = frame.values.join(" ").toLowerCase();
    return /c2pa|ai[_-]?generator|caiai|contentcredential/.test(owner);
  }
  return false;
}

export function cleanMp3(input: Uint8Array, policy: CleaningPolicy): Mp3CleanOutput {
  const changes: MetadataChange[] = [];
  const warnings: string[] = [];
  const targets = policy.targets ?? ["exif_gps", "descriptive"];
  const fullRemoval = targets.includes("descriptive") || targets.includes("exif_gps");
  const aiOnly = targets.includes("ai_markers") && !fullRemoval;

  const probe = probeMp3(input);
  if (!probe.ok) {
    throw new CleanRefused("unsupported", probe.unsupportedReason ?? "MP3 could not be safely parsed — cleaning refused.");
  }

  // The MPEG audio segment: byte-exact always. The audio end is the
  // FRAME-DERIVED stream end (SOL-001/007) — trailing structures are
  // validated by scanTrailing to start at or after it.
  const audioStart = probe.audioStart;
  const audioEnd = probe.stream
    ? probe.stream.streamEnd
    : (() => {
      let end = input.length;
      if (probe.id3v1) end -= 128;
      return end;
    })();
  if (audioEnd < audioStart) {
    throw new CleanRefused("unsupported", "MP3 structure could not be safely isolated (tag overlaps audio) — cleaning refused.");
  }
  const audioSegment = input.subarray(audioStart, audioEnd);
  const audioFingerprint = fnv1a(audioSegment);

  if (fullRemoval) {
    // ---- Remove Metadata: drop ID3v2 + ID3v1 + trailing structures ----
    const output = new Uint8Array(audioSegment.length);
    output.set(audioSegment, 0);
    let removedTagBytes = audioStart;

    if (probe.tag) {
      changes.push({
        group: "ID3",
        action: "removed",
        verification: "not_verified",
        reason: `ID3v2.${probe.tag.major} tag removed (${probe.tag.frames.length} frames).`,
      });
      removedTagBytes += probe.id3v1 ? 0 : 0; // tag size already = audioStart
    } else {
      changes.push({
        group: "ID3",
        action: "unchanged",
        verification: "verified",
        reason: "No ID3v2 tag was present.",
      });
    }
    if (probe.id3v1) {
      removedTagBytes += 128;
      changes.push({
        group: "ID3v1",
        action: "removed",
        verification: "not_verified",
        reason: "ID3v1 end-of-file tag removed.",
      });
    }
    for (const structure of probe.trailing) {
      removedTagBytes += structure.size;
      changes.push({
        group: "Trailing",
        action: "removed",
        verification: "not_verified",
        reason: `${structure.kind} trailing structure removed (${structure.size} bytes, full validated tag body — audio frames untouched).`,
      });
    }
    changes.push({
      group: "MPEG audio",
      action: "retained_technical",
      verification: "not_verified",
      reason: `MPEG audio frames preserved byte-for-byte (${audioSegment.length} bytes, fingerprint ${audioFingerprint}).`,
    });

    return {
      data: output,
      changes,
      warnings,
      coverageLimited: false,
      audioFingerprint,
      removedTagBytes,
    };
  }

  if (aiOnly) {
    // ---- Remove AI Metadata: rebuild the tag without qualified AI frames.
    if (!probe.tag) {
      return {
        data: new Uint8Array(input),
        changes: [{
          group: "ID3",
          action: "unchanged",
          verification: "verified",
          reason: "No ID3v2 tag exists — no AI metadata evidence to remove.",
        }],
        warnings,
        coverageLimited: false,
        audioFingerprint,
        removedTagBytes: 0,
      };
    }
    if (probe.tag.unsynchronisation) {
      throw Object.assign(new Error(
        "This MP3 uses ID3 unsynchronisation; targeted AI-frame removal cannot rebuild it byte-safely. Disclosed as unsupported rather than risking corruption.",
      ), { name: "CleanRefused", status: "unsupported" });
    }

    const major = probe.tag.major;
    const idLength = major === 2 ? 3 : 4;
    const headerLength = major === 2 ? 6 : 10;
    // Walk raw frames (verbatim retention needs the ORIGINAL bytes).
    const bodyStart = 10;
    const tagEnd = bodyStart + (probe.tag.size - 10);
    let cursor = bodyStart;
    if (probe.tag.extendedHeader) {
      // Skip the extended header raw bytes (dropped on rebuild; the flag clears).
      if (major === 3) {
        cursor += ((input[cursor] << 24) | (input[cursor + 1] << 16) | (input[cursor + 2] << 8) | input[cursor + 3]) + 4;
      } else if (major === 4) {
        cursor += ((input[cursor] & 0x7f) << 21) | ((input[cursor + 1] & 0x7f) << 14) | ((input[cursor + 2] & 0x7f) << 7) | (input[cursor + 3] & 0x7f);
      }
    }
    const retainedFrames: Uint8Array[] = [];
    let removedCount = 0;
    while (cursor + headerLength <= tagEnd && retainedFrames.length < 512) {
      const id = latin1(input.subarray(cursor, cursor + idLength));
      if (!/^[A-Z0-9]{3,4}$/.test(id)) break; // padding
      let frameSize: number;
      if (major === 2) {
        frameSize = (input[cursor + 3] << 16) | (input[cursor + 4] << 8) | input[cursor + 5];
      } else if (major === 4) {
        frameSize = ((input[cursor + 4] & 0x7f) << 21) | ((input[cursor + 5] & 0x7f) << 14) | ((input[cursor + 6] & 0x7f) << 7) | (input[cursor + 7] & 0x7f);
      } else {
        frameSize = (input[cursor + 4] << 24) | (input[cursor + 5] << 16) | (input[cursor + 6] << 8) | input[cursor + 7];
      }
      if (frameSize <= 0 || cursor + headerLength + frameSize > tagEnd + 1) break;
      const raw = input.subarray(cursor, cursor + headerLength + frameSize);
      const decoded = probe.tag.frames.find((frame) => frame.id === id && frame.size === frameSize);
      if (decoded && isAiFrame(decoded)) {
        removedCount += 1;
        changes.push({
          group: "ID3",
          key: id,
          action: "removed",
          verification: "not_verified",
          reason: `AI-evidence frame ${id} (${decoded.label}) removed — qualified provenance content.`,
        });
      } else {
        retainedFrames.push(raw);
        if (decoded) {
          changes.push({
            group: "ID3",
            key: id,
            action: "retained_technical",
            verification: "not_verified",
            reason: `${id} (${decoded.label}) retained — not AI evidence (artwork, lyrics and ordinary tags stay).`,
          });
        }
      }
      cursor += headerLength + frameSize;
    }

    // Trailing structures stay (no verified item-level writer) — disclosed.
    for (const structure of probe.trailing) {
      changes.push({
        group: structure.kind,
        action: "retained_unsupported",
        verification: "verified",
        reason: `${structure.kind} trailing structure retained — no verified item-level removal; disclosed, never silently stripped.`,
      });
    }

    // Rebuild: same version, flags minus unsynchronisation/extended/experimental.
    if (removedCount === 0) {
      return {
        data: new Uint8Array(input),
        changes: [
          ...changes,
          { group: "ID3", action: "unchanged", verification: "verified" as const, reason: "No qualified AI-evidence frames were present — the file is unchanged." },
        ],
        warnings,
        coverageLimited: probe.trailing.length > 0,
        audioFingerprint,
        removedTagBytes: 0,
      };
    }
    const retainedBody = concatFrames(retainedFrames, major);
    const newFlags = 0x00;
    const header = new Uint8Array(10);
    header.set([0x49, 0x44, 0x33, major, 0x00, newFlags], 0);
    const size = retainedBody.length;
    header[6] = (size >> 21) & 0x7f;
    header[7] = (size >> 14) & 0x7f;
    header[8] = (size >> 7) & 0x7f;
    header[9] = size & 0x7f;
    const output = new Uint8Array(header.length + retainedBody.length + audioSegment.length + (input.length - audioEnd));
    output.set(header, 0);
    output.set(retainedBody, header.length);
    output.set(audioSegment, header.length + retainedBody.length);
    // Preserve any bytes after the trailing-structure cutoff (none expected).
    const tail = input.subarray(audioEnd);
    output.set(tail, header.length + retainedBody.length + audioSegment.length);

    return {
      data: output,
      changes,
      warnings,
      coverageLimited: probe.trailing.length > 0,
      audioFingerprint,
      removedTagBytes: probe.tag.size - (10 + size),
    };
  }

  throw new CleanRefused("unsupported", "No supported cleaning target for MP3 (expected 'Remove Metadata' or 'Remove AI Metadata').");
}

function concatFrames(frames: Uint8Array[], major: number): Uint8Array {
  const parts: Uint8Array[] = [];
  let total = 0;
  for (const frame of frames) {
    if (major === 3 || major === 4) {
      parts.push(frame);
      total += frame.length;
    } else {
      parts.push(frame);
      total += frame.length;
    }
  }
  // Padding to a clean boundary is unnecessary; keep minimal.
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
