/**
 * Strict data contracts for AI Metadata Remover & Manager.
 *
 * Phase 1: skeletal but internally consistent. No fake metadata is ever
 * generated from these types — every inspection/modification state starts at
 * an honest "not yet performed" value. Future phases fill in the engines
 * behind the contracts without changing their shape.
 */

/** Broad media category derived from the file's provisional classification. */
export type MediaKind = "image" | "video" | "unknown";

/** How a file's container/format was identified. */
export type DetectionMethod = "extension-hint" | "binary-sniff";

/**
 * Provisional format classification. Intake starts as `extension-hint`
 * (`binaryVerified: false`); the queue upgrades entries to `binary-sniff`
 * after reading head bytes (Phase 3+). Metadata support is STILL never
 * implied — verification lands per-operation with fixtures.
 */
export interface DetectedFormat {
  mediaKind: MediaKind;
  /** Lowercase extension without dot ("" when the name has none). */
  extension: string;
  /** Browser-provided MIME type, or "" when unavailable. Hint only. */
  mimeHint: string;
  /** Human label, e.g. "JPEG", "AVIF", "MP4", "Unknown". */
  label: string;
  /** True when the extension (or sniffed bytes) is a known image/video kind. */
  supportedForQueue: boolean;
  detectionMethod: DetectionMethod;
  binaryVerified: boolean;
  /** ISO-BMFF major brand where sniffed (avif/heic/…). */
  brand?: string;
  /** True when sizeBytes === 0. */
  isEmpty: boolean;
  note: string;
}

/**
 * Honest per-file lifecycle. Values beyond "queued" exist so later phases and
 * reports share one vocabulary; Phase 1 only ever assigns "queued".
 */
export type OperationState =
  | "queued"
  | "inspecting"
  | "cleaning"
  | "rewriting"
  | "geotagging"
  | "verifying"
  | "ready"
  | "partial"
  | "failed"
  | "cancelled"
  | "not-available";

/** Shared verification vocabulary (spec §5), reused by future reports. */
export type VerificationState =
  | "not-inspected"
  | "not-detected"
  | "detected"
  | "uncertain"
  | "unsupported"
  | "unverified"
  | "verified"
  | "partial"
  | "failed";

/** One file waiting in the upload queue. Metadata fields arrive in Phase 2+. */
export interface QueuedFile {
  id: string;
  /** Original name exactly as provided by the OS picker/drop. */
  name: string;
  /** Sanitized variant reserved for future ZIP/download use. */
  sanitizedName: string;
  sizeBytes: number;
  detected: DetectedFormat;
  status: OperationState;
  addedAt: number;
  /** Optional non-crashing explanation (empty file, unsupported type…). */
  notice?: string;
}

/** A queue entry couples the contract above with the live browser File. */
export interface QueueEntry {
  item: QueuedFile;
  source: File;
}

/** ---- Future engine contracts (skeletal, spec §12) ---- */

export interface InspectionResult {
  format: DetectedFormat;
  /** Phase 2+: per-group findings (exif, xmp, iptc, png-chunks, …). */
  metadataGroups: Record<string, VerificationState>;
  /** Phase 2+: observed tags. Never fabricated. */
  tags: unknown[];
  warnings: string[];
  supportedOperations: Array<"inspect" | "clean" | "rewrite" | "geotag">;
}

export interface MetadataChange {
  namespace: string;
  tag: string;
  oldValue?: unknown;
  expectedValue?: unknown;
  observedValue?: unknown;
  action: "remove" | "update" | "retain";
  verified: boolean;
}

export interface FileOperationResult {
  inputName: string;
  outputName?: string;
  before: InspectionResult | null;
  after: InspectionResult | null;
  changes: MetadataChange[];
  verification: VerificationState;
  status: OperationState;
  errors: string[];
}

export interface OperationRequest {
  operation: "inspect" | "clean" | "rewrite" | "geotag";
  inputFiles: QueuedFile[];
  policy?: "privacy-clean" | "aggressive-strip";
  profileId?: string;
  geo?: { latitude: number; longitude: number; altitude?: number };
}

export interface BatchResult {
  items: FileOperationResult[];
  totals: Record<string, number>;
  startedAt: number;
  finishedAt: number;
  reportOptions: { csv: boolean; pdf: boolean };
}
