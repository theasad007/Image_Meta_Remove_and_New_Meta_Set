import type { ImageInspectionResult } from "../../types/inspection";
import type { QueueEntry } from "../../types/media";
import { SNIFF_WINDOW_BYTES, canonicalExtensionForSniffedKind, sniffImageBytes } from "../format-detection/signatures";
import { inspectImage } from "../metadata/inspect/inspect";
import type { CleaningPolicy, FileCleaningResult } from "../metadata/clean/types";
import { PRIVACY_SAFE_DEFAULT } from "../metadata/clean/types";
import { DEFAULT_VERIFY_MAX_BYTES, verifyCleanedImage } from "../metadata/verify/verify";

/**
 * One file's full Phase 4 pipeline: sniff → inspect (reused when already
 * done) → clean + verify. Total function: every path returns a result or a
 * structured refusal — never throws for file-content reasons. Transient
 * buffers are released before it resolves.
 */
export interface BatchProcessDeps {
  getEntry: (id: string) => QueueEntry | undefined;
  getInspection: (id: string) => ImageInspectionResult | undefined;
  setInspection: (id: string, result: ImageInspectionResult) => void;
  domParser?: unknown;
  maxBytes?: number;
  onStage?: (stage: "sniff" | "inspect" | "clean") => void;
  policy?: CleaningPolicy;
}

export async function processBatchFile(
  id: string,
  deps: BatchProcessDeps,
): Promise<FileCleaningResult> {
  const entry = deps.getEntry(id);
  if (!entry) {
    throw new Error(`Batch file ${id} no longer queued.`);
  }
  const source = entry.source;
  const fail = (
    status: FileCleaningResult["status"],
    errors: string[],
    extra?: Partial<FileCleaningResult>,
  ): FileCleaningResult => ({
    fileId: id,
    inputName: entry.item.name,
    detectedFormat: "unknown",
    inputBytes: source.size,
    before: deps.getInspection(id) ?? {
      fileId: id,
      fileName: entry.item.name,
      bytes: source.size,
      outcome: "failed",
      categories: [],
      aiIndicators: [],
      warnings: ["No inspection available."],
      inspectedAt: new Date().toISOString(),
    },
    policy: deps.policy ?? PRIVACY_SAFE_DEFAULT,
    status,
    changes: [],
    warnings: [],
    errors,
    cleanedAt: new Date().toISOString(),
    ...extra,
  });

  // Enforce the memory budget before any whole-file read. The verification
  // layer repeats this check as defense in depth, but waiting until after
  // `arrayBuffer()` would already have paid the unsafe allocation cost.
  const maxBytes = deps.maxBytes ?? DEFAULT_VERIFY_MAX_BYTES;
  if (source.size > maxBytes) {
    return fail("failed", [
      `Input is ${source.size} bytes — above the ${maxBytes}-byte in-browser cleaning budget. Declining before loading the full file.`,
    ]);
  }

  let head: Uint8Array;
  try {
    deps.onStage?.("sniff");
    head = new Uint8Array(
      await source.slice(0, Math.min(SNIFF_WINDOW_BYTES, source.size)).arrayBuffer(),
    );
  } catch {
    return fail("failed", ["File bytes could not be read (slice failed)."]);
  }
  const sniff = sniffImageBytes(head, source.size, entry.item.name.split(".").pop()?.toLowerCase() ?? "");

  let before = deps.getInspection(id);
  if (!before) {
    try {
      deps.onStage?.("inspect");
      before = await inspectImage(id, source, entry.item.name);
    } catch {
      return fail("failed", ["Inspection crashed unexpectedly."], { detectedFormat: sniff.kind });
    }
    deps.setInspection(id, before);
  }

  let inputBytes: Uint8Array;
  try {
    deps.onStage?.("clean");
    inputBytes = new Uint8Array(await source.arrayBuffer());
  } catch {
    return fail("failed", ["File bytes could not be read."], { detectedFormat: sniff.kind, before });
  }
  // verifyCleanedImage is total over content (refusals become statuses);
  // only an unexpected engine bug could throw — contained by the caller.
  const requestedPolicy = deps.policy ?? PRIVACY_SAFE_DEFAULT;
  const policy: CleaningPolicy = requestedPolicy.targets?.includes("ai_markers")
    ? {
        ...requestedPolicy,
        aiEvidenceGroups: [...new Set(before.aiIndicators.map((indicator) => indicator.evidenceGroup))],
      }
    : requestedPolicy;
  return verifyCleanedImage({
    fileId: id,
    inputName: entry.item.name,
    extension: canonicalExtensionForSniffedKind(sniff.kind),
    kind: sniff.kind,
    brand: sniff.majorBrand,
    inputBytes,
    before,
    policy,
    inputWarnings: sniff.warnings,
    ...(deps.maxBytes !== undefined ? { maxBytes: deps.maxBytes } : {}),
  });
}
