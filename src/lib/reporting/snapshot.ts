import type { FileCleaningResult } from "../metadata/clean/types";
import type { QueueEntry } from "../../types/media";
import type { ImageInspectionResult } from "../../types/inspection";
import type {
  ReportCategoryState,
  ReportChangeRecord,
  ReportFileRecord,
  ReportFileStatus,
  ReportOptions,
  ReportSnapshot,
  ReportTotals,
  ReportVerification,
} from "../../types/reporting";
import type { PrivacyMode } from "./privacy";

/**
 * Canonical snapshot builder (Phase 5).
 *
 * One frozen record per input file in queue order — including failures,
 * unsupported, cancelled and never-processed files. Statuses come only
 * from the verified result model; extensions and UI text are never
 * consulted. Rewrites are zero/not-applicable until Phase 6.
 */

export interface SnapshotZipMapping {
  fileId: string;
  archivePath: string;
}

export interface SnapshotInput {
  entries: readonly QueueEntry[];
  inspections: Readonly<Record<string, ImageInspectionResult>>;
  cleanings: Readonly<Record<string, FileCleaningResult>>;
  /** Manifest captured at the export boundary (eligible files only). */
  zipMapping: readonly SnapshotZipMapping[];
  options: ReportOptions;
  scopeId: string;
  operation?: string;
  generatedAt?: string;
}


function gpsSummary(
  before: ImageInspectionResult | undefined,
  privacy: PrivacyMode,
): string {
  const category = before?.categories.find((c) => c.category === "GPS");
  if (!category) return "not_inspected";
  if (category.status === "not_detected") return "not_detected";
  if (category.status === "uncertain" || category.status === "failed") return category.status;
  if (category.status !== "detected") return category.status;
  if (privacy === "detailed-values") {
    const lat = category.tags.find((t) => t.key === "Latitude")?.displayedValue ?? "?";
    const lon = category.tags.find((t) => t.key === "Longitude")?.displayedValue ?? "?";
    return `detected(${lat},${lon})`;
  }
  return "detected(location withheld)";
}

function aiSummary(before: ImageInspectionResult | undefined): string {
  const indicators = before?.aiIndicators ?? [];
  if (indicators.length === 0) return "none";
  const explicit = indicators.filter((i) => i.confidence === "explicit").length;
  const possible = indicators.length - explicit;
  const keys = [...new Set(indicators.map((i) => i.evidenceKey))].slice(0, 5).join(",");
  return `${indicators.length} (${explicit} explicit, ${possible} possible${keys ? `; ${keys}` : ""}) — clues only, never proof`;
}

function c2paSummary(
  before: ImageInspectionResult | undefined,
  after: ImageInspectionResult | undefined,
): string {
  const states: string[] = [];
  for (const result of [before, after]) {
    const status = result?.categories.find((c) => c.category.startsWith("C2PA"))?.status;
    if (typeof status === "string") states.push(status);
  }
  if (states.length === 0) return "not_inspected";
  if (states.some((s) => s !== "not_inspected")) return states.join("/");
  return "not_inspected";
}

function verificationOf(cleaning: FileCleaningResult | undefined): { status: ReportVerification; method: string } {
  if (!cleaning) return { status: "not-verified", method: "not attempted" };
  const removals = cleaning.changes.filter((c) => c.action === "removed");
  if (removals.length === 0) {
    return cleaning.status === "unchanged_no_target_tags"
      ? { status: "not-applicable", method: "no removable targets found" }
      : { status: "not-verified", method: "byte-verify pipeline" };
  }
  if (removals.every((c) => c.verification === "verified")) {
    return { status: "verified", method: "byte-verify: signature + structure + re-inspect + payload fingerprint" };
  }
  if (removals.some((c) => c.verification === "failed")) {
    return { status: "failed-verification", method: "byte-verify: signature + structure + re-inspect + payload fingerprint" };
  }
  return { status: "partially-verified", method: "byte-verify: signature + structure + re-inspect + payload fingerprint" };
}

function overallStatus(
  cleaning: FileCleaningResult | undefined,
  inspection: ImageInspectionResult | undefined,
): ReportFileStatus {
  if (cleaning) {
    switch (cleaning.status) {
      case "verified_clean": return "verified_clean";
      case "partially_cleaned": return "partially_cleaned";
      case "unchanged_no_target_tags": return "unchanged_no_target_tags";
      case "failed": return "failed";
      case "unsupported": return "unsupported";
      case "cancelled": return "cancelled";
      case "not_verified": return "not_verified";
    }
  }
  if (inspection) {
    switch (inspection.outcome) {
      case "completed": return "not_processed";
      case "partial": return "not_processed";
      case "failed": return "failed";
      case "unsupported": return "unsupported";
      case "cancelled": return "cancelled";
    }
  }
  return "not_processed";
}

function exclusionReason(
  cleaning: FileCleaningResult | undefined,
  zipPath: string | undefined,
  inspection: ImageInspectionResult | undefined,
): string {
  if (zipPath) return "";
  if (!cleaning) {
    return inspection ? "cleaner never run on this file" : "never inspected or cleaned";
  }
  switch (cleaning.status) {
    case "verified_clean":
    case "unchanged_no_target_tags":
      return "eligible but not selected for this archive";
    case "partially_cleaned":
      return "partial output excluded by choice (opt-in required)";
    case "failed":
      return `cleaning failed: ${(cleaning.errors[0] ?? "see errors").slice(0, 160)}`;
    case "unsupported":
      return `unsupported: ${(cleaning.errors[0] ?? "see errors").slice(0, 160)}`;
    case "not_verified":
      return "output unverified — withheld from archive";
    case "cancelled":
      return "processing cancelled before completion";
    default:
      return "no verified output produced";
  }
}

function toCategoryStates(
  result: ImageInspectionResult | undefined,
  privacy: PrivacyMode,
): ReportCategoryState[] {
  if (!result) return [];
  return result.categories.map((category) => ({
    category: category.category,
    status: category.status,
    tagCount: category.tags.length,
    tags: category.tags.map((tag) => ({
      key: tag.key,
      value: privacy === "detailed-values" ? tag.displayedValue : "",
    })),
    warnings: category.warnings,
  }));
}

function toChangeRecords(cleaning: FileCleaningResult | undefined): ReportChangeRecord[] {
  if (!cleaning) return [];
  return cleaning.changes.map((change) => ({
    group: change.group,
    key: change.key ?? "",
    action: change.action,
    before: change.before ?? "",
    after: change.after ?? "",
    verification: change.verification,
  }));
}

export function buildReportSnapshot(input: SnapshotInput): ReportSnapshot {
  const privacy: PrivacyMode = input.options.includeOriginalValues ? "detailed-values" : "summary";
  const zipById = new Map(input.zipMapping.map((m) => [m.fileId, m.archivePath]));
  const records: ReportFileRecord[] = input.entries.map((entry, position) => {
    const before = input.inspections[entry.item.id];
    const cleaning = input.cleanings[entry.item.id];
    const archivePath = zipById.get(entry.item.id) ?? "";
    const status = overallStatus(cleaning, before);
    const verification = verificationOf(cleaning);
    const detectedTags = before?.categories.reduce((sum, c) => sum + c.tags.length, 0) ?? 0;
    const removed = cleaning?.changes.filter((c) => c.action === "removed" && c.verification === "verified").length ?? 0;
    const retained = cleaning?.changes.filter((c) => c.action.startsWith("retained") && c.verification === "verified").length ?? 0;
    const unverified = cleaning?.changes.filter((c) => c.verification !== "verified").length ?? 0;
    const warnings = [...(before?.warnings ?? []), ...(cleaning?.warnings ?? [])];
    const errors = [...(cleaning?.errors ?? [])];
    if (!before && !cleaning) {
      warnings.unshift("File queued but never inspected or cleaned in this run.");
    }
    return {
      index: position + 1,
      fileId: entry.item.id,
      fileName: entry.item.name,
      mediaType: entry.item.detected.mediaKind,
      actualFormat: before?.detectedFormat ?? entry.item.detected.label.toLowerCase(),
      originalBytes: entry.item.sizeBytes,
      outputName: cleaning?.outputName ?? "",
      outputBytes: cleaning?.outputBytes !== undefined ? String(cleaning.outputBytes) : "",
      archivePath,
      archiveIncluded: archivePath !== "",
      archiveExclusionReason: exclusionReason(cleaning, archivePath || undefined, before),
      requestedOperation: cleaning || before ? "clean" : "none",
      cleaningMode: cleaning ? cleaning.policy.mode : "",
      startedAt: "",
      finishedAt: cleaning?.cleanedAt ?? "",
      durationMs: "",
      overallStatus: status,
      verificationStatus: verification.status,
      verificationMethod: verification.method,
      categoriesBefore: toCategoryStates(before, privacy),
      categoriesAfter: toCategoryStates(cleaning?.after, privacy),
      gpsBefore: gpsSummary(before, privacy),
      gpsAfter: cleaning?.after ? gpsSummary(cleaning.after, privacy) : "not_inspected",
      aiIndicatorsBefore: aiSummary(before),
      c2paState: c2paSummary(before, cleaning?.after),
      detectedTagCount: detectedTags,
      verifiedRemovedCount: removed,
      verifiedRewrittenCount: 0,
      retainedCount: retained,
      unverifiedCount: unverified,
      changes: toChangeRecords(cleaning),
      warnings,
      errors,
    };
  });

  const totals: ReportTotals = {
    files: records.length,
    verifiedClean: 0, unchanged: 0, partial: 0, failed: 0,
    unsupported: 0, cancelled: 0, notProcessed: 0,
    bytesIn: 0, bytesOut: 0, archiveIncluded: 0, archiveExcluded: 0,
  };
  for (const record of records) {
    switch (record.overallStatus) {
      case "verified_clean": totals.verifiedClean += 1; break;
      case "unchanged_no_target_tags": totals.unchanged += 1; break;
      case "partially_cleaned": totals.partial += 1; break;
      case "failed":
      case "not_verified": totals.failed += 1; break;
      case "unsupported": totals.unsupported += 1; break;
      case "cancelled": totals.cancelled += 1; break;
      default: totals.notProcessed += 1; break;
    }
    totals.bytesIn += record.originalBytes;
    const outBytes = Number(record.outputBytes);
    if (Number.isFinite(outBytes) && outBytes > 0) totals.bytesOut += outBytes;
    if (record.archiveIncluded) totals.archiveIncluded += 1;
    else totals.archiveExcluded += 1;
  }

  const policies = new Set(records.map((r) => r.cleaningMode).filter((m) => m !== ""));
  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    scopeId: input.scopeId,
    operation: input.operation ?? "clean",
    policy: policies.size === 1 ? [...policies][0] as string : policies.size === 0 ? "" : "mixed",
    privacy: { includeOriginalValues: input.options.includeOriginalValues, detail: input.options.detail },
    records,
    totals,
  };
}
