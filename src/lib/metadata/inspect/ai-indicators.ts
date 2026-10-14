import type { AiIndicator } from "../../../types/inspection";

/**
 * AI-associated *indicator* rules (Phase 2).
 *
 * Only designated provenance/software fields are examined — ordinary user
 * text (captions, descriptions, titles, comments, keywords) is NEVER
 * scanned, so a caption mentioning "Ai" cannot produce a finding. Presence
 * of an indicator is a clue, never proof of AI origin; absence proves
 * nothing about non-AI origin.
 */

export interface IndicatorEvidence {
  group: string;
  key: string;
  value: string;
}

/** Generator/software signatures matched case-insensitively (substring). */
const GENERATOR_SIGNATURES = [
  "stable diffusion",
  "sdxl",
  "comfyui",
  "automatic1111",
  "a1111",
  "fooocus",
  "midjourney",
  "dall-e",
  "dalle",
  "openai",
  "chatgpt",
  "gpt-image",
  "sora",
  "firefly",
  "leonardo",
  "ideogram",
  "flux",
  "nightcafe",
  "starryai",
  "wombo",
  "getimg",
  "playground ai",
];

/** Fields eligible for generator/software matching. */
const SOFTWARE_FIELDS = new Set(
  ["software", "creatorTool", "creatortool", "generator", "history", "softwareAgent"].map((s) =>
    s.toLowerCase(),
  ),
);

function containsGenerator(value: string): string | null {
  const lower = value.toLowerCase();
  for (const signature of GENERATOR_SIGNATURES) {
    if (lower.includes(signature)) return signature;
  }
  return null;
}

function mentionsAiWord(value: string): boolean {
  return /\bai\b/i.test(value);
}

/**
 * Evaluate one normalized evidence item. Returns indicators (possibly
 * several, e.g. DigitalSourceType + prompt field on the same file are
 * reported independently by the caller — this function reports per item).
 */
export function evaluateIndicator(evidence: IndicatorEvidence): AiIndicator[] {
  const findings: AiIndicator[] = [];
  const keyLower = evidence.key.toLowerCase();
  const value = evidence.value;

  // 1. IPTC DigitalSourceType = trainedAlgorithmicMedia: explicit.
  if (
    keyLower.includes("digitalsourcetype") &&
    value.toLowerCase().includes("trainedalgorithmicmedia")
  ) {
    findings.push({
      label: "IPTC DigitalSourceType declares AI-generated source",
      evidenceGroup: evidence.group,
      evidenceKey: evidence.key,
      matchedValue: value.slice(0, 200),
      confidence: "explicit",
      explanation:
        "The file's own metadata labels its digital source as trained algorithmic media. This is a standards-based disclosure, not an independent verdict.",
    });
    return findings;
  }

  // 2. Named AI prompt/provenance fields with non-empty values: explicit.
  if (/aiprompt|aigeneration|aisystem/i.test(evidence.key) && value.trim() !== "") {
    findings.push({
      label: `AI provenance field present (${evidence.key})`,
      evidenceGroup: evidence.group,
      evidenceKey: evidence.key,
      matchedValue: value.slice(0, 200),
      confidence: "explicit",
      explanation:
        "A metadata field reserved for AI-generation provenance carries a value. Indicates AI tooling touched the file's metadata; content origin still needs human judgment.",
    });
    return findings;
  }

  // 3. Known generator signature in a software-designated field: explicit.
  if (SOFTWARE_FIELDS.has(keyLower)) {
    const hit = containsGenerator(value);
    if (hit !== null) {
      findings.push({
        label: `Generator signature "${hit}" in ${evidence.key}`,
        evidenceGroup: evidence.group,
        evidenceKey: evidence.key,
        matchedValue: value.slice(0, 200),
        confidence: "explicit",
        explanation:
          "A software/designation field names a known AI image generator. Strong clue, but fields can be edited or forged.",
      });
      return findings;
    }
    // 4. Bare "AI" word in a software field, no known generator: possible.
    if (mentionsAiWord(value)) {
      findings.push({
        label: `Software field mentions AI (${evidence.key})`,
        evidenceGroup: evidence.group,
        evidenceKey: evidence.key,
        matchedValue: value.slice(0, 200),
        confidence: "possible",
        explanation:
          "The naming mentions AI but matches no known generator — could be an AI feature, plugin, or coincidence. Treat as weak.",
      });
    }
  }
  return findings;
}

export const AI_INDICATOR_DISCLAIMER =
  "Metadata indicators are not proof of AI creation, and missing indicators do not prove an image is non-AI.";
