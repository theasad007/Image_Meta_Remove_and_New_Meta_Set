import type {
  ImageInspectionResult,
  InspectionOutcome,
} from "../../../types/inspection";
import type { SniffedKind } from "../../format-detection/signatures";

/**
 * Phase 3 cleaning contracts. The `FileCleaningResult` is the single source
 * of truth for the UI and (later) CSV/PDF reports — counters are derived
 * from `changes`, never invented. A result is only downloadable when its
 * status is `verified_clean`, `partially_cleaned` (explicitly labeled), or
 * `unchanged_no_target_tags`.
 */

export type CleaningPolicyMode = "privacy_safe_default" | "aggressive_when_proven_safe";

export type CleaningTarget = "exif_gps" | "descriptive" | "ai_markers";

export const DEFAULT_CLEANING_TARGETS: CleaningTarget[] = ["exif_gps", "descriptive"];

export interface CleaningPolicy {
  mode: CleaningPolicyMode;
  /** User-selected metadata families. Missing means the legacy all-metadata default. */
  targets?: CleaningTarget[];
  /** Filled from the inspection result when `ai_markers` is selected. */
  aiEvidenceGroups?: string[];
}

export const PRIVACY_SAFE_DEFAULT: CleaningPolicy = {
  mode: "privacy_safe_default",
  targets: DEFAULT_CLEANING_TARGETS,
};

export function resolvesCleaningTarget(
  policy: CleaningPolicy,
  family: "exif_gps" | "descriptive",
): boolean {
  const targets = policy.targets ?? DEFAULT_CLEANING_TARGETS;
  if (targets.includes(family)) return true;
  if (!targets.includes("ai_markers")) return false;
  const groups = new Set((policy.aiEvidenceGroups ?? []).map((group) => group.toUpperCase()));
  if (family === "exif_gps") {
    return groups.has("EXIF") || groups.has("GPS");
  }
  return [...groups].some((group) => group.includes("XMP") || group.includes("IPTC") || group.includes("TEXT"));
}

/**
 * Whether structurally identified C2PA manifest stores are in scope for
 * removal. C2PA carries provenance/descriptive claims and AI-generation
 * signals, so an explicit `descriptive` selection covers it — plus the
 * `ai_markers` scope when the current file's own AI evidence names C2PA.
 * An EXIF+GPS-only (or AI-only without C2PA evidence) selection
 * intentionally preserves C2PA (retained with an explicit scope reason,
 * never silently removed).
 */
export function resolvesC2paRemovalTarget(policy: CleaningPolicy): boolean {
  const targets = policy.targets ?? DEFAULT_CLEANING_TARGETS;
  if (targets.includes("descriptive")) return true;
  if (!targets.includes("ai_markers")) return false;
  return (policy.aiEvidenceGroups ?? []).some((group) => group.toLowerCase().includes("c2pa"));
}

export type ChangeAction =
  | "removed"
  | "retained_technical"
  | "retained_unsupported"
  | "unchanged"
  | "unknown";

export type ChangeVerification = "verified" | "not_verified" | "failed";

export interface MetadataChange {
  group: string;
  key?: string;
  action: ChangeAction;
  before?: string;
  after?: string;
  verification: ChangeVerification;
  reason?: string;
}

export type CleaningStatus =
  | "verified_clean"
  | "partially_cleaned"
  | "unchanged_no_target_tags"
  | "not_verified"
  | "unsupported"
  | "failed"
  | "cancelled";

export interface FileCleaningResult {
  fileId: string;
  inputName: string;
  outputName?: string;
  detectedFormat: SniffedKind;
  detectedBrand?: string;
  /** Bytes before cleaning (for size comparison + source-unchanged proof). */
  inputBytes: number;
  outputBytes?: number;
  before: ImageInspectionResult;
  after?: ImageInspectionResult;
  /** Local-only output. Never serialized, never uploaded. */
  output?: Blob;
  policy: CleaningPolicy;
  status: CleaningStatus;
  changes: MetadataChange[];
  warnings: string[];
  errors: string[];
  cleanedAt: string;
}

/** Outcome mapping for queue badges (cleaning axis, distinct from inspect). */
export type CleaningOutcome = CleaningStatus | "cleaning" | "not-started";

export function isDownloadableStatus(status: CleaningStatus): boolean {
  return (
    status === "verified_clean" ||
    status === "partially_cleaned" ||
    status === "unchanged_no_target_tags"
  );
}

/** Refusal DURING cleaning (structural/unsupported input for the writer). */
export class CleanRefused extends Error {
  readonly status: "unsupported" | "failed";
  constructor(status: "unsupported" | "failed", message: string) {
    super(message);
    this.name = "CleanRefused";
    this.status = status;
  }
}

/**
 * Output filename: sanitized stem + "-clean" + original (lowercase)
 * extension. Extension always preserved — never converted.
 */
export function buildOutputName(inputName: string, extension: string): string {
  const base = (inputName.split(/[\\/]/).pop() ?? "").trim() || "file";
  const dot = base.lastIndexOf(".");
  const stem = (dot > 0 ? base.slice(0, dot) : base).trim() || "file";
  const ext = (extension || "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const cleanStem = stem
    .replace(/[<>:"|?*\x00-\x1f\x7f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100) || "file";
  return `${cleanStem}-clean.${ext}`;
}

/** FNV-1a 32-bit fingerprint for payload-equality checks (not security). */
export function fingerprint(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i] ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export type { InspectionOutcome };
