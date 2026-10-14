import { classifyFile } from "../../lib/format-detection/format-detection";
import {
  SNIFF_WINDOW_BYTES,
  sniffImageBytes,
  type BinaryVerification,
  type SniffedKind,
} from "../../lib/format-detection/signatures";
import { sanitizeFileName } from "../../lib/security/filenames";
import type { MediaKind, QueueEntry } from "../../types/media";

let entryCounter = 0;

/**
 * Pure queue helpers. The live `File` objects are only ever referenced —
 * never fully read — at intake; a bounded 64 KiB head slice upgrades each
 * row to byte-verified classification shortly after (see `sniffEntryHead`).
 */
export function createEntries(files: File[]): QueueEntry[] {
  const now = Date.now();
  return files.map((source) => {
    entryCounter += 1;
    const detected = classifyFile(source.name, source.type, source.size);
    let notice: string | undefined;
    if (detected.isEmpty) notice = "Empty file (0 bytes) — queued without preview.";
    else if (!detected.supportedForQueue)
      notice = "Unsupported extension — queued for review only, no metadata claim.";
    return {
      item: {
        id: `${now}-${entryCounter}`,
        name: source.name,
        sanitizedName: sanitizeFileName(source.name),
        sizeBytes: source.size,
        detected,
        status: "queued",
        addedAt: now,
        ...(notice ? { notice } : {}),
      },
      source,
    };
  });
}

const SNIFF_LABELS: Record<string, { mediaKind: MediaKind; label: string; supported: boolean }> = {
  jpeg: { mediaKind: "image", label: "JPEG", supported: true },
  png: { mediaKind: "image", label: "PNG", supported: true },
  webp: { mediaKind: "image", label: "WebP", supported: true },
  avif: { mediaKind: "image", label: "AVIF", supported: true },
  "avif-sequence": { mediaKind: "image", label: "AVIF sequence", supported: true },
  heic: { mediaKind: "image", label: "HEIC", supported: true },
  "heif-generic": { mediaKind: "image", label: "HEIF", supported: true },
  "heif-sequence": { mediaKind: "image", label: "HEIF sequence", supported: true },
  "mp4-video": { mediaKind: "video", label: "Video", supported: true },
  empty: { mediaKind: "unknown", label: "Empty", supported: false },
  unknown: { mediaKind: "unknown", label: "Unknown", supported: false },
  unreadable: { mediaKind: "unknown", label: "Unreadable", supported: false },
};

/**
 * Fold a byte-level sniff into a queued entry (pure). Rows become
 * byte-honest: the label follows the container, and extension mismatches
 * get an explicit notice. Metadata support is still never implied.
 */
export function applyBinaryVerification(
  entries: QueueEntry[],
  id: string,
  sniff: BinaryVerification,
): QueueEntry[] {
  return entries.map((entry) => {
    if (entry.item.id !== id) return entry;
    const mapped = SNIFF_LABELS[sniff.kind as SniffedKind] ?? SNIFF_LABELS["unknown"];
    if (!mapped) return entry;
    const mismatch = sniff.mismatchWithExtension;
    return {
      ...entry,
      item: {
        ...entry.item,
        detected: {
          ...entry.item.detected,
          mediaKind: mapped.mediaKind,
          label: mapped.label,
          supportedForQueue: entry.item.detected.supportedForQueue || mapped.supported,
          detectionMethod: "binary-sniff",
          binaryVerified: true,
          ...(sniff.majorBrand ? { brand: sniff.majorBrand } : {}),
          note: mismatch
            ? `Extension suggests otherwise, but file bytes identify ${mapped.label}. Bytes take precedence for every operation.`
            : `Container verified from file bytes (${mapped.label}). Available actions are shown for this file.`,
        },
        notice: mismatch
          ? `Extension ".${sniff.declaredExtension || "?"}" does not match file bytes (${mapped.label}) — bytes take precedence.`
          : entry.item.notice,
      },
    };
  });
}

/** Bounded head-slice sniff for one queued file (never the whole file). */
export async function sniffEntryHead(source: File): Promise<BinaryVerification> {
  const head = new Uint8Array(
    await source.slice(0, Math.min(SNIFF_WINDOW_BYTES, source.size)).arrayBuffer(),
  );
  const base = source.name.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  const extension = dot > 0 && dot < base.length - 1 ? base.slice(dot + 1).toLowerCase() : "";
  return sniffImageBytes(head, source.size, extension);
}

export function removeEntry(entries: QueueEntry[], id: string): QueueEntry[] {
  return entries.filter((entry) => entry.item.id !== id);
}

export function clearEntries(): QueueEntry[] {
  return [];
}
