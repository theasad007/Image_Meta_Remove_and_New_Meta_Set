/**
 * Screen 04 workspace aggregations.
 *
 * Every number is computed from committed engine data only. Nothing here
 * invents a finding: files without an inspection contribute to
 * "pending" context instead of pretending categories are zero, and
 * unsupported/error states are surfaced, never folded into 0.
 */
import { formatBytes } from "../format-detection/format-bytes";
import type {
  ImageInspectionResult,
  InspectionOutcome,
} from "../../types/inspection";
import type { QueueEntry } from "../../types/media";
import type { WorkspaceTool } from "./actions";

export interface QueueTotals {
  files: number;
  bytes: number;
  sizeLabel: string;
  /** Files whose inspection finished (any honest outcome). */
  inspectedFiles: number;
  /** Files still queued or mid-inspection (context: totals are partial). */
  pendingFiles: number;
  /** Files the engine cannot inspect (unsupported/failed inspection). */
  inspectionBlockedFiles: number;
  aiIndicators: number;
  /** Files carrying a detected C2PA manifest store. */
  c2paManifests: number;
  exifTags: number;
  /** Files with detected GPS coordinates. */
  gpsLocations: number;
  gpsTags: number;
  xmpTags: number;
  iptcTags: number;
}

export function isInspectionBlocked(outcome: InspectionOutcome): boolean {
  return outcome === "failed" || outcome === "unsupported" || outcome === "cancelled";
}

function categoryOf(
  result: ImageInspectionResult,
  prefix: string,
): ImageInspectionResult["categories"][number] | undefined {
  const lowered = prefix.toLowerCase();
  return result.categories.find((item) => item.category.toLowerCase().startsWith(lowered));
}

/** Per-row badge counts from one inspection result. */
export function fileCountsOf(result: ImageInspectionResult): {
  ai: number;
  c2pa: number;
  exif: number;
  gps: number;
  xmp: number;
  iptc: number;
} {
  const count = (prefix: string) => {
    const category = categoryOf(result, prefix);
    if (!category || category.status !== "detected") return 0;
    return category.tags.length;
  };
  return {
    ai: result.aiIndicators.length,
    c2pa: count("c2pa"),
    exif: count("exif"),
    gps: count("gps"),
    xmp: count("xmp"),
    iptc: count("iptc"),
  };
}

/**
 * Sidebar totals. Only files with an actual inspection result feed the
 * category sums; every other file is counted as pending (or blocked),
 * so totals are never presented as final while inspection is incomplete.
 */
export function aggregateQueue(
  entries: QueueEntry[],
  results: Record<string, ImageInspectionResult>,
): QueueTotals {
  const totals: QueueTotals = {
    files: entries.length,
    bytes: 0,
    sizeLabel: formatBytes(0),
    inspectedFiles: 0,
    pendingFiles: 0,
    inspectionBlockedFiles: 0,
    aiIndicators: 0,
    c2paManifests: 0,
    exifTags: 0,
    gpsLocations: 0,
    gpsTags: 0,
    xmpTags: 0,
    iptcTags: 0,
  };
  totals.bytes = entries.reduce((sum, entry) => sum + entry.source.size, 0);
  totals.sizeLabel = formatBytes(totals.bytes);

  for (const entry of entries) {
    const result = results[entry.item.id];
    if (!result) {
      totals.pendingFiles += 1;
      continue;
    }
    totals.inspectedFiles += 1;
    if (isInspectionBlocked(result.outcome)) {
      totals.inspectionBlockedFiles += 1;
      continue;
    }
    const counts = fileCountsOf(result);
    totals.aiIndicators += counts.ai;
    totals.exifTags += counts.exif;
    totals.xmpTags += counts.xmp;
    totals.iptcTags += counts.iptc;
    totals.gpsTags += counts.gps;
    if (counts.gps > 0) totals.gpsLocations += 1;
    // A manifest store is a per-file fact; the tag list describes it.
    const c2pa = categoryOf(result, "c2pa");
    if (c2pa?.status === "detected") totals.c2paManifests += 1;
  }
  return totals;
}

/**
 * Honest metadata chips for the Screen 04 table.
 */

export interface MetadataChip {
  key: string;
  label: string;
  /** Numeric count, 0 counted zero, or null when the group is unknown. */
  value: number | null;
  detected: boolean;
  /** True when the engine could not determine the group (not a zero). */
  unresolved: boolean;
  title: string;
  tone: "neutral" | "blue" | "red";
}

function categoryChip(
  key: string,
  label: string,
  result: ImageInspectionResult,
  prefix: string,
  tone: "blue" | "red",
): MetadataChip {
  const category = categoryOf(result, prefix);
  if (!category) {
    return {
      key, label, value: null, detected: false, unresolved: true,
      title: "This group is unavailable for this file.", tone: "neutral",
    };
  }
  if (category.status === "detected") {
    return {
      key, label, value: category.tags.length, detected: category.tags.length > 0, unresolved: false,
      title: `${category.tags.length} ${label} item(s) detected.`, tone,
    };
  }
  if (category.status === "not_detected") {
    return { key, label, value: 0, detected: false, unresolved: false, title: `Inspected; no ${label} items detected.`, tone: "neutral" };
  }
  if (category.status === "failed") {
    return { key, label, value: null, detected: false, unresolved: true, title: `Inspection failed for the ${label} group.`, tone: "neutral" };
  }
  if (category.status === "uncertain") {
    return { key, label, value: null, detected: false, unresolved: true, title: `Inspection was uncertain for the ${label} group.`, tone: "neutral" };
  }
  return {
    key, label, value: null, detected: false, unresolved: true,
    title: `${label} has not been inspected (${category.status.replace(/_/g, " ")}).`, tone: "neutral",
  };
}

/**
 * Row metadata chips. Order follows the active tool's priority;
 * XMP/IPTC appear only when actually detected (space permitted).
 */
export function chipsFor(
  result: ImageInspectionResult,
  activeTool: WorkspaceTool,
): MetadataChip[] {
  const aiCategory = categoryOf(result, "c2pa");
  const unresolvedAiCoverage =
    aiCategory?.status === "not_inspected" || aiCategory?.status === "unsupported" || aiCategory?.status === "failed";
  const ai: MetadataChip = result.aiIndicators.length > 0
    ? {
        key: "ai", label: "AI", value: result.aiIndicators.length, detected: true, unresolved: false,
        title: `${result.aiIndicators.length} qualified AI metadata indicator(s). Metadata inspection, not visual AI detection.`,
        tone: "red",
      }
    : unresolvedAiCoverage
      ? {
          key: "ai", label: "AI", value: null, detected: false, unresolved: true,
          title: "AI evidence is not fully inspected because C2PA coverage is incomplete.", tone: "neutral",
        }
      : {
          key: "ai", label: "AI", value: 0, detected: false, unresolved: false,
          title: "Inspected; no qualified AI metadata indicators detected.", tone: "neutral",
        };
  const c2pa = categoryChip("c2pa", "C2PA", result, "c2pa", "blue");
  const exif = categoryChip("exif", "EXIF", result, "exif", "blue");
  const gps = categoryChip("gps", "GPS", result, "gps", "blue");
  const xmp = categoryChip("xmp", "XMP", result, "xmp", "blue");
  const iptc = categoryChip("iptc", "IPTC", result, "iptc", "blue");

  const base: MetadataChip[] = activeTool === "ai_metadata"
    ? [ai, c2pa, exif, gps]
    : [exif, gps, ai, c2pa];
  const extras = [xmp, iptc].filter((chip) => chip.detected);
  return [...base, ...extras];
}

/**
 * Pixel dimensions when the engine reports them (container/EXIF
 * technical groups). Null otherwise — never invented for display.
 */
export function dimensionsOf(result: ImageInspectionResult): string | null {
  let width: number | null = null;
  let height: number | null = null;
  for (const category of result.categories) {
    // Technical geometry lives in dedicated "(technical)" category names
    // (PNG header, JPEG details, container details …). `technical` is a
    // per-TAG property, not a category property, so gate on the name.
    if (!/technical|details|header|container/i.test(category.category)) continue;
    for (const tag of category.tags) {
      const key = tag.key.toLowerCase();
      const value = Number(tag.displayedValue);
      if (!Number.isFinite(value) || value <= 0) continue;
      if (width === null && /image width|pixelx/.test(key)) width = value;
      if (height === null && /image height|pixely/.test(key)) height = value;
    }
  }
  if (width && height) return `${width} × ${height}`;
  return null;
}
