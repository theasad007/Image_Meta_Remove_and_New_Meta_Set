import type { ReportSnapshot } from "../../types/reporting";
import { guardFormulaCell, truncateExport } from "./privacy";

/**
 * RFC-4180 CSV generation (Phase 5). Dependency-free, UTF-8 with BOM for
 * Excel compatibility. Counts come only from verified `changes[]` actions
 * already normalized in the snapshot — never inferred from tag arrays.
 */

export const SUMMARY_COLUMNS = [
  "Index", "Original File Name", "Media Type", "Actual Format", "Original Bytes",
  "Output File Name", "Output Bytes", "Archive Path", "Archive Included",
  "Archive Exclusion Reason", "Requested Operation", "Cleaning Mode",
  "Started At", "Finished At", "Duration Ms", "Overall Status",
  "Verification Status", "Verification Method", "EXIF Before", "XMP Before",
  "IPTC Before", "C2PA Before", "GPS Before", "AI Indicators",
  "Detected Tag Count", "Verified Removed Tag Count", "Verified Rewritten Tag Count",
  "Retained Tag Count", "Unverified/Unsupported Count", "EXIF After",
  "XMP After", "IPTC After", "C2PA After", "GPS After", "Warnings", "Errors",
] as const;

export const TAGS_COLUMNS = [
  "File ID", "Original File Name", "Group", "Tag Key", "Before State",
  "Before Value", "Requested Action", "After State", "After Value",
  "Verification", "Disposition",
] as const;

function escapeCell(text: string): string {
  const guarded = guardFormulaCell(text);
  if (/[",\r\n]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

export function serializeRows(header: readonly string[], rows: string[][]): string {
  const lines = [header.map(escapeCell).join(",")];
  for (const row of rows) {
    if (row.length !== header.length) {
      throw new Error(`CSV row has ${row.length} cells, header has ${header.length}.`);
    }
    lines.push(row.map(escapeCell).join(","));
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

function categoryCell(
  snapshot: ReportSnapshot,
  recordIndex: number,
  when: "categoriesBefore" | "categoriesAfter",
  name: string,
): string {
  const record = snapshot.records[recordIndex];
  if (!record) return "not_inspected";
  const category = record[when].find((c) => c.category === name || c.category.startsWith(name));
  if (!category) return "not_inspected";
  const keys = category.tags.map((t) => t.key);
  const shown = keys.slice(0, 8).join("; ");
  const more = keys.length > 8 ? ` (+${keys.length - 8} more)` : "";
  const values = snapshot.privacy.includeOriginalValues
    ? category.tags.slice(0, 8).map((t) => (t.value === "" ? "" : `=${t.value}`)).filter((v) => v !== "").join("; ")
    : "";
  const base = `${category.status}(${category.tagCount} tags${keys.length > 0 ? `: ${shown}${more}` : ""})`;
  if (values !== "") {
    const { text } = truncateExport(values, 400);
    return `${base} values[${text}]`;
  }
  return base;
}

function warningsCell(items: string[]): string {
  if (items.length === 0) return "";
  const { text } = truncateExport(items.join(" | "), 600);
  return text;
}

export interface CsvBuildProgress {
  rowsDone: number;
  rowsTotal: number;
}

/**
 * Chunked async builder: yields to the UI every 256 rows so 1,000-file
 * reports never freeze the page. Cancellation via `isCancelled`.
 */
export async function buildSummaryCsv(
  snapshot: ReportSnapshot,
  options: { onProgress?: (progress: CsvBuildProgress) => void; isCancelled?: () => boolean } = {},
): Promise<string> {
  const rows: string[][] = [];
  const total = snapshot.records.length;
  for (let i = 0; i < snapshot.records.length; i += 1) {
    if (options.isCancelled?.()) throw new Error("CSV generation cancelled.");
    const record = snapshot.records[i];
    if (!record) continue;
    rows.push([
      String(record.index),
      record.fileName,
      record.mediaType,
      record.actualFormat,
      String(record.originalBytes),
      record.outputName,
      record.outputBytes,
      record.archivePath,
      record.archiveIncluded ? "TRUE" : "FALSE",
      record.archiveExclusionReason,
      record.requestedOperation,
      record.cleaningMode,
      record.startedAt === "" ? "not_recorded" : record.startedAt,
      record.finishedAt === "" ? "not_recorded" : record.finishedAt,
      record.durationMs === "" ? "not_recorded" : record.durationMs,
      record.overallStatus,
      record.verificationStatus,
      record.verificationMethod,
      categoryCell(snapshot, i, "categoriesBefore", "EXIF"),
      categoryCell(snapshot, i, "categoriesBefore", "XMP"),
      categoryCell(snapshot, i, "categoriesBefore", "IPTC"),
      record.c2paState,
      record.gpsBefore,
      record.aiIndicatorsBefore,
      String(record.detectedTagCount),
      String(record.verifiedRemovedCount),
      String(record.verifiedRewrittenCount),
      String(record.retainedCount),
      String(record.unverifiedCount),
      categoryCell(snapshot, i, "categoriesAfter", "EXIF"),
      categoryCell(snapshot, i, "categoriesAfter", "XMP"),
      categoryCell(snapshot, i, "categoriesAfter", "IPTC"),
      record.c2paState,
      record.gpsAfter,
      warningsCell(record.warnings),
      warningsCell(record.errors),
    ]);
    if (i % 256 === 255) {
      options.onProgress?.({ rowsDone: i + 1, rowsTotal: total });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  options.onProgress?.({ rowsDone: total, rowsTotal: total });
  return serializeRows(SUMMARY_COLUMNS, rows);
}

export interface TagsLedgerOptions {
  onProgress?: (progress: CsvBuildProgress) => void;
  isCancelled?: () => boolean;
}

/**
 * One row per observed field/change/operation, keyed by normalized
 * group+key+occurrence. Group-level rows cover not_inspected/unsupported
 * categories with no enumerable tags. Before values obey the snapshot
 * privacy mode (values arrive pre-redacted); after values likewise.
 */
export async function buildTagsCsv(
  snapshot: ReportSnapshot,
  options: TagsLedgerOptions = {},
): Promise<string> {
  const rows: string[][] = [];
  const recordTotal = snapshot.records.length;
  for (let r = 0; r < snapshot.records.length; r += 1) {
    if (options.isCancelled?.()) throw new Error("Tag ledger generation cancelled.");
    const record = snapshot.records[r];
    if (!record) continue;
    const beforeByGroup = new Map(record.categoriesBefore.map((c) => [c.category, c]));
    const afterByGroup = new Map(record.categoriesAfter.map((c) => [c.category, c]));
    const changeByGroupKey = new Map(record.changes.map((c) => [`${c.group}||${c.key}`, c]));
    const seen = new Set<string>();
    const pushRow = (
      group: string, key: string,
      beforeState: string, beforeValue: string,
      action: string, afterState: string, afterValue: string,
      verification: string, disposition: string,
    ) => {
      const id = `${group}||${key}`;
      if (seen.has(id)) return;
      seen.add(id);
      const capped = truncateExport(beforeValue, 400);
      const cappedAfter = truncateExport(afterValue, 400);
      rows.push([
        record.fileId, record.fileName, group, key,
        beforeState, capped.text + (capped.truncated ? " [truncated]" : ""),
        action, afterState,
        cappedAfter.text + (cappedAfter.truncated ? " [truncated]" : ""),
        verification, disposition,
      ]);
    };
    // Before-side enumeration (detected tags + group states).
    for (const category of record.categoriesBefore) {
      if (category.tags.length === 0) {
        pushRow(category.category, "", category.status, "", "none", "not_inspected", "", "not_verified", `group ${category.status}`);
        continue;
      }
      for (const tag of category.tags) {
        const change = changeByGroupKey.get(`${category.category}||${tag.key}`)
          ?? changeByGroupKey.get(`${category.category.split(" ")[0]}||${tag.key}`);
        const afterCategory = afterByGroup.get(category.category);
        const afterTag = afterCategory?.tags.find((t) => t.key === tag.key);
        pushRow(
          category.category, tag.key,
          "detected", tag.value,
          change ? change.action : "none",
          afterCategory ? afterCategory.status : "not_inspected",
          afterTag ? afterTag.value : "",
          change ? change.verification : category.status === "detected" ? "not_verified" : "not_verified",
          change ? `${change.action}/${change.verification}` : "observed-only",
        );
      }
    }
    // After-only and group-level coverage (unsupported/not_inspected afters).
    for (const category of record.categoriesAfter) {
      if (category.tags.length === 0 && !beforeByGroup.has(category.category)) {
        pushRow(category.category, "", "not_inspected", "", "none", category.status, "", "not_verified", `group ${category.status}`);
      }
    }
    if (r % 128 === 127) {
      options.onProgress?.({ rowsDone: r + 1, rowsTotal: recordTotal });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  options.onProgress?.({ rowsDone: recordTotal, rowsTotal: recordTotal });
  return serializeRows(TAGS_COLUMNS, rows);
}
