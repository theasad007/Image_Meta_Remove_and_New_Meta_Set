/**
 * Phase 4 batch + ZIP contracts. Minimal additions over the Phase 2/3
 * models: per-file results keep living in `FileCleaningResult`, and the ZIP
 * plan maps stable file IDs to archive paths for future Phase 5 reports.
 */

export type BatchStage =
  | "queued"
  | "inspecting"
  | "cleaning"
  | "verifying"
  | "ready"
  | "partial"
  | "failed"
  | "unsupported"
  | "cancelled";

export interface BatchJob {
  jobId: number;
  startedAt: number;
  total: number;
  done: number;
  cancelled: boolean;
}

export interface BatchCounts {
  verified: number;
  unchanged: number;
  partial: number;
  failed: number;
  unsupported: number;
  cancelled: number;
  queued: number;
}

export function emptyBatchCounts(): BatchCounts {
  return { verified: 0, unchanged: 0, partial: 0, failed: 0, unsupported: 0, cancelled: 0, queued: 0 };
}

export interface ZipPlanEntry {
  fileId: string;
  /** Deterministic in-archive path, e.g. `images/photo-clean.jpg`. */
  archivePath: string;
  /** Verified output bytes at plan time (for size estimates). */
  bytes: number;
  /** True when the source result is partially_cleaned (opted in). */
  partial: boolean;
}

export type ZipBuildPhase = "idle" | "archiving" | "ready" | "failed" | "cancelled";

export interface ZipBuildState {
  phase: ZipBuildPhase;
  filesDone: number;
  filesTotal: number;
  bytesWritten: number;
  archiveName?: string;
  archiveBytes?: number;
  entryCount?: number;
  error?: string;
}
