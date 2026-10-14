import type { ExpandedTags } from "exifreader";
import type { ImageInspectionResult } from "../../../types/inspection";
import {
  SNIFF_WINDOW_BYTES,
  sniffImageBytes,
} from "../../format-detection/signatures";
import { normalizeInspection } from "./normalize";
import { inspectC2pa } from "./c2pa";

/**
 * Browser-only inspection engine (Phase 2).
 *
 * - Reads at most a 64 KiB head slice for container sniffing.
 * - Lets ExifReader perform ranged reads (`length: 'auto'`) for File/Blob
 *   inputs so whole-file buffers are never forced into RAM.
 * - ExifReader is lazy-loaded on first inspection to keep the landing
 *   bundle lean; a Web Worker is deferred to Phase 4 (needs a worker-safe
 *   XML parser + static-asset worker bundling proof — see docs/03).
 * - One file's failure never rejects the batch: every path returns a
 *   result object with an honest outcome.
 */

export interface InspectOptions {
  /** Test-only XML parser (node has no DOMParser; browsers use native). */
  domParser?: unknown;
  /** Hard per-file byte cap for the reader input (DoS budget). */
  maxBytes?: number;
}

export const DEFAULT_MAX_INSPECT_BYTES = 64 * 1024 * 1024;

type ExifReaderModule = typeof import("exifreader");

let readerPromise: Promise<ExifReaderModule> | null = null;

function loadReader(): Promise<ExifReaderModule> {
  if (!readerPromise) readerPromise = import("exifreader");
  return readerPromise;
}

async function readHead(source: File | Blob): Promise<Uint8Array> {
  const slice = source.slice(0, Math.min(SNIFF_WINDOW_BYTES, source.size));
  const buffer = await slice.arrayBuffer();
  return new Uint8Array(buffer);
}

function getExtension(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

function mimeFor(kind: ReturnType<typeof sniffImageBytes>["kind"]): string {
  switch (kind) {
    case "jpeg": return "image/jpeg";
    case "png": return "image/png";
    case "webp": return "image/webp";
    case "avif": return "image/avif";
    case "heic":
    case "heif-generic": return "image/heic";
    default: return "application/octet-stream";
  }
}

async function withC2pa(
  result: ImageInspectionResult,
  source: File | Blob | ArrayBuffer,
  mimeType: string,
): Promise<ImageInspectionResult> {
  if (typeof Worker === "undefined") return result;
  const existing = result.categories.findIndex((item) => item.category === "C2PA / Content Credentials");
  if (existing < 0) return result;
  const blob = source instanceof Blob ? source : new Blob([source], { type: mimeType });
  const c2pa = await inspectC2pa(blob, mimeType);
  const categories = [...result.categories];
  categories[existing] = c2pa.category;
  return {
    ...result,
    categories,
    aiIndicators: [...result.aiIndicators, ...c2pa.aiIndicators],
    outcome: c2pa.category.status === "not_inspected" && result.outcome === "completed" ? "partial" : result.outcome,
  };
}

export async function inspectImage(
  fileId: string,
  source: File | Blob | ArrayBuffer,
  fileName: string,
  options: InspectOptions = {},
): Promise<ImageInspectionResult> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_INSPECT_BYTES;
  const declaredExtension = getExtension(fileName);
  const totalSize = source instanceof ArrayBuffer ? source.byteLength : source.size;

  if (totalSize === 0) {
    return normalizeInspection({
      fileId, fileName, declaredExtension, bytes: 0,
      sniff: sniffImageBytes(new Uint8Array(0), 0, declaredExtension),
      tags: null,
    });
  }
  if (totalSize > maxBytes) {
    const head = source instanceof ArrayBuffer
      ? new Uint8Array(source.slice(0, SNIFF_WINDOW_BYTES))
      : await readHead(source);
    const sniff = sniffImageBytes(head, totalSize, declaredExtension);
    return {
      ...(normalizeInspection({ fileId, fileName, declaredExtension, bytes: totalSize, sniff, tags: null })),
      outcome: "failed",
      warnings: [
        `File is ${totalSize} bytes — above the ${maxBytes}-byte in-browser inspection budget. No result is fabricated; raise the budget explicitly to inspect.`,
      ],
    };
  }

  let head: Uint8Array;
  try {
    head = source instanceof ArrayBuffer
      ? new Uint8Array(source.slice(0, Math.min(SNIFF_WINDOW_BYTES, source.byteLength)))
      : await readHead(source);
  } catch {
    return normalizeInspection({
      fileId, fileName, declaredExtension, bytes: totalSize,
      sniff: sniffImageBytes(new Uint8Array(0), totalSize, declaredExtension),
      tags: null, readerError: "File bytes could not be read (slice failed).",
    });
  }
  const sniff = sniffImageBytes(head, totalSize, declaredExtension);

  // Fast paths that never invoke the reader.
  if (
    sniff.kind === "empty" || sniff.kind === "unreadable" ||
    sniff.kind === "unknown" || sniff.kind === "mp4-video" ||
    sniff.kind === "avif-sequence" || sniff.kind === "heif-sequence"
  ) {
    return normalizeInspection({ fileId, fileName, declaredExtension, bytes: totalSize, sniff, tags: null });
  }

  let tags: ExpandedTags | null = null;
  let readerError: string | undefined;
  try {
    const reader = await loadReader();
    // Ranged reads need FileReader (browsers). Other runtimes (node tests)
    // fall back to a single bounded ArrayBuffer read — same normalizer.
    const canRangeRead = source instanceof File && typeof FileReader !== "undefined";
    if (canRangeRead) {
      const loadOptions: Record<string, unknown> = {
        expanded: true, includeOffsets: true, length: "auto", async: true,
      };
      if (options.domParser !== undefined) loadOptions["domParser"] = options.domParser;
      tags = (await reader.load(source, loadOptions as never)) as unknown as ExpandedTags;
    } else {
      // ArrayBuffer input, name-less Blob, or File without FileReader:
      // materialize within the already-enforced budget.
      const buffer = source instanceof ArrayBuffer ? source : await source.arrayBuffer();
      const loadOptions: Record<string, unknown> = { expanded: true, async: true };
      if (options.domParser !== undefined) loadOptions["domParser"] = options.domParser;
      tags = (await reader.load(buffer, loadOptions as never)) as unknown as ExpandedTags;
    }
  } catch (error) {
    readerError = error instanceof Error ? error.message.slice(0, 300) : "Unknown reader failure.";
  }
  const normalized = normalizeInspection({ fileId, fileName, declaredExtension, bytes: totalSize, sniff, tags, readerError });
  if (normalized.outcome === "failed" || normalized.outcome === "unsupported") return normalized;
  return withC2pa(normalized, source, mimeFor(sniff.kind));
}
