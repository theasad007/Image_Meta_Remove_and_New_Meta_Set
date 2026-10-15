/**
 * Phase 5 reporting contracts.
 *
 * The `ReportSnapshot` is built once per export from queue order +
 * inspection/cleaning results + the ZIP manifest captured at the export
 * boundary, then frozen. CSV, PDF and ZIP-embedded reports all derive from
 * the same snapshot — never from UI text, extensions, or second guesses.
 * Rewrites/geotags are zero/not-applicable until Phases 6–7 feed this
 * same adapter.
 */

export type ReportFormat = "none" | "csv" | "pdf" | "both";
export type ReportDetail = "summary" | "detailed";

export interface ReportOptions {
  format: ReportFormat;
  detail: ReportDetail;
  /** False by default: original metadata values stay redacted. */
  includeOriginalValues: boolean;
}

export const DEFAULT_REPORT_OPTIONS: ReportOptions = {
  format: "none",
  detail: "summary",
  includeOriginalValues: false,
};

export type ReportFileStatus =
  | "verified_clean"
  | "verified_rewritten"
  | "partially_cleaned"
  | "partially_rewritten"
  | "unchanged_no_target_tags"
  | "failed"
  | "unsupported"
  | "cancelled"
  | "not_verified"
  | "not_processed";

export type ReportVerification =
  | "verified"
  | "partially-verified"
  | "failed-verification"
  | "not-applicable"
  | "not-verified";

export interface ReportCategoryState {
  category: string;
  status: string;
  tagCount: number;
  /** Tag keys always; values only when privacy opts in. */
  tags: { key: string; value: string }[];
  warnings: string[];
}

export interface ReportChangeRecord {
  group: string;
  key: string;
  action: string;
  before: string;
  after: string;
  verification: string;
}

export interface ReportFileRecord {
  index: number;
  fileId: string;
  fileName: string;
  mediaType: string;
  actualFormat: string;
  originalBytes: number;
  outputName: string;
  outputBytes: string;
  archivePath: string;
  archiveIncluded: boolean;
  archiveExclusionReason: string;
  requestedOperation: string;
  cleaningMode: string;
  startedAt: string;
  finishedAt: string;
  durationMs: string;
  overallStatus: ReportFileStatus;
  verificationStatus: ReportVerification;
  verificationMethod: string;
  categoriesBefore: ReportCategoryState[];
  categoriesAfter: ReportCategoryState[];
  gpsBefore: string;
  gpsAfter: string;
  aiIndicatorsBefore: string;
  c2paState: string;
  detectedTagCount: number;
  verifiedRemovedCount: number;
  verifiedRewrittenCount: number;
  retainedCount: number;
  unverifiedCount: number;
  changes: ReportChangeRecord[];
  warnings: string[];
  errors: string[];
}

export interface ReportTotals {
  files: number;
  verifiedClean: number;
  verifiedRewritten: number;
  unchanged: number;
  partial: number;
  failed: number;
  unsupported: number;
  cancelled: number;
  notProcessed: number;
  bytesIn: number;
  bytesOut: number;
  archiveIncluded: number;
  archiveExcluded: number;
}

export interface ReportSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  scopeId: string;
  operation: string;
  policy: string;
  privacy: { includeOriginalValues: boolean; detail: ReportDetail };
  records: ReportFileRecord[];
  totals: ReportTotals;
}
