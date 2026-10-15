import type { ImageInspectionResult } from "../../../types/inspection";
import type { SniffedKind } from "../../format-detection/signatures";
import { sniffImageBytes } from "../../format-detection/signatures";
import { inspectImage } from "../inspect/inspect";
import { cleanImageBytes } from "../clean/index";
import { isobmffImagePayloads, validateIsobmffStructure } from "../clean/isobmff";
import { parseJpegSegments, validateJpegStructure } from "../clean/jpeg";
import { parsePngChunks, validatePngStructure } from "../clean/png";
import { parseWebpChunks, validateWebpStructure } from "../clean/webp";
import {
  buildOutputName,
  CleanRefused,
  PRIVACY_SAFE_DEFAULT,
  type CleaningPolicy,
  type MetadataChange,
} from "../clean/types";
import { observeFieldValues } from "./verify-fields";
import { planFieldWrite, type FieldWritePlan } from "./writes";
import type { ProfileField, MetadataProfile } from "./fields";
import { writeIsobmffFields } from "./isobmff";
import { writeJpegFields } from "./jpeg";
import { writePngFields } from "./png";
import { writeWebpFields } from "./webp";
import type { XmlCodec } from "./codecs";

/**
 * Verified image rewriting (Phase 6).
 *
 * Two modes:
 * - `replace_editable`: run the proven Phase 3 cleaner first (removes
 *   removable non-technical metadata incl. in-scope C2PA), then write the
 *   selected profile fields. Technical ICC/orientation/pixels preserved.
 * - `update_selected`: write only the chosen fields into the original
 *   bytes, preserving everything unrelated — including existing C2PA bytes
 *   (re-validated after, never claimed valid unless proven).
 *
 * Every success passes: re-sniff, structural re-validation, encoded-payload
 * equality, output re-inspection, and per-field re-observation. Anything
 * else is partial/failed/unsupported — never a silent success. No canvas,
 * no re-encoding, no forged provenance.
 */

export type RewriteMode = "replace_editable" | "update_selected";

export type RewriteStatus =
  | "verified_rewritten"
  | "partially_rewritten"
  | "unchanged_no_target_tags"
  | "not_verified"
  | "unsupported"
  | "failed"
  | "cancelled";

export interface FileRewriteResult {
  fileId: string;
  inputName: string;
  outputName?: string;
  detectedFormat: SniffedKind;
  detectedBrand?: string;
  inputBytes: number;
  outputBytes?: number;
  before: ImageInspectionResult;
  after?: ImageInspectionResult;
  /** Local-only output. Never serialized, never uploaded. */
  output?: Blob;
  mode: RewriteMode;
  /** Profile fields requested (field names). */
  requestedFields: ProfileField[];
  /** Cleaning policy used for replace mode (undefined for update). */
  policy?: CleaningPolicy;
  status: RewriteStatus;
  changes: MetadataChange[];
  warnings: string[];
  errors: string[];
  rewrittenAt: string;
}

export interface RewriteVerifyInput {
  fileId: string;
  inputName: string;
  extension: string;
  kind: SniffedKind;
  brand?: string;
  inputBytes: Uint8Array;
  before: ImageInspectionResult;
  /** Already-planned field writes (from planFieldWrite). */
  plans: FieldWritePlan[];
  /** Expected semantic values per field (for verification). */
  expected: Partial<Record<ProfileField, { value: string; keywords: string[] }>>;
  mode: RewriteMode;
  /** Cleaning policy for replace mode. Defaults to privacy-safe. */
  policy?: CleaningPolicy;
  xml?: XmlCodec;
  domParser?: unknown;
  maxBytes?: number;
  inputWarnings?: string[];
  inspectOutput?: typeof inspectImage;
}

export const DEFAULT_REWRITE_MAX_BYTES = 64 * 1024 * 1024;

/** Browser XML codec (DOMParser/XMLSerializer). Test code passes its own. */
export function browserXmlCodec(): XmlCodec {
  const parser = (globalThis as unknown as { DOMParser?: typeof DOMParser }).DOMParser;
  const serializer = (globalThis as unknown as { XMLSerializer?: typeof XMLSerializer }).XMLSerializer;
  if (!parser || !serializer) {
    throw new Error("XML rewriting requires DOMParser/XMLSerializer (browser environment).");
  }
  return {
    parse: (text: string) => new parser().parseFromString(text, "application/xml") as unknown as Document,
    serialize: (doc: Document) => new serializer().serializeToString(doc as unknown as never) as string,
  };
}

/** Output filename: sanitized stem + "-rewritten" + original extension. */
export function buildRewriteOutputName(inputName: string, extension: string): string {
  const cleaned = buildOutputName(inputName, extension);
  return cleaned.replace(/-clean\.([^.]+)$/, "-rewritten.$1");
}

/**
 * Build write plans + expected values from a validated profile and an
 * explicit field selection. Empty selections yield no plans (caller must
 * block the no-op with a message rather than writing).
 */
export function plansForProfile(
  profile: MetadataProfile,
  selected: readonly ProfileField[],
): { plans: FieldWritePlan[]; expected: RewriteVerifyInput["expected"] } {
  const plans: FieldWritePlan[] = [];
  const expected: RewriteVerifyInput["expected"] = {};
  for (const field of selected) {
    if (field === "keywords") {
      if (profile.keywordsList.length === 0) continue;
      plans.push(planFieldWrite(field, "", profile.keywordsList));
      expected[field] = { value: profile.keywordsList.join(", "), keywords: [...profile.keywordsList] };
      continue;
    }
    const value = profile[field];
    if (typeof value !== "string" || value.trim() === "") continue;
    plans.push(planFieldWrite(field, value, []));
    expected[field] = { value, keywords: [] };
  }
  return { plans, expected };
}

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
  for (let i = 0; i < before.length; i += 1) {
    const left = before[i];
    const right = after[i];
    if (!left || !right || left.length !== right.length) return false;
    for (let j = 0; j < left.length; j += 1) {
      if (left[j] !== right[j]) return false;
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

function markAll(changes: MetadataChange[], verification: MetadataChange["verification"]): MetadataChange[] {
  return changes.map((change) => ({ ...change, verification }));
}

function normalizeForCompare(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function keywordsEqual(wanted: string[], observed: string[]): boolean {
  if (wanted.length !== observed.length) return false;
  const a = [...wanted].map((w) => normalizeForCompare(w).toLowerCase()).sort();
  const b = [...observed].map((w) => normalizeForCompare(w).toLowerCase()).sort();
  return a.every((value, index) => value === b[index]);
}

export async function verifyRewrittenImage(input: RewriteVerifyInput): Promise<FileRewriteResult> {
  const { fileId, inputName, extension, kind, brand, inputBytes, before, plans, expected, mode } = input;
  const policy = input.policy ?? PRIVACY_SAFE_DEFAULT;
  const warnings: string[] = [...(input.inputWarnings ?? [])];
  const errors: string[] = [];
  const requestedFields = plans.map((plan) => plan.field);
  const outputName = buildRewriteOutputName(inputName, extension);
  const base = {
    fileId, inputName, outputName, detectedFormat: kind, detectedBrand: brand,
    inputBytes: inputBytes.length, before, mode, requestedFields, policy: mode === "replace_editable" ? policy : undefined,
    rewrittenAt: new Date().toISOString(),
  };

  const fail = (status: RewriteStatus, messages: string[], extra?: Partial<FileRewriteResult>): FileRewriteResult => ({
    ...base,
    status,
    changes: [],
    warnings: [...warnings],
    errors: messages,
    ...extra,
  });

  // 0. Budget + no-op + kind gates (before any allocation beyond input).
  if (inputBytes.length > (input.maxBytes ?? DEFAULT_REWRITE_MAX_BYTES)) {
    return fail("failed", [
      `Input is ${inputBytes.length} bytes — above the ${input.maxBytes ?? DEFAULT_REWRITE_MAX_BYTES}-byte in-browser rewrite budget. Declining rather than transforming blindly.`,
    ]);
  }
  if (plans.length === 0) {
    return fail("failed", ["No profile fields were selected (or all selected fields are blank) — nothing to rewrite."]);
  }
  if (kind !== "jpeg" && kind !== "png" && kind !== "webp" && kind !== "avif" && kind !== "heic" && kind !== "heif-generic") {
    return fail("unsupported", [`${kind} containers are not supported for metadata rewriting (still images only).`]);
  }

  let xml: XmlCodec;
  try {
    xml = input.xml ?? browserXmlCodec();
  } catch {
    return fail("failed", ["XML rewriting requires a browser DOMParser/XMLSerializer; output withheld."]);
  }

  // 1. Replace mode: run the proven cleaner first. Update mode: edit original.
  let baseBytes = inputBytes;
  let cleaningWarnings: string[] = [];
  let cleaningCoverageLimited = false;
  let cleaningChanges: MetadataChange[] = [];
  if (mode === "replace_editable") {
    try {
      const cleaned = cleanImageBytes(inputBytes, kind, policy);
      cleaningWarnings = cleaned.warnings;
      cleaningCoverageLimited = cleaned.coverageLimited;
      cleaningChanges = cleaned.changes;
      baseBytes = cleaned.data;
      warnings.push(...cleaningWarnings);
    } catch (error) {
      if (error instanceof CleanRefused) {
        return fail(error.status === "unsupported" ? "unsupported" : "failed", [error.message]);
      }
      return fail("failed", ["Unexpected cleaner failure before rewriting. No output was created."]);
    }
  }

  // 2. Write per format (merge semantics; writers never delete).
  let written: Uint8Array;
  let writeWarnings: string[] = [];
  let skipped: Array<{ field: string; channel: string; reason: string }> = [];
  let detailNote = "";
  try {
    if (kind === "jpeg") {
      const out = writeJpegFields(baseBytes, plans, xml);
      written = out.data;
      writeWarnings = out.warnings;
      skipped = out.skipped;
      detailNote = `EXIF:${out.detail.exif} XMP:${out.detail.xmp} IPTC:${out.detail.iptc}`;
    } else if (kind === "png") {
      const out = writePngFields(baseBytes, plans, xml);
      written = out.data;
      writeWarnings = out.warnings;
      skipped = [...out.skipped];
      // IPTC has no PNG home — surface requested IPTC explicitly as unsupported.
      for (const plan of plans) {
        for (const dataset of plan.iptc) {
          skipped.push({ field: plan.field, channel: `IPTC:${dataset.record}:${dataset.dataset}`, reason: "PNG has no standard IPTC-IIM home; value carried in EXIF/XMP only." });
        }
      }
      detailNote = `EXIF:${out.detail.exif} XMP:${out.detail.xmp}`;
    } else if (kind === "webp") {
      const out = writeWebpFields(baseBytes, plans, xml);
      written = out.data;
      writeWarnings = out.warnings;
      skipped = [...out.skipped];
      for (const plan of plans) {
        for (const dataset of plan.iptc) {
          skipped.push({ field: plan.field, channel: `IPTC:${dataset.record}:${dataset.dataset}`, reason: "WebP has no standard IPTC-IIM home; value carried in EXIF/XMP only." });
        }
      }
      detailNote = `EXIF:${out.detail.exif} XMP:${out.detail.xmp}`;
    } else {
      const out = writeIsobmffFields(baseBytes, kind === "avif" ? "avif" : "heic", plans, xml, null);
      written = out.data;
      writeWarnings = out.warnings;
      skipped = [...out.skipped];
      for (const plan of plans) {
        for (const dataset of plan.iptc) {
          skipped.push({ field: plan.field, channel: `IPTC:${dataset.record}:${dataset.dataset}`, reason: "AVIF/HEIC never carry legacy IPTC-IIM; value carried in EXIF/XMP only." });
        }
      }
      detailNote = `EXIF:${out.detail.exif} XMP:${out.detail.xmp}`;
    }
  } catch (error) {
    if (error instanceof CleanRefused) {
      return fail(error.status === "unsupported" ? "unsupported" : "failed", [error.message]);
    }
    return fail("failed", ["Unexpected writer failure. No output was created."]);
  }
  warnings.push(...writeWarnings);
  if (detailNote) warnings.push(`Writer channels — ${detailNote}.`);

  // 3. Output signature/brand must match input kind.
  const outSniff = sniffImageBytes(written.slice(0, 65536), written.length, extension);
  if (outSniff.kind !== kind && !(kind === "heic" && outSniff.kind === "heif-generic")) {
    return fail("failed", [`Output container "${outSniff.kind}" does not match input "${kind}" — format changed or corrupted.`]);
  }
  if (brand && outSniff.majorBrand && outSniff.majorBrand !== brand) {
    return fail("failed", [`Output brand "${outSniff.majorBrand}" differs from input brand "${brand}".`]);
  }

  // 4. Structural re-validation.
  const structural = validateStructure(kind, written);
  if (!structural.ok) {
    return fail("failed", [`Output failed structural validation: ${structural.errors.join("; ")}`]);
  }

  // 5. Encoded payload bytes must match exactly.
  const beforePayload = payloadPartsOf(kind, inputBytes);
  const afterPayload = payloadPartsOf(kind, written);
  if (beforePayload === null || afterPayload === null) {
    return fail("failed", ["Encoded payload could not be isolated on both sides; refusing unverified output."]);
  }
  if (!payloadPartsEqual(beforePayload, afterPayload)) {
    return fail("failed", ["Encoded image payload differs before/after — pixels or items changed; refusing output."]);
  }

  // 6. Re-inspect output with the Phase 2 engine.
  let after: ImageInspectionResult;
  try {
    const copy = new Uint8Array(written);
    const inspectFn = (input.inspectOutput ?? inspectImage) as (
      fileId: string,
      source: ArrayBuffer,
      fileName: string,
      options?: { domParser?: unknown },
    ) => Promise<ImageInspectionResult>;
    after = await inspectFn(`${fileId}:after`, copy.buffer, outputName, { domParser: input.domParser });
  } catch {
    return fail("not_verified", ["Output re-inspection errored; no rewrite is confirmed — download withheld."]);
  }
  if (after.outcome === "failed" || after.outcome === "unsupported" || after.outcome === "cancelled") {
    return {
      ...base, status: "not_verified", changes: [], after,
      warnings: [...warnings, ...after.warnings],
      errors: [`Output re-inspection ended as ${after.outcome}; no rewrite is confirmed — download withheld.`],
    };
  }

  // 7. Field-by-field verification against re-observed values.
  const observed = observeFieldValues(written, kind, plans, xml);
  const changes: MetadataChange[] = [];
  let verifiedCount = 0;
  let hasFailure = false;
  let hasUnsupported = false;
  for (const plan of plans) {
    const want = expected[plan.field];
    const seen = observed.get(plan.field);
    const wantValue = want?.value ?? "";
    const wantKeywords = want?.keywords ?? [];
    if (!want || (wantValue.trim() === "" && wantKeywords.length === 0)) {
      continue;
    }
    const singles = seen?.singles ?? new Map<string, string>();
    const multis = seen?.multis ?? new Map<string, string[]>();
    const fieldSkips = skipped.filter((entry) => entry.field === plan.field);

    if (plan.field === "keywords") {
      const observedKeywords = multis.get("XMP:subject") ?? multis.get("IPTC:2:25") ?? [];
      if (observedKeywords.length > 0 && keywordsEqual(wantKeywords, observedKeywords)) {
        verifiedCount += 1;
        changes.push({ group: "XMP", key: `keywords (${observedKeywords.length} tags)`, action: "rewritten", before: "", after: observedKeywords.join(", "), verification: "verified", reason: "XMP dc:subject Bag round-trips as distinct tags." });
      } else if (observedKeywords.length > 0) {
        hasFailure = true;
        changes.push({ group: "XMP", key: "keywords", action: "rewritten", before: "", after: observedKeywords.join(", "), verification: "failed", reason: `Wanted ${wantKeywords.length} keyword(s), observed ${observedKeywords.length} with different values.` });
      } else {
        const reason = fieldSkips.map((s) => `${s.channel}: ${s.reason}`).join("; ") || "Keywords not observed in output.";
        const unsupported = fieldSkips.length > 0;
        if (unsupported) hasUnsupported = true;
        else hasFailure = true;
        changes.push({ group: "XMP", key: "keywords", action: unsupported ? "retained_unsupported" : "rewritten", verification: unsupported ? "not_verified" : "failed", reason });
      }
      continue;
    }

    // Single-value fields: every mapped location that the writer attempted
    // must re-observe equal; IPTC locations outside JPEG are documented
    // unsupported (not failures).
    const checks: Array<{ channel: string; ok: boolean; observedValue: string; supported: boolean }> = [];
    for (const write of plan.exif) {
      const observedValue = singles.get(`EXIF:${write.tag}`) ?? "";
      const supported = true;
      checks.push({
        channel: `EXIF:${write.tag}`,
        ok: observedValue !== "" && normalizeForCompare(observedValue) === normalizeForCompare(wantValue),
        observedValue,
        supported,
      });
    }
    for (const prop of plan.xmp) {
      if (prop.kind === "seq" || prop.kind === "bag") {
        const values = multis.get(`XMP:${prop.prop}`) ?? [];
        const flat = values.join(", ");
        checks.push({
          channel: `XMP:${prop.prop}`,
          ok: values.some((v) => normalizeForCompare(v) === normalizeForCompare(wantValue)) || normalizeForCompare(flat) === normalizeForCompare(wantValue),
          observedValue: flat,
          supported: true,
        });
      } else {
        const observedValue = singles.get(`XMP:${prop.prop}`) ?? "";
        checks.push({
          channel: `XMP:${prop.prop}`,
          ok: observedValue !== "" && normalizeForCompare(observedValue) === normalizeForCompare(wantValue),
          observedValue,
          supported: true,
        });
      }
    }
    for (const dataset of plan.iptc) {
      const supported = kind === "jpeg";
      if (!supported) {
        checks.push({ channel: `IPTC:${dataset.record}:${dataset.dataset}`, ok: false, observedValue: "", supported: false });
        continue;
      }
      const key = `IPTC:${dataset.record}:${dataset.dataset}`;
      const observedValue = singles.get(key) ?? (multis.get(key)?.[0] ?? "");
      checks.push({
        channel: key,
        ok: observedValue !== "" && normalizeForCompare(observedValue) === normalizeForCompare(wantValue),
        observedValue,
        supported: true,
      });
    }

    const supportedChecks = checks.filter((c) => c.supported);
    const unsupportedChecks = checks.filter((c) => !c.supported);
    const okChecks = supportedChecks.filter((c) => c.ok);
    if (supportedChecks.length > 0 && okChecks.length === supportedChecks.length) {
      verifiedCount += 1;
      const primary = okChecks[0];
      changes.push({
        group: primary?.channel.startsWith("EXIF") ? "EXIF" : primary?.channel.startsWith("IPTC") ? "IPTC" : "XMP",
        key: `${plan.field} (${supportedChecks.map((c) => c.channel).join(", ")})`,
        action: "rewritten",
        before: "",
        after: primary?.observedValue ?? wantValue,
        verification: "verified",
        reason: `Re-observed in ${okChecks.length}/${supportedChecks.length} standard location(s).`,
      });
    } else if (supportedChecks.length > 0 && okChecks.length > 0) {
      hasFailure = true;
      changes.push({
        group: "XMP",
        key: plan.field,
        action: "rewritten",
        verification: "failed",
        reason: `Partially observed: ${okChecks.map((c) => c.channel).join(", ")} match, ${supportedChecks.filter((c) => !c.ok).map((c) => c.channel).join(", ")} do not.`,
      });
    } else if (supportedChecks.length > 0) {
      hasFailure = true;
      const reason = fieldSkips.length > 0
        ? fieldSkips.map((s) => `${s.channel}: ${s.reason}`).join("; ")
        : `Wanted "${wantValue.slice(0, 120)}", not observed in ${supportedChecks.map((c) => c.channel).join(", ")}.`;
      changes.push({ group: "XMP", key: plan.field, action: "rewritten", verification: "failed", reason });
    }
    for (const unsupported of unsupportedChecks) {
      hasUnsupported = true;
      changes.push({
        group: "IPTC",
        key: `${plan.field} (${unsupported.channel})`,
        action: "retained_unsupported",
        verification: "not_verified",
        reason: `${unsupported.channel} has no standard home in ${kind.toUpperCase()}; value carried in EXIF/XMP only.`,
      });
    }
  }

  // Carry cleaning evidence for replace mode (removal proof, not rewritten).
  const carried: MetadataChange[] = mode === "replace_editable"
    ? cleaningChanges.map((c) => ({ ...c }))
    : [];

  // 8. C2PA honesty: never forge, never silently reset.
  const c2paBefore = before.categories.find((c) => c.category.startsWith("C2PA"))?.status ?? "not_inspected";
  const c2paAfter = after.categories.find((c) => c.category.startsWith("C2PA"))?.status ?? "not_inspected";
  if (mode === "replace_editable") {
    if (c2paBefore === "detected" && c2paAfter === "detected") {
      warnings.push("C2PA / Content Credentials remain present after replace-mode rewriting; existing signed provenance was retained and is disclosed as retained_unsupported — never claimed removed or valid.");
      changes.push({ group: "C2PA", key: "manifest store", action: "retained_unsupported", verification: "verified", reason: "C2PA bytes survived replace-mode rewriting (unsupported layout or out-of-scope policy); disclosed, not removed." });
    } else if (c2paBefore === "detected" && c2paAfter === "not_detected") {
      changes.push({ group: "C2PA", key: "manifest store", action: "removed", verification: "verified", reason: "C2PA manifest absent after replace-mode cleaning; removal verified by re-inspection." });
    }
  } else {
    if (c2paBefore === "detected") {
      warnings.push("Existing C2PA / Content Credentials were preserved by update-selected rewriting. Metadata edits may invalidate the retained signature — the output shows its re-validated state, never a claim that the signature stayed valid.");
      if (c2paAfter === "detected") {
        changes.push({ group: "C2PA", key: "manifest store", action: "retained_unsupported", verification: "verified", reason: "Preserved intentionally in update-selected mode; re-validated output state shown." });
      } else {
        changes.push({ group: "C2PA", key: "manifest store", action: "unknown", verification: "not_verified", reason: `C2PA went from detected to ${c2paAfter}; state shown exactly, never invented.` });
      }
    }
  }
  if (c2paAfter === "not_inspected" && !warnings.some((w) => w.includes("C2PA"))) {
    warnings.push("C2PA / Content Credentials could not be inspected in this runtime — no manifest claim is made either way.");
  }

  if (cleaningCoverageLimited) {
    warnings.push("Replace-mode cleaning had limited coverage (unassessed structures retained); rewrite inherits that partial scope.");
  }

  // 9. Status: fail-closed. No verified badge unless every supported field verified.
  let status: RewriteStatus;
  if (verifiedCount === 0) {
    status = "failed";
    errors.push("None of the requested fields could be verified in the output — download withheld.");
  } else if (hasFailure || (mode === "replace_editable" && cleaningCoverageLimited)) {
    status = "partially_rewritten";
  } else {
    status = "verified_rewritten";
  }
  // Unsupported-only IPTC locations do not demote a fully verified rewrite.
  void hasUnsupported;

  const allChanges = [...carried, ...changes];
  const downloadable = status === "verified_rewritten" || status === "partially_rewritten";
  const output = downloadable ? new Blob([written as BlobPart], { type: outputMime(kind) }) : undefined;

  if (!downloadable) {
    return {
      ...base, status, changes: markAll(allChanges, "failed"), after,
      outputBytes: written.length, warnings: [...warnings, ...after.warnings],
      errors: errors.length > 0 ? errors : ["Rewrite verification failed — output withheld."],
    };
  }

  return {
    ...base, status, changes: allChanges, after, output,
    outputBytes: written.length,
    warnings: [...warnings, ...after.warnings],
    errors,
  };
}

export function isRewriteDownloadable(status: RewriteStatus): boolean {
  return status === "verified_rewritten" || status === "partially_rewritten";
}
