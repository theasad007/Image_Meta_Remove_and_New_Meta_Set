import type { SniffedKind } from "../../format-detection/signatures";
import { cleanIsobmff, type IsobmffCleanOutput } from "./isobmff";
import { cleanJpeg, type JpegCleanOutput } from "./jpeg";
import { cleanPng, type PngCleanOutput } from "./png";
import { CleanRefused, type CleaningPolicy, type MetadataChange } from "./types";
import { cleanWebp, type WebpCleanOutput } from "./webp";

/**
 * Single-image cleaning dispatcher (Phase 3).
 *
 * Routes strictly by byte-verified container kind — never by extension.
 * Video, sequences and unknown containers never reach an image writer.
 */

export type CleanEngineOutput = {
  data: Uint8Array;
  changes: MetadataChange[];
  warnings: string[];
  coverageLimited: boolean;
  payloadFingerprint: string;
} & (
  | { engine: "jpeg"; detail: JpegCleanOutput }
  | { engine: "png"; detail: PngCleanOutput }
  | { engine: "webp"; detail: WebpCleanOutput }
  | { engine: "isobmff"; detail: IsobmffCleanOutput }
);

export function cleanImageBytes(
  input: Uint8Array,
  kind: SniffedKind,
  policy: CleaningPolicy,
): CleanEngineOutput {
  switch (kind) {
    case "jpeg": {
      const detail = cleanJpeg(input, policy);
      return { engine: "jpeg", data: detail.data, changes: detail.changes, warnings: detail.warnings, coverageLimited: detail.coverageLimited, payloadFingerprint: detail.scanFingerprint, detail };
    }
    case "png": {
      const detail = cleanPng(input, policy);
      return { engine: "png", data: detail.data, changes: detail.changes, warnings: detail.warnings, coverageLimited: detail.coverageLimited, payloadFingerprint: detail.idatFingerprint, detail };
    }
    case "webp": {
      const detail = cleanWebp(input, policy);
      return { engine: "webp", data: detail.data, changes: detail.changes, warnings: detail.warnings, coverageLimited: detail.coverageLimited, payloadFingerprint: detail.payloadFingerprint, detail };
    }
    case "avif":
    case "heic":
    case "heif-generic": {
      // Proven-safe set is identical under both policies for ISOBMFF:
      // item-graph safety dominates, so aggressive mode changes nothing.
      const detail = cleanIsobmff(input, kind === "avif" ? "avif" : "heic", policy);
      return { engine: "isobmff", data: detail.data, changes: detail.changes, warnings: detail.warnings, coverageLimited: detail.coverageLimited, payloadFingerprint: detail.imagePayloadFingerprint, detail };
    }
    case "mp4-video":
      throw new CleanRefused("unsupported", "Video cleaning lands in Phase 8 — the image engine never touches video.");
    case "avif-sequence":
    case "heif-sequence":
      throw new CleanRefused("unsupported", "Image-sequence containers are out of scope; refusing rather than corrupting.");
    case "empty":
      throw new CleanRefused("failed", "Empty input — nothing to clean.");
    case "unknown":
    case "unreadable":
    default:
      throw new CleanRefused("failed", "Unrecognized container — cleaning refused without a known format.");
  }
}
