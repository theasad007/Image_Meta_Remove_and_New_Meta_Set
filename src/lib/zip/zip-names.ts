import { sanitizeFileName } from "../security/filenames";

/**
 * Safe, deterministic ZIP entry mapping (Phase 4).
 *
 * - Everything lives under `images/` (video reserved for Phase 8; reports
 *   for Phase 5 — never fabricated here).
 * - Path separators, `..`, absolute paths, control characters and blank
 *   names are neutralized: ZIP-slip is impossible by construction because
 *   paths are rebuilt from sanitized stems, never from raw input.
 * - Duplicates resolve deterministically (`name-clean.ext`,
 *   `name-clean-2.ext`, …), case-insensitively, in queue order.
 */

export const ZIP_IMAGE_FOLDER = "images/";
const MAX_ARCHIVE_NAME = 100;

function sanitizeStem(stem: string): string {
  const cleaned = stem
    .replace(/[\\/]/g, "_")
    .replace(/[<>:"|?*\x00-\x1f\x7f]/g, "")
    .replace(/\.+/g, ".")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[._\- ]+/, "")
    .slice(0, MAX_ARCHIVE_NAME)
    .trim();
  return cleaned === "" ? "file" : cleaned;
}

function sanitizeExtension(extension: string): string {
  const cleaned = extension.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10);
  return cleaned === "" ? "bin" : cleaned;
}

export function sanitizeZipPath(stem: string, extension: string): string {
  return `${ZIP_IMAGE_FOLDER}${sanitizeStem(stem)}.${sanitizeExtension(extension)}`;
}

export interface ZipMappingInput {
  fileId: string;
  /** Verified output filename from the cleaning result (already `-clean`). */
  outputName: string;
}

export interface ZipMapping {
  fileId: string;
  archivePath: string;
}

/**
 * Map verified outputs to unique archive paths. Pure + deterministic:
 * same input order always yields the same mapping.
 */
export function buildZipMapping(files: ZipMappingInput[]): ZipMapping[] {
  const used = new Set<string>();
  return files.map((file) => {
    const sanitized = sanitizeFileName(file.outputName);
    const dot = sanitized.lastIndexOf(".");
    const stem = dot > 0 ? sanitized.slice(0, dot) : sanitized;
    const extension = dot > 0 ? sanitized.slice(dot + 1) : "bin";
    const base = sanitizeZipPath(stem, extension).toLowerCase();
    let candidate = base;
    let counter = 2;
    while (used.has(candidate)) {
      const suffixed = sanitizeZipPath(`${stem}-${counter}`, extension).toLowerCase();
      candidate = suffixed;
      counter += 1;
      if (counter > 100000) {
        throw new Error("Filename deduplication budget exhausted.");
      }
    }
    used.add(candidate);
    return { fileId: file.fileId, archivePath: candidate };
  });
}

export function zipArchiveName(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `metadata-cleaned-${year}-${month}-${day}.zip`;
}
