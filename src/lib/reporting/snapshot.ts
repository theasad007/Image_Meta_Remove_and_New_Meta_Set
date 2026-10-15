import type { FileCleaningResult } from "../metadata/clean/types";
import type { FileRewriteResult } from "../metadata/rewrite/rewrite";
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
 * Canonical snapshot builder (Phase 5, extended Phase 6).
 *
 * One frozen record per input file in queue order — including failures,
 * unsupported, cancelled and never-processed files. Statuses come only
 * from the verified result model; extensions and UI text are never
 * consulted. When a rewrite exists for a file it takes precedence for
 * operation/output/counts (cleaning evidence is carried in `changes` by
 * the rewrite engine for replace mode); the cleaned output remains
 * separately downloadable in the UI.
 */

export interface SnapshotZipMapping {
  fileId: string;
  archivePath: string;
}

export interface SnapshotInput {
  entries: readonly QueueEntry[];
  inspections: Readonly<Record<string, ImageInspectionResult>>;
  cleanings: Readonly<Record<string, FileCleaningResult>>;
  rewrites?: Readonly<Record<string, FileRewriteResult>>;
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

function verificationOf(
  cleaning: FileCleaningResult | undefined,
  rewrite?: FileRewriteResult,
): { status: ReportVerification; method: string } {
  if (rewrite) {
    const rewrites = rewrite.changes.filter((c) => c.action === "rewritten");
    if (rewrites.length === 0) {
      return { status: "not-verified", method: "rewrite byte-verify pipeline" };
    }
    if (rewrites.every((c) => c.verification === "verified")) {
      return { status: "verified", method: "rewrite byte-verify: signature + structure + re-inspect + field re-observation + payload fingerprint" };
    }
    if (rewrites.some((c) => c.verification === "failed")) {
      return { status: "failed-verification", method: "rewrite byte-verify: signature + structure + re-inspect + field re-observation + payload fingerprint" };
    }
    return { status: "partially-verified", method: "rewrite byte-verify: signature + structure + re-inspect + field re-observation + payload fingerprint" };
  }
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
  rewrite?: FileRewriteResult,
): ReportFileStatus {
  if (rewrite) {
    switch (rewrite.status) {
      case "verified_rewritten": return "verified_rewritten";
      case "partially_rewritten": return "partially_rewritten";
      case "unchanged_no_target_tags": return "unchanged_no_target_tags";
      case "failed": return "failed";
      case "unsupported": return "unsupported";
      case "cancelled": return "cancelled";
      case "not_verified": return "not_verified";
    }
  }
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
  rewrite?: FileRewriteResult,
): string {
  if (zipPath) return "";
  if (rewrite) {
    switch (rewrite.status) {
      case "verified_rewritten":
        return "eligible but not selected for this archive";
      case "partially_rewritten":
        return "partial rewrite output excluded by choice (opt-in required)";
      case "failed":
        return `rewrite failed: ${(rewrite.errors[0] ?? "see errors").slice(0, 160)}`;
      case "unsupported":
        return `rewrite unsupported: ${(rewrite.errors[0] ?? "see errors").slice(0, 160)}`;
      case "not_verified":
        return "rewrite output unverified — withheld from archive";
      case "cancelled":
        return "rewrite cancelled before completion";
      default:
        return "no verified rewrite output produced";
    }
  }
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

function toChangeRecords(
  cleaning: FileCleaningResult | undefined,
  rewrite?: FileRewriteResult,
): ReportChangeRecord[] {
  const source = rewrite ?? cleaning;
  if (!source) return [];
  return source.changes.map((change) => ({
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
    const rewrite = input.rewrites?.[entry.item.id];
    const effective = rewrite ?? cleaning;
    const afterResult = rewrite?.after ?? cleaning?.after;
    const archivePath = zipById.get(entry.item.id) ?? "";
    const status = overallStatus(cleaning, before, rewrite);
    const verification = verificationOf(cleaning, rewrite);
    const detectedTags = before?.categories.reduce((sum, c) => sum + c.tags.length, 0) ?? 0;
    const effectiveChanges = effective?.changes ?? [];
    const removed = effectiveChanges.filter((c) => c.action === "removed" && c.verification === "verified").length ?? 0;
    const rewritten = effectiveChanges.filter((c) => c.action === "rewritten" && c.verification === "verified").length ?? 0;
    const retained = effectiveChanges.filter((c) => c.action.startsWith("retained") && c.verification === "verified").length ?? 0;
    const unverified = effectiveChanges.filter((c) => c.verification !== "verified").length ?? 0;
    const warnings = [...(before?.warnings ?? []), ...((effective as { warnings?: string[] } | undefined)?.warnings ?? [])];
    const errors = [...(((effective as { errors?: string[] } | undefined)?.errors) ?? [])];
    if (!before && !cleaning && !rewrite) {
      warnings.unshift("File queued but never inspected or cleaned in this run.");
    }
    const requestedOperation = rewrite ? "rewrite" : cleaning || before ? "clean" : "none";
    const modeLabel = rewrite ? rewrite.mode : cleaning ? cleaning.policy.mode : "";
    return {
      index: position + 1,
      fileId: entry.item.id,
      fileName: entry.item.name,
      mediaType: entry.item.detected.mediaKind,
      actualFormat: before?.detectedFormat ?? entry.item.detected.label.toLowerCase(),
      originalBytes: entry.item.sizeBytes,
      outputName: effective?.outputName ?? "",
      outputBytes: (effective as { outputBytes?: number } | undefined)?.outputBytes !== undefined ? String((effective as { outputBytes?: number }).outputBytes) : "",
      archivePath,
      archiveIncluded: archivePath !== "",
      archiveExclusionReason: exclusionReason(cleaning, archivePath || undefined, before, rewrite),
      requestedOperation,
      cleaningMode: modeLabel,
      startedAt: "",
      finishedAt: rewrite?.rewrittenAt ?? cleaning?.cleanedAt ?? "",
      durationMs: "",
      overallStatus: status,
      verificationStatus: verification.status,
      verificationMethod: verification.method,
      categoriesBefore: toCategoryStates(before, privacy),
      categoriesAfter: toCategoryStates(afterResult, privacy),
      gpsBefore: gpsSummary(before, privacy),
      gpsAfter: afterResult ? gpsSummary(afterResult, privacy) : "not_inspected",
      aiIndicatorsBefore: aiSummary(before),
      c2paState: c2paSummary(before, afterResult),
      detectedTagCount: detectedTags,
      verifiedRemovedCount: removed,
      verifiedRewrittenCount: rewritten,
      retainedCount: retained,
      unverifiedCount: unverified,
      changes: toChangeRecords(cleaning, rewrite),
      warnings,
      errors,
    };
  });

  const totals: ReportTotals = {
    files: records.length,
    verifiedClean: 0, verifiedRewritten: 0, unchanged: 0, partial: 0, failed: 0,
    unsupported: 0, cancelled: 0, notProcessed: 0,
    bytesIn: 0, bytesOut: 0, archiveIncluded: 0, archiveExcluded: 0,
  };
  for (const record of records) {
    switch (record.overallStatus) {
      case "verified_clean": totals.verifiedClean += 1; break;
      case "verified_rewritten": totals.verifiedRewritten += 1; break;
      case "unchanged_no_target_tags": totals.unchanged += 1; break;
      case "partially_cleaned": totals.partial += 1; break;
      case "partially_rewritten": totals.partial += 1; break;
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
