import type { ImageInspectionResult } from "../../types/inspection";
import type { QueueEntry } from "../../types/media";
import { SNIFF_WINDOW_BYTES, canonicalExtensionForSniffedKind, sniffImageBytes } from "../format-detection/signatures";
import { inspectImage } from "../metadata/inspect/inspect";
import { PRIVACY_SAFE_DEFAULT } from "../metadata/clean/types";
import { DEFAULT_REWRITE_MAX_BYTES, plansForProfile, verifyRewrittenImage, type FileRewriteResult, type RewriteMode } from "../metadata/rewrite/rewrite";
import type { MetadataProfile, ProfileField } from "../metadata/rewrite/fields";
import { emptyInspection } from "../../types/inspection";

/**
 * One file's rewrite pipeline (Phase 6): sniff → inspect (reused) →
 * rewrite + verify. Total function: content problems become statuses,
 * never throws for file-content reasons.
 */
export interface RewriteProcessDeps {
  getEntry: (id: string) => QueueEntry | undefined;
  getInspection: (id: string) => ImageInspectionResult | undefined;
  setInspection: (id: string, result: ImageInspectionResult) => void;
  profile: MetadataProfile;
  selectedFields: readonly ProfileField[];
  mode: RewriteMode;
  maxBytes?: number;
  onStage?: (stage: "sniff" | "inspect" | "rewrite") => void;
}

export async function processRewriteFile(
  id: string,
  deps: RewriteProcessDeps,
): Promise<FileRewriteResult> {
  const entry = deps.getEntry(id);
  if (!entry) {
    throw new Error(`Rewrite file ${id} no longer queued.`);
  }
  const source = entry.source;
  const fail = (status: FileRewriteResult["status"], errors: string[]): FileRewriteResult => ({
    fileId: id,
    inputName: entry.item.name,
    detectedFormat: "unknown",
    inputBytes: source.size,
    before: deps.getInspection(id) ?? emptyInspection(id, entry.item.name, source.size),
    mode: deps.mode,
    requestedFields: [...deps.selectedFields],
    status,
    changes: [],
    warnings: [],
    errors,
    rewrittenAt: new Date().toISOString(),
  });

  const maxBytes = deps.maxBytes ?? DEFAULT_REWRITE_MAX_BYTES;
  if (source.size > maxBytes) {
    return fail("failed", [
      `Input is ${source.size} bytes — above the ${maxBytes}-byte in-browser rewrite budget. Declining before loading the full file.`,
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
      return fail("failed", ["Inspection crashed unexpectedly."]);
    }
    deps.setInspection(id, before);
  }

  const { plans, expected } = plansForProfile(deps.profile, deps.selectedFields);
  if (plans.length === 0) {
    return fail("failed", ["No profile fields were selected (or all selected fields are blank) — nothing to rewrite."]);
  }

  let inputBytes: Uint8Array;
  try {
    deps.onStage?.("rewrite");
    inputBytes = new Uint8Array(await source.arrayBuffer());
  } catch {
    return fail("failed", ["File bytes could not be read."]);
  }

  return verifyRewrittenImage({
    fileId: id,
    inputName: entry.item.name,
    extension: canonicalExtensionForSniffedKind(sniff.kind),
    kind: sniff.kind,
    brand: sniff.majorBrand,
    inputBytes,
    before,
    plans,
    expected,
    mode: deps.mode,
    policy: PRIVACY_SAFE_DEFAULT,
    inputWarnings: sniff.warnings,
    ...(deps.maxBytes !== undefined ? { maxBytes: deps.maxBytes } : {}),
  });
}
