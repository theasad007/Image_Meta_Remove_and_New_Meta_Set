import type { AiIndicator, InspectionCategoryResult, MetadataTag } from "../../../types/inspection";

type C2paModule = typeof import("@contentauth/c2pa-web/inline");
type C2paRuntime = Awaited<ReturnType<C2paModule["createC2pa"]>>;

export interface C2paInspection {
  category: InspectionCategoryResult;
  aiIndicators: AiIndicator[];
}

let runtimePromise: Promise<C2paRuntime> | null = null;

/** Standard C2PA Manifest Store JUMBF UUID (format-independent). Exported for tests. */
export const C2PA_STORE_UUID = new Uint8Array([
  0x63, 0x32, 0x70, 0x61, 0x00, 0x11, 0x00, 0x10,
  0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
]);

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let offset = 0; offset <= haystack.length - needle.length; offset += 1) {
    for (let index = 0; index < needle.length; index += 1) {
      if (haystack[offset + index] !== needle[index]) continue outer;
    }
    return true;
  }
  return false;
}

/** Exact-UUID preflight gate. Exported for tests; behavior unchanged. */
export async function hasEmbeddedManifestStore(blob: Blob): Promise<boolean> {
  // The standard C2PA Manifest Store JUMBF UUID is format-independent. An
  // exact 128-bit match is a cheap local gate that avoids loading 12 MB of
  // validator WASM for the overwhelmingly common no-C2PA case.
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return containsBytes(bytes, C2PA_STORE_UUID);
}

function runtime(): Promise<C2paRuntime> {
  if (!runtimePromise) {
    runtimePromise = import("@contentauth/c2pa-web/inline").then(({ createC2pa }) => createC2pa());
  }
  return runtimePromise;
}

function category(
  status: InspectionCategoryResult["status"],
  tags: MetadataTag[],
  warnings: string[],
): InspectionCategoryResult {
  return {
    category: "C2PA / Content Credentials",
    status,
    tags,
    warnings,
    reader: "C2PA SDK (c2pa-rs/WASM)",
  };
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s+/g, " ");
  return text ? text.slice(0, 300) : null;
}

function namedSoftware(manifest: Record<string, unknown>): string[] {
  const names = new Set<string>();
  const generator = cleanText(manifest["claim_generator"]);
  if (generator) names.add(generator);
  const info = manifest["claim_generator_info"];
  if (Array.isArray(info)) {
    for (const item of info) {
      if (!item || typeof item !== "object") continue;
      const name = cleanText((item as Record<string, unknown>)["name"]);
      const version = cleanText((item as Record<string, unknown>)["version"]);
      if (name) names.add(version ? `${name} ${version}` : name);
    }
  }
  const assertions = manifest["assertions"];
  if (Array.isArray(assertions)) {
    for (const assertion of assertions) {
      if (!assertion || typeof assertion !== "object") continue;
      const record = assertion as Record<string, unknown>;
      if (!cleanText(record["label"])?.startsWith("c2pa.actions")) continue;
      const data = record["data"];
      if (!data || typeof data !== "object") continue;
      const actions = (data as Record<string, unknown>)["actions"];
      if (!Array.isArray(actions)) continue;
      for (const action of actions) {
        if (!action || typeof action !== "object") continue;
        const software = (action as Record<string, unknown>)["softwareAgent"];
        if (typeof software === "string") {
          const name = cleanText(software);
          if (name) names.add(name);
        } else if (software && typeof software === "object") {
          const name = cleanText((software as Record<string, unknown>)["name"]);
          if (name) names.add(name);
        }
      }
    }
  }
  return [...names];
}

function findDigitalSourceTypes(value: unknown, found = new Set<string>()): Set<string> {
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    value.forEach((item) => findDigitalSourceTypes(item, found));
    return found;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/digital_?source_?type/i.test(key)) {
      const text = cleanText(child);
      if (text) found.add(text);
    }
    if (child && typeof child === "object") findDigitalSourceTypes(child, found);
  }
  return found;
}

function isAiSource(value: string): boolean {
  return /trainedalgorithmic|algorithmicmedia|compositewithtrainedalgorithmic/i.test(value);
}

export interface C2paValidationSummary {
  /** Counted failures (active manifest only; ingredient deltas are separate). */
  failures: number;
  /** Human-readable `code — explanation` lines, order-preserved, deduplicated. */
  failureDetails: string[];
}

interface ValidationStatusLike {
  code?: unknown;
  explanation?: unknown;
  success?: unknown;
}

interface ValidationStoreLike {
  validation_results?: {
    activeManifest?: { failure?: ValidationStatusLike[] | null } | null;
  } | null;
  validation_status?: ValidationStatusLike[] | null;
}

/** Keep validator output bounded even for adversarial manifests. */
const MAX_FAILURE_DETAILS = 10;

/**
 * Summarize validator failures WITHOUT conflating classes. Only the active
 * manifest's failures are counted — `ingredientDeltas` (if any) describe
 * embedded ingredient claims separately and never leak into this count.
 * Falls back to the flattened `validation_status` list only when the
 * structured results are absent. Pure and Node-testable.
 */
export function summarizeValidation(store: ValidationStoreLike): C2paValidationSummary {
  const fromResults = store.validation_results?.activeManifest?.failure ?? null;
  const list = fromResults ?? (store.validation_status ?? []).filter((item) => item.success === false);
  const details: string[] = [];
  for (const item of list) {
    const code = typeof item.code === "string" ? item.code.trim() : "";
    if (!code) continue;
    const explanation =
      typeof item.explanation === "string" ? item.explanation.trim().replace(/\s+/g, " ") : "";
    const text =
      explanation && explanation.toLowerCase() !== code.toLowerCase()
        ? `${code} — ${explanation.slice(0, 200)}`
        : code;
    if (!details.includes(text)) details.push(text);
    if (details.length >= MAX_FAILURE_DETAILS) break;
  }
  return { failures: list.length, failureDetails: details };
}

export async function inspectC2pa(blob: Blob, mimeType: string): Promise<C2paInspection> {
  if (typeof Worker === "undefined" || typeof WebAssembly === "undefined") {
    return {
      category: category("not_inspected", [], ["C2PA validation requires the browser WASM runtime."]),
      aiIndicators: [],
    };
  }
  try {
    if (!(await hasEmbeddedManifestStore(blob))) {
      return {
        category: category("not_detected", [], ["No embedded C2PA Manifest Store identifier was found."]),
        aiIndicators: [],
      };
    }
    const sdk = await runtime();
    const { Reader } = await import("@contentauth/c2pa-web/inline");
    const reader = await Reader.fromBlob(sdk, mimeType, blob);
    if (!reader) {
      return {
        category: category("not_detected", [], ["No embedded C2PA manifest store was found by the C2PA validator."]),
        aiIndicators: [],
      };
    }
    try {
      const store = await reader.manifestStore();
      const manifests = store.manifests ?? {};
      const activeLabel = store.active_manifest ?? Object.keys(manifests)[0] ?? null;
      const active = activeLabel ? manifests[activeLabel] : undefined;
      const tags: MetadataTag[] = [
        { group: "C2PA / Content Credentials", key: "Manifest Store", displayedValue: "Present", source: "C2PA manifest store" },
      ];
      if (store.validation_state) tags.push({ group: "C2PA / Content Credentials", key: "Validation State", displayedValue: String(store.validation_state), source: "C2PA validator" });
      if (activeLabel) tags.push({ group: "C2PA / Content Credentials", key: "Active Manifest", displayedValue: activeLabel.slice(0, 300), source: "C2PA manifest store" });

      const record = (active ?? {}) as Record<string, unknown>;
      const software = namedSoftware(record);
      software.forEach((name, index) => tags.push({ group: "C2PA / Content Credentials", key: index === 0 ? "Claim Generator" : `Software Agent ${index + 1}`, displayedValue: name, source: "C2PA claim" }));
      const sourceTypes = [...findDigitalSourceTypes(record)];
      sourceTypes.forEach((value, index) => tags.push({ group: "C2PA / Content Credentials", key: index === 0 ? "Digital Source Type" : `Digital Source Type ${index + 1}`, displayedValue: value, source: "C2PA assertion" }));
      const signature = active?.signature_info;
      const signer = cleanText(signature?.common_name) ?? cleanText(signature?.issuer);
      if (signer) tags.push({ group: "C2PA / Content Credentials", key: "Signer", displayedValue: signer, source: "C2PA signature" });

      // Surface exact failure codes (e.g. signingCredential.expired vs
      // claimSignature.mismatch) so an untrusted/expired credential is never
      // mistaken for content tampering. Display-only; same section, no redesign.
      const summary = summarizeValidation(store);
      summary.failureDetails.forEach((detail, index) =>
        tags.push({
          group: "C2PA / Content Credentials",
          key: `Validation Failure ${index + 1}`,
          displayedValue: detail.slice(0, 300),
          source: "C2PA validator",
        }),
      );

      const aiIndicators: AiIndicator[] = [];
      for (const name of software) {
        if (!/openai|dall[ -]?e|chatgpt|stable diffusion|midjourney|firefly|generative ai/i.test(name)) continue;
        aiIndicators.push({
          label: `C2PA claim names ${name}`,
          evidenceGroup: "C2PA / Content Credentials",
          evidenceKey: "Claim Generator",
          matchedValue: name,
          confidence: "explicit",
          explanation: "The signed Content Credentials claim names this software. Signature validity is reported separately by the C2PA validator.",
        });
      }
      for (const value of sourceTypes.filter(isAiSource)) {
        aiIndicators.push({
          label: "C2PA claim declares an AI-associated digital source type",
          evidenceGroup: "C2PA / Content Credentials",
          evidenceKey: "Digital Source Type",
          matchedValue: value,
          confidence: "explicit",
          explanation: "The Content Credentials manifest declares an algorithmic-media source type. This is claim evidence, not an independent visual-content verdict.",
        });
      }
      const failures = summary.failures;
      const warnings = failures > 0
        ? [`Content Credentials were found, but the validator reported ${failures} failure${failures === 1 ? "" : "s"}. Do not treat the claim as trusted.`]
        : ["Content Credentials were parsed locally. Validation state is shown above; presence alone does not prove the claim is trusted."];
      return { category: category("detected", tags, warnings), aiIndicators };
    } finally {
      await reader.free();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 220) : "Unknown C2PA parser error.";
    return {
      category: category("not_inspected", [], [`C2PA validation could not complete: ${message}`]),
      aiIndicators: [],
    };
  }
}
