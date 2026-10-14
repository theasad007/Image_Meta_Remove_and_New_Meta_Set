/**
 * Phase 2 inspection model — the single source of truth for everything the
 * metadata inspector observes. Plain JSON-safe data only: no ArrayBuffers,
 * no Base64 blobs, no object URLs. Built for future before/after comparison
 * and CSV/PDF reporting (Phases 3–5 converge on these shapes).
 */

export interface MetadataTag {
  /** e.g. "EXIF", "GPS", "XMP", "IPTC", "PNG Text", "WebP Container". */
  group: string;
  /** e.g. "dc", "xmp", "Iptc4xmpExt" for XMP; undefined otherwise. */
  namespace?: string;
  /** Original tag/field name as reported by the reader. */
  key: string;
  /** Human-friendly rendering of the key where it differs. */
  label?: string;
  /** Safe plain-text value, length-capped; never HTML. */
  displayedValue: string;
  /** True when the on-screen value was truncated. */
  truncated?: boolean;
  valueType?: string;
  /** Provenance, e.g. "EXIF IFD0", "PNG iTXt", "ISOBMFF Exif item". */
  source?: string;
  /** True for color/geometry/container properties (not privacy findings). */
  technical?: boolean;
}

export type InspectionCategoryState =
  | "detected"
  | "not_detected"
  | "not_inspected"
  | "unsupported"
  | "uncertain"
  | "failed";

export interface InspectionCategoryResult {
  category: string;
  status: InspectionCategoryState;
  tags: MetadataTag[];
  warnings: string[];
  reader?: string;
}

export interface AiIndicator {
  label: string;
  evidenceGroup: string;
  evidenceKey: string;
  matchedValue: string;
  confidence: "explicit" | "possible";
  explanation: string;
}

export type InspectionOutcome =
  | "completed"
  | "partial"
  | "failed"
  | "unsupported"
  | "cancelled";

export interface ImageInspectionResult {
  fileId: string;
  fileName: string;
  /** Lowercase extension from the file name (hint). */
  declaredFormat?: string;
  /** Container identified from bytes (jpeg/png/webp/avif/heic/…). */
  detectedFormat?: string;
  /** ISO-BMFF major brand where applicable (avif/heic/…). */
  detectedBrand?: string;
  bytes: number;
  outcome: InspectionOutcome;
  categories: InspectionCategoryResult[];
  aiIndicators: AiIndicator[];
  warnings: string[];
  inspectedAt: string;
}

/** Empty honest result: nothing inspected yet, nothing claimed. */
export function emptyInspection(
  fileId: string,
  fileName: string,
  bytes: number,
): ImageInspectionResult {
  return {
    fileId,
    fileName,
    bytes,
    outcome: "failed",
    categories: [],
    aiIndicators: [],
    warnings: ["Inspection has not run for this file."],
    inspectedAt: new Date().toISOString(),
  };
}
