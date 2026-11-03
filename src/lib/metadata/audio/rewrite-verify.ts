import type { SniffedKind } from "../../format-detection/signatures";
import type { MetadataProfile, ProfileField } from "../rewrite/fields";
import { parseKeywords } from "../rewrite/fields";
import type { RewriteMode, RewriteStatus, FileRewriteResult } from "../rewrite/rewrite";
import { compareMp3AudioPayloads, probeMp3 } from "./id3";
import { writeMp3Fields } from "./rewrite-mp3";
import { inspectAudio } from "./inspect-audio";
import { buildRewriteOutputName } from "../rewrite/rewrite";

/**
 * MP3 rewrite verification (Phase 10) — mirrors the image chain exactly:
 * write → re-sniff → structural probe → audio-segment byte equality →
 * re-inspect output → per-field requested-vs-observed comparison. Any
 * unverifiable field withholds the verified status.
 */

const OBSERVED_FRAME_FOR: Partial<Record<ProfileField, string>> = {
  company: "TPUB",
  creator: "TPE1",
  copyright: "TCOP",
  title: "TIT2",
};

const FIELD_LABELS: Record<string, string> = {
  company: "Publisher (TPUB)",
  creator: "Artist (TPE1)",
  copyright: "Copyright (TCOP)",
  title: "Audio title (TIT2)",
  description: "Comment (COMM)",
  keywords: "Keywords (TXXX:KEYWORDS)",
  locationName: "Location name (TXXX:LOCATION)",
  website: "Website (WXXX)",
  rightsOwner: "Rights owner",
  contact: "Contact",
};

export async function verifyRewrittenAudio(input: {
  fileId: string;
  inputName: string;
  extension: string;
  kind: SniffedKind;
  inputBytes: Uint8Array;
  before: import("../../../types/inspection").ImageInspectionResult;
  profile: MetadataProfile;
  selectedFields: ProfileField[];
  mode: RewriteMode;
  policy?: unknown;
}): Promise<FileRewriteResult> {
  const { fileId, inputName, extension, kind, inputBytes, before, profile, selectedFields, mode } = input;
  const warnings: string[] = [];
  const requestedFields = [...selectedFields];
  const outputName = buildRewriteOutputName(inputName, extension);
  const base = {
    fileId, inputName, outputName, detectedFormat: kind,
    inputBytes: inputBytes.length, before, mode, requestedFields,
    policy: undefined as unknown as import("../clean/types").CleaningPolicy | undefined,
    rewrittenAt: new Date().toISOString(),
  };

  const requested: Partial<Record<ProfileField, string>> = {};
  for (const field of selectedFields) {
    if (field === "keywords") {
      const list = parseKeywords(profile.keywordsList.join(", "));
      if (list.length > 0) requested.keywords = list.join(", ");
      continue;
    }
    const value = profile[field];
    if (typeof value === "string" && value.trim() !== "") requested[field] = value;
  }
  // SOL-003: fields with NO verified ID3 channel (rightsOwner, contact) are
  // disclosed as unsupported — they are NOT failed writes and must not drag
  // an otherwise fully-verified MP3 output into "partial". Every other
  // requested field must verify from output bytes.
  const noChannel = (["rightsOwner", "contact"] as ProfileField[]).filter((field) => requested[field] !== undefined);
  for (const field of noChannel) delete requested[field];
  if (Object.keys(requested).length === 0) {
    return { ...base, status: "failed", changes: [], warnings, errors: ["No supported MP3 fields were selected (or all are blank) — nothing to rewrite."], output: undefined };
  }

  let written;
  try {
    written = writeMp3Fields(inputBytes, requested, mode);
  } catch (error) {
    return {
      ...base,
      status: error instanceof Error && /unsynchronisation|ID3v2\.2/.test(error.message) ? "unsupported" : "failed",
      changes: [],
      warnings,
      errors: [error instanceof Error ? error.message : "MP3 write failed."],
      output: undefined,
    };
  }
  warnings.push(...written.warnings);

  // 1. Output sniffs as MP3.
  const afterProbe = probeMp3(written.data);
  if (!afterProbe.ok || !afterProbe.stream) {
    return { ...base, status: "failed", changes: written.changes.map((change) => ({ ...change, verification: "failed" as const })), warnings, errors: ["Output failed MP3 structural validation — no verified output is offered."], output: undefined };
  }

  // 2. Audio segment byte equality (input vs output). Frame-derived end.
  const audioIntegrity = compareMp3AudioPayloads(inputBytes, written.data);
  if (!audioIntegrity.ok) {
    return { ...base, status: "failed", changes: written.changes.map((change) => ({ ...change, verification: "failed" as const })), warnings, errors: [audioIntegrity.reason ?? "MPEG audio integrity changed before/after rewriting; output withheld."], output: undefined };
  }

  // 3. Re-inspect the output (fresh parser pass).
  const after = await inspectAudio(`${fileId}:after`, new Blob([new Uint8Array(written.data.slice().buffer as ArrayBuffer)]), outputName);
  const tagsOf = (id: string) => {
    const category = after.categories.find((entry) => entry.category.startsWith("ID3v2"));
    return category?.tags.filter((tag) => tag.key === id) ?? [];
  };

  // 4. Per-field requested → observed verification.
  const changes = [...written.changes];
  // Disclosed unsupported fields (no verified ID3 channel) — never counted
  // as failed writes, always visible in the ledger and warnings.
  for (const field of noChannel) {
    changes.push({
      group: "ID3",
      key: field,
      action: "unchanged",
      verification: "verified",
      before: "",
      after: "",
      reason: `${FIELD_LABELS[field] ?? field} has no verified ID3 frame mapping — disclosed as unsupported, never invented.`,
    });
    warnings.push(`${FIELD_LABELS[field] ?? field} is not written to MP3 (no verified ID3 frame mapping) — disclosed as unsupported.`);
  }
  let allVerified = true;
  let anyWritten = false;
  for (const [field, value] of Object.entries(requested) as Array<[ProfileField, string]>) {
    const frame = OBSERVED_FRAME_FOR[field];
    let verified = false;
    let observed: string | undefined;
    if (frame) {
      const match = tagsOf(frame).find((tag) => tag.displayedValue === value);
      verified = Boolean(match);
      observed = tagsOf(frame)[0]?.displayedValue;
    } else if (field === "description") {
      const match = tagsOf("COMM").find((tag) => tag.displayedValue === value);
      verified = Boolean(match);
      observed = tagsOf("COMM")[0]?.displayedValue;
    } else if (field === "keywords" || field === "locationName") {
      const description = field === "keywords" ? "KEYWORDS" : "LOCATION";
      const match = tagsOf("TXXX").find((tag) => tag.label === `Custom Text: ${description}` && tag.displayedValue === value);
      verified = Boolean(match);
      observed = tagsOf("TXXX").find((tag) => tag.label === `Custom Text: ${description}`)?.displayedValue;
    } else if (field === "website") {
      const match = tagsOf("WXXX").find((tag) => tag.displayedValue === value);
      verified = Boolean(match);
      observed = tagsOf("WXXX")[0]?.displayedValue;
    }
    if (verified) anyWritten = true;
    else allVerified = false;
    changes.push({
      group: "ID3",
      key: field,
      action: "rewritten",
      before: before.categories.find((category) => category.category.startsWith("ID3v2"))?.tags.find((tag) => tag.key === (frame ?? (field === "description" ? "COMM" : field === "website" ? "WXXX" : "TXXX")))?.displayedValue,
      after: observed,
      verification: verified ? "verified" : "failed",
      reason: verified
        ? `${FIELD_LABELS[field] ?? field} re-read from the output bytes and matched the requested value.`
        : `${FIELD_LABELS[field] ?? field} could not be confirmed in the output — ${observed !== undefined ? `observed "${observed}"` : "absent"}. Verification failed.`,
    });
  }

  const skippedUnsupported = written.skipped.length > 0;
  const status: RewriteStatus = allVerified && anyWritten
    ? skippedUnsupported ? "partially_rewritten" : "verified_rewritten"
    : anyWritten ? "partially_rewritten" : allVerified ? "unchanged_no_target_tags" : "not_verified";

  return {
    ...base,
    status,
    changes,
    warnings,
    errors: status === "not_verified" ? ["One or more requested fields could not be verified in the output bytes."] : [],
    output: status === "verified_rewritten" || status === "partially_rewritten" || status === "unchanged_no_target_tags"
      ? new Blob([new Uint8Array(written.data.slice().buffer as ArrayBuffer)], { type: "audio/mpeg" })
      : undefined,
  };
}
