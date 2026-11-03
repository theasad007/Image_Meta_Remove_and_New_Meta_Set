import type { AiIndicator } from "../../../types/inspection";
import { evaluateIndicator } from "../inspect/ai-indicators";
import type { Mp3Probe } from "./id3";

/**
 * MP3 AI-evidence + C2PA status classification (Phase 08) — metadata-only,
 * source-attributed, never an acoustic/audible-content verdict.
 *
 * Statuses are deliberately distinct (no flattening unknown to "clean"):
 * - `not-detected-in-supported-fields` — scanned supported fields, nothing found.
 * - `qualified-indicator` — explicit qualified metadata in ID3 frames.
 * - `c2pa-carrier-detected` — a GEOB frame references C2PA; presence ≠ validity.
 * - `c2pa-validation-not-available` — the browser SDK path has NOT been proven
 *   for MP3 (no signed fixture); never claim validation without one.
 * - `parse-error` / `unsupported` — honest failure/lack-of-coverage states.
 *
 * Evidence provenance is always traceable to the exact frame (TXXX
 * description, COMM, PRIV owner). Ordinary artist/title/album text is never
 * scanned — a song whose title contains "AI" is not evidence.
 */

export type Mp3EvidenceStatus =
  | "not-detected-in-supported-fields"
  | "qualified-indicator"
  | "c2pa-carrier-detected"
  | "c2pa-validation-not-available"
  | "parse-error"
  | "unsupported";

export interface Mp3EvidenceResult {
  status: Mp3EvidenceStatus;
  indicators: AiIndicator[];
  /** Human summary for UI/report — precise about what was and was not done. */
  summary: string;
  coverage: string;
}

const C2PA_HINT = /c2pa|contentcredential|content-credential/i;

/** Qualified TXXX descriptions eligible for generator matching. */
const QUALIFIED_TXXX = /^(ai[_-]?generator|ai[_-]?tool|ai[_-]?model|ai[_-]?provenance|generator|digital[s _-]?source[_-]?type|software[_-]?agent)$/i;

function classifyGeob(probe: Mp3Probe): { carrier: boolean; hint: string | null } {
  const geobs = probe.tag?.frames.filter((frame) => frame.kind === "geob") ?? [];
  for (const frame of geobs) {
    const haystack = `${frame.label} ${frame.values.join(" ")}`;
    if (C2PA_HINT.test(haystack)) {
      return { carrier: true, hint: frame.values[0] ?? "GEOB carrier" };
    }
  }
  return { carrier: false, hint: null };
}

export function classifyMp3Evidence(probe: Mp3Probe): Mp3EvidenceResult {
  if (!probe.ok || !probe.tag) {
    return {
      status: probe.ok ? "unsupported" : "parse-error",
      indicators: [],
      summary: probe.ok
        ? "AI evidence classification unavailable for this tag structure — reported as unsupported rather than clean."
        : "MP3 could not be parsed — no AI evidence claims are made.",
      coverage: "none — the tag structure could not be read",
    };
  }

  const indicators: AiIndicator[] = [];

  // Qualified fields only: TXXX with AI/provenance descriptions, PRIV
  // owners, COMM from known provenance tools. Ordinary title/artist text is
  // NEVER scanned.
  for (const frame of probe.tag.frames) {
    if (frame.kind === "custom") {
      const description = frame.label.replace(/^Custom Text:\s*/i, "");
      if (QUALIFIED_TXXX.test(description)) {
        const value = frame.values.join(" ");
        // Route through the shared indicator engine with the semantic key
        // the description names (DigitalSourceType disclosures go down the
        // standards-based pathway), then restore the TXXX provenance.
        const routingKey = /digital[\s_-]?source[\s_-]?type/i.test(description) ? "DigitalSourceType" : "softwareAgent";
        for (const indicator of evaluateIndicator({ group: "ID3", key: routingKey, value })) {
          indicators.push({ ...indicator, evidenceKey: `TXXX:${description}` });
        }
      }
    }
    if (frame.kind === "comment") {
      // Comments are scanned ONLY for generator signatures via the
      // software-field pathway — a bare "AI" word in a comment is ignored.
      const value = frame.values.join(" ");
      indicators.push(...evaluateIndicator({ group: "ID3", key: "softwareAgent", value }));
    }
    if (frame.kind === "priv") {
      const owner = frame.values.join(" ");
      for (const indicator of evaluateIndicator({ group: "ID3", key: "softwareAgent", value: owner })) {
        indicators.push({ ...indicator, evidenceKey: `PRIV:${owner}` });
      }
    }
  }

  const geob = classifyGeob(probe);
  const unique = indicators.filter((indicator, index) =>
    indicators.findIndex((candidate) => candidate.label === indicator.label && candidate.matchedValue === indicator.matchedValue) === index,
  );

  if (geob.carrier) {
    return {
      status: "c2pa-carrier-detected",
      indicators: unique,
      summary: "A GEOB frame references C2PA Content Credentials. The carrier was detected in the ID3 tags — cryptographic validation was NOT performed (the browser validation path has not been proven for MP3 with a signed fixture). Manifest presence is not signature validity.",
      coverage: `ID3v2 frames (${probe.tag.frames.length} listed) · GEOB carrier scan`,
    };
  }

  if (unique.length > 0) {
    return {
      status: "qualified-indicator",
      indicators: unique,
      summary: "Qualified AI-related metadata indicators were found in designated ID3 fields. These are metadata disclosures — not a verdict that the audio was AI-generated, and not an acoustic analysis.",
      coverage: `ID3v2 frames (${probe.tag.frames.length} listed): TXXX provenance fields, COMM software signatures, PRIV owners`,
    };
  }

  return {
    status: "not-detected-in-supported-fields",
    indicators: [],
    summary: "No AI-related indicators were found in the supported ID3 fields that were scanned. This is not proof the audio is non-AI — unknown or binary AI markers outside the supported fields are not inspected.",
    coverage: `ID3v2 frames (${probe.tag.frames.length} listed): TXXX provenance fields, COMM software signatures, PRIV owners`,
  };
}
