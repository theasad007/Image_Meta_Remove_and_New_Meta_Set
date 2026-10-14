/**
 * Filename sanitizer reserved for future ZIP/download use (Phases 4+).
 * Phase 1 uses it only to pre-compute `sanitizedName` on queue entries.
 */

const MAX_NAME_LENGTH = 120;

export function sanitizeFileName(originalName: string): string {
  const base = (originalName.split(/[\\/]/).pop() ?? "").trim();
  if (base === "") return "file";
  // Strip control characters and path/unsafe symbols; keep unicode letters.
  const cleaned = base
    .replace(/[<>:"|?*\x00-\x1f\x7f]/g, "")
    .replace(/\.\.+/g, ".")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned === "" || cleaned === "." || cleaned === "..") return "file";
  if (cleaned.length <= MAX_NAME_LENGTH) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  if (dot > 0 && cleaned.length - dot <= 16) {
    const ext = cleaned.slice(dot);
    return `${cleaned.slice(0, MAX_NAME_LENGTH - ext.length)}${ext}`;
  }
  return cleaned.slice(0, MAX_NAME_LENGTH);
}
