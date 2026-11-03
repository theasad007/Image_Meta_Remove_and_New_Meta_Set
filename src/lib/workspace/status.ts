/**
 * Screen 04 row status + queue aggregation (pure, no React).
 *
 * Every label below is derived from real engine output only — an
 * inspected-but-not-yet-cleaned image is "Inspected", never "Completed",
 * and aggregates are computed exclusively from per-file inspection
 * results that actually exist.
 */
import type { CleaningStatus, FileCleaningResult } from "../metadata/clean/types";
import type { FileRewriteResult, RewriteStatus } from "../metadata/rewrite/rewrite";
import type { InspectionOutcome } from "../../types/inspection";

export type RowStatusKey =
  | "queued"
  | "inspecting"
  | "inspected"
  | "inspected_partial"
  | "inspected_failed"
  | "unsupported"
  | "cancelled"
  | "processing"
  | "verified_clean"
  | "verified_unchanged"
  | "verified_rewritten"
  | "partial"
  | "failed";

export type RowTone = "neutral" | "busy" | "success" | "warning" | "danger";

export interface RowStatus {
  key: RowStatusKey;
  /** Honest lifecycle label shown in the Status cell. */
  label: string;
  tone: RowTone;
  /** True while the engine is actively working on this row. */
  busy: boolean;
  /** True when a verified, downloadable output exists for this row. */
  verifiedOutput: boolean;
}

export interface RowStateInput {
  inspectionState: InspectionOutcome | "inspecting" | undefined;
  cleaningState: CleaningStatus | "cleaning" | undefined;
  cleaningResult?: FileCleaningResult;
  rewriteState?: RewriteStatus | "rewriting" | undefined;
  rewriteResult?: FileRewriteResult;
}

const INSPECTION_LABELS: Record<InspectionOutcome, RowStatus> = {
  completed: { key: "inspected", label: "Inspected", tone: "success", busy: false, verifiedOutput: false },
  partial: { key: "inspected_partial", label: "Inspected (partial)", tone: "busy", busy: false, verifiedOutput: false },
  failed: { key: "inspected_failed", label: "Inspection failed", tone: "danger", busy: false, verifiedOutput: false },
  unsupported: { key: "unsupported", label: "Unsupported", tone: "neutral", busy: false, verifiedOutput: false },
  cancelled: { key: "cancelled", label: "Cancelled", tone: "neutral", busy: false, verifiedOutput: false },
};

const REWRITE_LABELS: Record<RewriteStatus, RowStatus> = {
  verified_rewritten: { key: "verified_rewritten", label: "Rewritten · verified", tone: "success", busy: false, verifiedOutput: true },
  unchanged_no_target_tags: { key: "verified_unchanged", label: "Verified · unchanged", tone: "success", busy: false, verifiedOutput: true },
  partially_rewritten: { key: "partial", label: "Partial rewrite", tone: "busy", busy: false, verifiedOutput: false },
  not_verified: { key: "failed", label: "Failed", tone: "danger", busy: false, verifiedOutput: false },
  unsupported: { key: "unsupported", label: "Unsupported", tone: "neutral", busy: false, verifiedOutput: false },
  failed: { key: "failed", label: "Failed", tone: "danger", busy: false, verifiedOutput: false },
  cancelled: { key: "cancelled", label: "Cancelled", tone: "neutral", busy: false, verifiedOutput: false },
};

const CLEANING_LABELS: Record<CleaningStatus, RowStatus> = {
  verified_clean: { key: "verified_clean", label: "Cleaned · verified", tone: "success", busy: false, verifiedOutput: true },
  unchanged_no_target_tags: { key: "verified_unchanged", label: "Verified · unchanged", tone: "success", busy: false, verifiedOutput: true },
  partially_cleaned: { key: "partial", label: "Partial", tone: "busy", busy: false, verifiedOutput: false },
  not_verified: { key: "failed", label: "Failed", tone: "danger", busy: false, verifiedOutput: false },
  unsupported: { key: "unsupported", label: "Unsupported", tone: "neutral", busy: false, verifiedOutput: false },
  failed: { key: "failed", label: "Failed", tone: "danger", busy: false, verifiedOutput: false },
  cancelled: { key: "cancelled", label: "Cancelled", tone: "neutral", busy: false, verifiedOutput: false },
};

/**
 * Resolve the honest life-cycle state of one queue row. Precedence:
 * active work ("Processing…") → verified rewrite → cleaning result →
 * inspection state → queued waiting state.
 */
export function deriveRowStatus(input: RowStateInput): RowStatus {
  const {
    inspectionState,
    cleaningState,
    cleaningResult,
    rewriteState,
    rewriteResult,
  } = input;

  if (cleaningState === "cleaning" || rewriteState === "rewriting") {
    return { key: "processing", label: "Processing…", tone: "busy", busy: true, verifiedOutput: false };
  }

  // A downloadable verified rewrite describes the row's final state.
  if (rewriteResult) {
    const rewrite = REWRITE_LABELS[rewriteResult.status];
    const rewriteHasOutput = rewriteResult.status === "verified_rewritten"
      || rewriteResult.status === "unchanged_no_target_tags";
    if (rewriteHasOutput || !cleaningResult?.output) {
      return rewrite.key === "partial" ? { ...rewrite, verifiedOutput: true } : rewrite;
    }
  }

  if (cleaningResult) {
    const mapped = CLEANING_LABELS[cleaningResult.status] ?? CLEANING_LABELS["cancelled"];
    return mapped.key === "partial" ? { ...mapped, verifiedOutput: true } : mapped;
  }

  if (inspectionState === "inspecting") {
    return { key: "inspecting", label: "Inspecting…", tone: "busy", busy: true, verifiedOutput: false };
  }

  if (inspectionState) {
    return INSPECTION_LABELS[inspectionState];
  }

  return { key: "queued", label: "Queued", tone: "neutral", busy: false, verifiedOutput: false };
}
