import type { DetectedFormat, MediaKind } from "../../types/media";

/**
 * Central typed format-detection contract (Phase 1).
 *
 * Provisional only: classification uses the file extension plus the
 * browser-provided MIME type as *hints*. Nothing here proves the container,
 * the codec, or any metadata capability. Phase 2 adds binary
 * signature / ftyp-brand checks behind this same return type
 * (`binaryVerified` flips to true only for verified paths).
 */

export const IMAGE_EXTENSIONS = [
  "jpg",
  "jpeg",
  "png",
  "webp",
  "avif",
  "heic",
  "heif",
] as const;

export const VIDEO_EXTENSIONS = ["mp4", "mov", "webm"] as const;

export type ImageExtension = (typeof IMAGE_EXTENSIONS)[number];
export type VideoExtension = (typeof VIDEO_EXTENSIONS)[number];

const EXTENSION_LABELS: Record<string, string> = {
  jpg: "JPEG",
  jpeg: "JPEG",
  png: "PNG",
  webp: "WebP",
  avif: "AVIF",
  heic: "HEIC",
  heif: "HEIF",
  mp4: "MP4",
  mov: "MOV",
  webm: "WebM",
};

const IMAGE_SET = new Set<string>(IMAGE_EXTENSIONS);
const VIDEO_SET = new Set<string>(VIDEO_EXTENSIONS);

/** Extensions whose bytes browsers can generally render in an <img>. */
const NATIVE_IMAGE_PREVIEW = new Set(["jpg", "jpeg", "png", "webp", "avif"]);
/** Containers generally playable in a <video> element (conservative). */
const NATIVE_VIDEO_PREVIEW = new Set(["mp4", "webm"]);

export function getExtension(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function classifyFile(
  fileName: string,
  mimeType: string,
  sizeBytes: number,
): DetectedFormat {
  const extension = getExtension(fileName);
  const isEmpty = sizeBytes === 0;
  let mediaKind: MediaKind = "unknown";
  if (IMAGE_SET.has(extension)) mediaKind = "image";
  else if (VIDEO_SET.has(extension)) mediaKind = "video";

  const supportedForQueue = mediaKind !== "unknown";
  const label = EXTENSION_LABELS[extension] ?? "Unknown";

  let note: string;
  if (!supportedForQueue) {
    note =
      "Extension not recognized. The file will be checked by its bytes and kept for review without any unsupported metadata claim.";
  } else {
    note =
      "Extension is only an initial hint. The app verifies the actual container from file bytes before processing.";
  }

  return {
    mediaKind,
    extension,
    mimeHint: mimeType,
    label,
    supportedForQueue,
    detectionMethod: "extension-hint",
    binaryVerified: false,
    isEmpty,
    note,
  };
}

/**
 * Whether Phase 1 may attempt an inline preview element.
 * A `false` result (HEIC/HEIF, MOV, unknown, empty) is a *preview*
 * limitation only — the file stays queued for future metadata work and is
 * never labeled corrupt/unsupported on preview grounds.
 */
export function isNativelyPreviewable(detected: DetectedFormat): boolean {
  if (detected.isEmpty || !detected.supportedForQueue) return false;
  if (detected.mediaKind === "image")
    return NATIVE_IMAGE_PREVIEW.has(detected.extension);
  if (detected.mediaKind === "video")
    return NATIVE_VIDEO_PREVIEW.has(detected.extension);
  return false;
}

export function previewFallbackReason(detected: DetectedFormat): string {
  if (detected.isEmpty) return "Empty file — nothing to preview.";
  if (!detected.supportedForQueue)
    return "Unrecognized type — preview unavailable. File stays queued without any metadata claim.";
  if (detected.mediaKind === "image")
    return "This browser cannot render this image inline (for example HEIC outside Safari). The file stays queued and file-level inspection may still work.";
  return "This browser cannot play this video inline here. Video metadata tools are not available yet.";
}
