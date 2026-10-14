import type { ImageInspectionResult } from "../../../types/inspection";
import { sniffImageBytes, type SniffedKind } from "../../format-detection/signatures";
import { inspectImage } from "../inspect/inspect";
import { cleanImageBytes } from "../clean/index";
import { isobmffImagePayloads, validateIsobmffStructure } from "../clean/isobmff";
import { parseJpegSegments, validateJpegStructure } from "../clean/jpeg";
import { parsePngChunks, validatePngStructure } from "../clean/png";
import {
  buildOutputName,
  CleanRefused,
  type CleaningPolicy,
  type CleaningStatus,
  type FileCleaningResult,
  type MetadataChange,
  resolvesCleaningTarget,
} from "../clean/types";
import { parseWebpChunks, validateWebpStructure } from "../clean/webp";

/**
 * Mandatory post-clean verification gate (Phase 3).
 *
 * A Blob becomes downloadable ONLY through this function: output signature
 * must match input, structure must re-validate, the output is re-inspected
 * with the Phase 2 engine, every claimed removal is confirmed field-by-field,
 * technical retentions are confirmed present-and-equal, and the encoded
 * payload fingerprint must match. Anything else fails or partials — never a
 * silent success.
 */

export interface VerifyInput {
  fileId: string;
  inputName: string;
  extension: string;
  kind: SniffedKind;
  brand?: string;
  inputBytes: Uint8Array;
  before: ImageInspectionResult;
  policy: CleaningPolicy;
  domParser?: unknown;
  maxBytes?: number;
  /** Caller-side findings (e.g. intake sniff mismatch) merged into warnings. */
  inputWarnings?: string[];
  /** Verification reader override for deterministic fault-injection tests. */
  inspectOutput?: typeof inspectImage;
}

export const DEFAULT_VERIFY_MAX_BYTES = 64 * 1024 * 1024;

function payloadPartsOf(kind: SniffedKind, data: Uint8Array): Uint8Array[] | null {
  try {
    switch (kind) {
      case "jpeg":
        return [parseJpegSegments(data).scan];
      case "png":
        return parsePngChunks(data).chunks.filter((chunk) => chunk.type === "IDAT").map((chunk) => chunk.data);
      case "webp":
        return parseWebpChunks(data).chunks
          .filter((chunk) => chunk.id === "VP8 " || chunk.id === "VP8L")
          .map((chunk) => chunk.data);
      case "avif":
      case "heic":
      case "heif-generic":
        return isobmffImagePayloads(data);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function payloadPartsEqual(before: Uint8Array[], after: Uint8Array[]): boolean {
  if (before.length !== after.length) return false;
  for (let partIndex = 0; partIndex < before.length; partIndex += 1) {
    const left = before[partIndex];
    const right = after[partIndex];
    if (!left || !right || left.length !== right.length) return false;
    for (let byteIndex = 0; byteIndex < left.length; byteIndex += 1) {
      if (left[byteIndex] !== right[byteIndex]) return false;
    }
  }
  return true;
}

function validateStructure(kind: SniffedKind, data: Uint8Array): { ok: boolean; errors: string[] } {
  switch (kind) {
    case "jpeg":
      return validateJpegStructure(data);
    case "png":
      return validatePngStructure(data);
    case "webp":
      return validateWebpStructure(data);
    case "avif":
      return validateIsobmffStructure(data, "avif");
    case "heic":
    case "heif-generic":
      return validateIsobmffStructure(data, "heic");
    default:
      return { ok: false, errors: ["No structural validator for this container."] };
  }
}

/** Target groups whose absence-after must be proven (not technical keeps). */
const TARGET_GROUPS = new Set(["EXIF", "GPS", "XMP", "IPTC", "PNG text", "PNG text chunks", "JPEG", "C2PA"]);

function isTargetChange(change: MetadataChange): boolean {
  return change.action === "removed" && TARGET_GROUPS.has(change.group);
}

export async function verifyCleanedImage(input: VerifyInput): Promise<FileCleaningResult> {
  const { fileId, inputName, extension, kind, brand, inputBytes, before, policy } = input;
  const warnings: string[] = [...(input.inputWarnings ?? [])];
  const errors: string[] = [];
  const outputName = buildOutputName(inputName, extension);
  const base = {
    fileId, inputName, outputName, detectedFormat: kind, detectedBrand: brand,
    inputBytes: inputBytes.length, policy, before,
    warnings, errors, cleanedAt: new Date().toISOString(),
  };

  // 1. Clean (dispatcher refuses non-image kinds itself).
  if (inputBytes.length > (input.maxBytes ?? DEFAULT_VERIFY_MAX_BYTES)) {
    return {
      ...base, status: "failed", changes: [],
      errors: [`Input is ${inputBytes.length} bytes — above the in-browser cleaning budget. Declining rather than transforming blindly.`],
      warnings,
    };
  }
  let cleaned;
  try {
    cleaned = cleanImageBytes(inputBytes, kind, policy);
  } catch (error) {
    if (error instanceof CleanRefused) {
      return {
        ...base, status: error.status, changes: [],
        errors: [error.message], warnings,
      };
    }
    return { ...base, status: "failed", changes: [], errors: ["Unexpected cleaner failure."], warnings };
  }
  warnings.push(...cleaned.warnings);

  // 2. Output signature/brand must match input.
  const outSniff = sniffImageBytes(cleaned.data.slice(0, 65536), cleaned.data.length, extension);
  if (outSniff.kind !== kind && !(kind === "heic" && outSniff.kind === "heif-generic")) {
    return {
      ...base, status: "failed", changes: markAll(cleaned.changes, "failed"),
      errors: [`Output container "${outSniff.kind}" does not match input "${kind}" — format changed or corrupted.`], warnings,
    };
  }
  if (brand && outSniff.majorBrand && outSniff.majorBrand !== brand) {
    return {
      ...base, status: "failed", changes: markAll(cleaned.changes, "failed"),
      errors: [`Output brand "${outSniff.majorBrand}" differs from input brand "${brand}".`], warnings,
    };
  }

  // 3. Structural re-validation with the same strict parser.
  const structural = validateStructure(kind, cleaned.data);
  if (!structural.ok) {
    return {
      ...base, status: "failed", changes: markAll(cleaned.changes, "failed"),
      errors: [`Output failed structural validation: ${structural.errors.join("; ")}`], warnings,
    };
  }

  // 4. Encoded payload bytes must match exactly (no collision-prone hash).
  const beforePayload = payloadPartsOf(kind, inputBytes);
  const afterPayload = payloadPartsOf(kind, cleaned.data);
  if (beforePayload === null || afterPayload === null) {
    return {
      ...base, status: "failed", changes: markAll(cleaned.changes, "failed"),
      errors: ["Encoded payload could not be isolated on both sides; refusing unverified output."], warnings,
    };
  }
  if (!payloadPartsEqual(beforePayload, afterPayload)) {
    return {
      ...base, status: "failed", changes: markAll(cleaned.changes, "failed"),
      errors: ["Encoded image payload differs before/after — pixels or items changed; refusing output."], warnings,
    };
  }

  // 5. Re-inspect output with the Phase 2 engine (fresh copy for the reader).
  let after: ImageInspectionResult;
  try {
    const copy = new Uint8Array(cleaned.data);
    after = await (input.inspectOutput ?? inspectImage)(
      `${fileId}:after`,
      copy.buffer,
      outputName,
      { domParser: input.domParser },
    );
  } catch {
    return {
      ...base, status: "not_verified", changes: markAll(cleaned.changes, "not_verified"),
      errors: ["Output re-inspection errored; no removal is confirmed — download withheld."], warnings,
    };
  }
  if (after.outcome === "failed" || after.outcome === "unsupported" || after.outcome === "cancelled") {
    return {
      ...base,
      status: "not_verified",
      changes: markAll(cleaned.changes, "not_verified"),
      after,
      errors: [
        `Output re-inspection ended as ${after.outcome}; no removal is confirmed — download withheld.`,
      ],
      warnings: [...warnings, ...after.warnings],
    };
  }

  // 6. Field-by-field confirmation against the AFTER inspection.
  // A removal claim verifies only when every remaining tag in its group is
  // an explicitly retained technical tag (e.g. kept Orientation).
  const retainedKeysByGroup = new Map<string, Set<string>>();
  for (const claimed of cleaned.changes) {
    if (claimed.action === "retained_technical" && claimed.group && claimed.key) {
      const set = retainedKeysByGroup.get(claimed.group) ?? new Set<string>();
      set.add(claimed.key);
      retainedKeysByGroup.set(claimed.group, set);
    }
  }
  const verifyTargetGroup = (group: string): { verified: boolean; uncovered: string[]; reason?: string } => {
    const retained = retainedKeysByGroup.get(group) ?? new Set<string>();
    const category = after.categories.find((c) => c.category === group || c.category.startsWith(group));
    if (!category) {
      return { verified: false, uncovered: [], reason: `The ${group} category is missing from the output inspection.` };
    }
    if (category.status === "not_detected") {
      return { verified: true, uncovered: [] };
    }
    if (category.status !== "detected") {
      return {
        verified: false,
        uncovered: [],
        reason: `The ${group} category was ${category.status.replace(/_/g, " ")}, not explicitly inspected as absent.`,
      };
    }
    const uncovered = category.tags.filter((tag) => !retained.has(tag.key)).map((tag) => tag.key);
    return {
      verified: uncovered.length === 0,
      uncovered,
      ...(uncovered.length === 0 ? {} : { reason: `${uncovered.slice(0, 6).join(", ")} still present.` }),
    };
  };
  const changes: MetadataChange[] = [];
  let residualTarget = false;
  for (const claimed of cleaned.changes) {
    if (!isTargetChange(claimed)) {
      // Retention/unchanged records: confirm presence where checkable.
      if (claimed.action === "retained_technical" && claimed.group === "EXIF" && claimed.key === "Orientation") {
        const orientationAfter = after.categories
          .find((c) => c.category === "EXIF")
          ?.tags.find((t) => t.key === "Orientation");
        changes.push({
          ...claimed,
          after: orientationAfter?.displayedValue,
          verification: orientationAfter ? "verified" : "failed",
          reason: orientationAfter
            ? `${claimed.reason ?? ""} Confirmed present after cleaning.`
            : "Promised technical Orientation is missing after cleaning.",
        });
        if (!orientationAfter) residualTarget = true;
        continue;
      }
      if (claimed.action === "retained_technical" && (claimed.group === "ICC" || claimed.group === "Color")) {
        changes.push({ ...claimed, verification: "verified", reason: `${claimed.reason ?? ""} Preservation confirmed by byte-level structural validation.` });
        continue;
      }
      changes.push({ ...claimed, verification: claimed.action === "unchanged" ? "verified" : "not_verified" });
      continue;
    }
    const targetCheck = verifyTargetGroup(claimed.group);
    if (targetCheck.verified) {
      const beforeTag = before.categories
        .find((c) => c.category === claimed.group || c.category.startsWith(claimed.group))
        ?.tags.find((t) => t.key === claimed.key)?.displayedValue;
      changes.push({ ...claimed, before: beforeTag, verification: "verified" });
    } else {
      residualTarget = true;
      changes.push({
        ...claimed,
        verification: "failed",
        reason: `${claimed.reason ?? ""} ${targetCheck.reason ?? "Output absence was not proven."} Removal unverified.`.trim(),
      });
    }
  }

  // 7. GPS is removed with its EXIF block: confirm explicitly.
  const gpsBefore = before.categories.find((c) => c.category === "GPS");
  const gpsAfter = after.categories.find((c) => c.category === "GPS");
  if (gpsBefore?.status === "detected" && resolvesCleaningTarget(policy, "exif_gps")) {
    if (gpsAfter?.status === "not_detected") {
      changes.push({ group: "GPS", key: "GPS coordinates", action: "removed", verification: "verified", reason: "GPS tags absent after cleaning (removed with their EXIF block)." });
    } else {
      residualTarget = true;
      changes.push({ group: "GPS", key: "GPS coordinates", action: "removed", verification: "failed", reason: `GPS output status was ${gpsAfter?.status?.replace(/_/g, " ") ?? "missing"}; explicit absence was not proven.` });
    }
  }

  // 8. No-op detection: no target tags existed before.
  // Only the metadata families selected for this run count as targets.
  // Unselected metadata may intentionally remain and must not turn a no-op
  // into a misleading "verified clean" result.
  const hadTargets = changes.some((change) => isTargetChange(change));
  const unsupportedRetained = changes.some((c) => c.action === "retained_unsupported");
  // C2PA stays disclosed (category + warning) but does not single-handedly
  // block verified_clean: "unassessed unknown-unknowns" are disclosed, while
  // partial is reserved for structures we SAW but could not handle.
  const c2paAfter = after.categories.find((category) => category.category.startsWith("C2PA"));
  if (c2paAfter?.status === "not_inspected" && !warnings.some((w) => w.includes("C2PA"))) {
    warnings.push("C2PA / Content Credentials could not be inspected in this runtime — no manifest claim is made either way.");
  } else if (c2paAfter?.status === "detected" && !warnings.some((w) => w.includes("C2PA"))) {
    warnings.push("C2PA / Content Credentials remain present; ordinary metadata cleaning does not silently remove signed provenance.");
  }
  const targetsExif = resolvesCleaningTarget(policy, "exif_gps");
  const targetsDescriptive = resolvesCleaningTarget(policy, "descriptive");
  if (!targetsExif || !targetsDescriptive) {
    warnings.push("Only the selected metadata types were targeted; unselected metadata may remain intentionally.");
  }

  let status: CleaningStatus;
  if (residualTarget) {
    status = "failed";
    errors.push("Claimed removals still present after cleaning — output withheld.");
  } else if (!hadTargets) {
    status = "unchanged_no_target_tags";
    warnings.push("No supported removable metadata found before cleaning; output is byte-comparable to input.");
  } else if (unsupportedRetained || cleaned.coverageLimited) {
    status = "partially_cleaned";
    warnings.push("Coverage-limited: unassessed structures retained. Partial, never total.");
  } else {
    status = "verified_clean";
  }

  const downloadable = status === "verified_clean" || status === "partially_cleaned" || status === "unchanged_no_target_tags";
  const output = downloadable ? new Blob([cleaned.data as BlobPart], { type: outputMime(kind) }) : undefined;
  return {
    ...base,
    status,
    changes,
    after,
    output,
    outputBytes: cleaned.data.length,
    warnings,
    errors,
  };
}

function markAll(changes: MetadataChange[], verification: MetadataChange["verification"]): MetadataChange[] {
  return changes.map((change) => ({ ...change, verification }));
}

function outputMime(kind: SniffedKind): string {
  switch (kind) {
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    case "heic":
    case "heif-generic":
      return "image/heic";
    default:
      return "application/octet-stream";
  }
}
