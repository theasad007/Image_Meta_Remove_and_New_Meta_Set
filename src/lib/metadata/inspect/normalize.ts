import type { ExpandedTags } from "exifreader";
import type {
  AiIndicator,
  ImageInspectionResult,
  InspectionCategoryResult,
  InspectionOutcome,
  MetadataTag,
} from "../../../types/inspection";
import type { BinaryVerification } from "../../format-detection/signatures";
import { evaluateIndicator } from "./ai-indicators";

/**
 * Normalize raw ExifReader output into the shared inspection model.
 * Every value is treated as untrusted text: length-capped, control
 * characters stripped, never HTML. Binary payloads (thumbnails, embedded
 * byte blobs) are counted, never embedded in results.
 */

export const MAX_TAGS_PER_CATEGORY = 400;
export const MAX_VALUE_CHARS = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBinaryish(value: unknown): boolean {
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return true;
  if (Array.isArray(value)) return value.some(isBinaryish);
  if (isRecord(value)) return Object.values(value).some(isBinaryish);
  return false;
}

function cleanText(raw: string): string {
  return raw
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toDisplayed(input: unknown): { text: string; truncated: boolean } {
  let text: string;
  if (typeof input === "string") text = input;
  else if (typeof input === "number" || typeof input === "boolean") text = String(input);
  else if (input === null || input === undefined) text = "";
  else {
    try {
      text = JSON.stringify(input) ?? "";
    } catch {
      text = String(input);
    }
  }
  const cleaned = cleanText(text);
  if (cleaned.length > MAX_VALUE_CHARS) {
    return { text: `${cleaned.slice(0, MAX_VALUE_CHARS)}…`, truncated: true };
  }
  return { text: cleaned, truncated: false };
}

function describeTag(raw: unknown): { text: string; truncated: boolean; valueType: string } {
  if (isRecord(raw)) {
    const description = raw["description"];
    if (typeof description === "string" || typeof description === "number") {
      const rendered = toDisplayed(description);
      return { ...rendered, valueType: typeof description };
    }
    const value = raw["value"];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      const rendered = toDisplayed(value);
      return { ...rendered, valueType: typeof value };
    }
    if (Array.isArray(value)) {
      // Lists (keywords, creators): join scalar descriptions where possible.
      const parts: string[] = [];
      for (const item of value) {
        if (typeof item === "string" || typeof item === "number") parts.push(String(item));
        else if (isRecord(item)) {
          const d = item["description"];
          if (typeof d === "string") parts.push(d);
          else if (typeof item["value"] === "string") parts.push(item["value"] as string);
        }
        if (parts.join("; ").length > MAX_VALUE_CHARS) break;
      }
      const rendered = toDisplayed(parts.join("; "));
      return { ...rendered, valueType: "list" };
    }
  }
  const rendered = toDisplayed(raw);
  return { ...rendered, valueType: typeof raw };
}

const PNG_TECHNICAL_KEYS = new Set([
  "Image Width",
  "Image Height",
  "Bit Depth",
  "Color Type",
  "Compression",
  "Filter",
  "Interlace",
  "Pixels Per Unit X",
  "Pixels Per Unit Y",
  "Pixel Units",
  "Modify Date",
]);

const XMP_NAMESPACES: Record<string, string> = {
  creator: "dc",
  rights: "dc",
  description: "dc",
  title: "dc",
  subject: "dc",
  Credit: "photoshop",
  Copyright: "photoshop",
  CreatorTool: "xmp",
  CreateDate: "xmp",
  ModifyDate: "xmp",
  DigitalSourceType: "Iptc4xmpExt",
  AIPromptInformation: "Iptc4xmpExt",
  AIPromptWriterName: "Iptc4xmpExt",
  AISystemUsed: "Iptc4xmpExt",
  AISystemVersionUsed: "Iptc4xmpExt",
};

function buildTags(
  group: string,
  entries: Record<string, unknown> | undefined,
  options: { source?: string; technical?: boolean; skipKeys?: Set<string> } = {},
): { tags: MetadataTag[]; omittedBinaries: number } {
  const tags: MetadataTag[] = [];
  let omittedBinaries = 0;
  if (!entries) return { tags, omittedBinaries };
  for (const [key, raw] of Object.entries(entries)) {
    if (options.skipKeys?.has(key)) continue;
    if (key === "__proto__") continue;
    if (isBinaryish(raw)) {
      omittedBinaries += 1;
      continue;
    }
    if (tags.length >= MAX_TAGS_PER_CATEGORY) break;
    const rendered = describeTag(raw);
    tags.push({
      group,
      namespace: group === "XMP" ? XMP_NAMESPACES[key] : undefined,
      key,
      displayedValue: rendered.text,
      truncated: rendered.truncated,
      valueType: rendered.valueType,
      source: options.source,
      technical: options.technical,
    });
  }
  return { tags, omittedBinaries };
}

function category(
  categoryName: string,
  status: InspectionCategoryResult["status"],
  tags: MetadataTag[],
  warnings: string[],
  reader = "ExifReader 4.50.0",
): InspectionCategoryResult {
  return { category: categoryName, status, tags, warnings, reader };
}

function rationalToNumber(value: unknown): number | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const nums: number[] = [];
  for (const part of value) {
    if (typeof part === "number") {
      nums.push(part);
    } else if (Array.isArray(part) && part.length === 2) {
      const [num, den] = part;
      if (typeof num !== "number" || typeof den !== "number" || den === 0) return null;
      nums.push(num / den);
    } else {
      return null;
    }
  }
  if (nums.length === 1) return nums[0] ?? null;
  if (nums.length >= 3) {
    const [d, m, s] = nums;
    if (d === undefined || m === undefined || s === undefined) return null;
    return d + m / 60 + s / 3600;
  }
  return null;
}

function refString(raw: unknown): string | null {
  if (!isRecord(raw)) return null;
  const value = raw["value"];
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

export interface GpsDerivation {
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  latRef: string | null;
  lonRef: string | null;
  /** True when refs were absent and N/E/above-sea-level was assumed (ExifTool-compatible convention). */
  refsAssumed: boolean;
  /** True when GPS tags exist but values are unreadable (truncated/corrupt). */
  unreadable: boolean;
  source: "reader-gps-group" | "exif-tags" | "absent";
}

/** Prefer the reader's computed group; fall back to raw EXIF GPS tags. */
export function deriveGps(tags: ExpandedTags): GpsDerivation {
  const gps = tags.gps;
  if (gps && typeof gps.Latitude === "number" && typeof gps.Longitude === "number") {
    if (!Number.isFinite(gps.Latitude) || !Number.isFinite(gps.Longitude)) {
      return { latitude: null, longitude: null, altitude: null, latRef: null, lonRef: null, refsAssumed: false, unreadable: true, source: "absent" };
    }
    return {
      latitude: gps.Latitude,
      longitude: gps.Longitude,
      altitude: typeof gps.Altitude === "number" && Number.isFinite(gps.Altitude) ? gps.Altitude : null,
      latRef: gps.Latitude >= 0 ? "N" : "S",
      lonRef: gps.Longitude >= 0 ? "E" : "W",
      refsAssumed: false,
      unreadable: false,
      source: "reader-gps-group",
    };
  }
  const exif = tags.exif;
  if (!exif) {
    return { latitude: null, longitude: null, altitude: null, latRef: null, lonRef: null, refsAssumed: false, unreadable: false, source: "absent" };
  }
  const latRaw = (exif as Record<string, unknown>)["GPSLatitude"];
  const latRefRaw = (exif as Record<string, unknown>)["GPSLatitudeRef"];
  const lonRaw = (exif as Record<string, unknown>)["GPSLongitude"];
  const lonRefRaw = (exif as Record<string, unknown>)["GPSLongitudeRef"];
  if (!isRecord(latRaw) || !isRecord(lonRaw)) {
    return { latitude: null, longitude: null, altitude: null, latRef: null, lonRef: null, refsAssumed: false, unreadable: false, source: "absent" };
  }
  const lat = rationalToNumber(latRaw["value"]);
  const lon = rationalToNumber(lonRaw["value"]);
  if (lat === null || lon === null) {
    return { latitude: null, longitude: null, altitude: null, latRef: null, lonRef: null, refsAssumed: false, unreadable: false, source: "absent" };
  }
  // Missing refs default to N/E per widespread writer convention
  // (matches ExifTool's own display); flagged as assumed, never silent.
  const latRef = refString(latRefRaw) ?? "N";
  const lonRef = refString(lonRefRaw) ?? "E";
  const refsAssumed = refString(latRefRaw) === null || refString(lonRefRaw) === null;
  const signedLat = latRef === "S" ? -lat : lat;
  const signedLon = lonRef === "W" ? -lon : lon;
  let altitude: number | null = null;
  const altRaw = (exif as Record<string, unknown>)["GPSAltitude"];
  const altRefRaw = (exif as Record<string, unknown>)["GPSAltitudeRef"];
  if (isRecord(altRaw)) {
    const altValue = altRaw["value"];
    let meters: number | null = null;
    if (Array.isArray(altValue) && altValue.length === 2 && typeof altValue[0] === "number" && typeof altValue[1] === "number" && altValue[1] !== 0) {
      meters = (altValue[0] as number) / (altValue[1] as number);
    } else if (typeof altValue === "number") {
      meters = altValue;
    }
    if (meters !== null) {
      const ref = refString(altRefRaw);
      altitude = ref === "1" ? -meters : meters;
    }
  }
  const finite = Number.isFinite(signedLat) && Number.isFinite(signedLon);
  if (!finite) {
    return { latitude: null, longitude: null, altitude: null, latRef: null, lonRef: null, refsAssumed: false, unreadable: true, source: "absent" };
  }
  return { latitude: signedLat, longitude: signedLon, altitude, latRef, lonRef, refsAssumed, unreadable: false, source: "exif-tags" };
}

const AI_ELIGIBLE_XMP = /software|creatortool|generator|history|digitalsourcetype|aiprompt|aisystem/i;

function collectAiIndicators(tags: ExpandedTags): AiIndicator[] {
  const indicators: AiIndicator[] = [];
  const exif = tags.exif as Record<string, unknown> | undefined;
  const software = exif?.["Software"];
  if (isRecord(software)) {
    const rendered = describeTag(software);
    if (rendered.text !== "") {
      indicators.push(
        ...evaluateIndicator({ group: "EXIF", key: "Software", value: rendered.text }),
      );
    }
  }
  const xmp = tags.xmp as Record<string, unknown> | undefined;
  if (xmp) {
    for (const [key, raw] of Object.entries(xmp)) {
      if (key === "_raw" || key === "__proto__") continue;
      if (!AI_ELIGIBLE_XMP.test(key)) continue;
      if (isBinaryish(raw)) continue;
      const rendered = describeTag(raw);
      if (rendered.text === "") continue;
      indicators.push(...evaluateIndicator({ group: "XMP", key, value: rendered.text }));
    }
  }
  return indicators;
}

export interface NormalizeInput {
  fileId: string;
  fileName: string;
  declaredExtension: string;
  bytes: number;
  sniff: BinaryVerification;
  tags: ExpandedTags | null;
  readerError?: string;
}

export function normalizeInspection(input: NormalizeInput): ImageInspectionResult {
  const { fileId, fileName, declaredExtension, bytes, sniff, tags } = input;
  const warnings: string[] = [...sniff.warnings];
  const categories: InspectionCategoryResult[] = [];
  let outcome: InspectionOutcome = "completed";

  const detectedBrand = sniff.majorBrand;

  if (sniff.kind === "empty") {
    return {
      fileId, fileName, declaredFormat: declaredExtension || undefined,
      detectedFormat: sniff.kind, bytes, outcome: "failed",
      categories: [], aiIndicators: [],
      warnings: [...warnings, "File is empty (0 bytes) — nothing to inspect."],
      inspectedAt: new Date().toISOString(),
    };
  }
  if (sniff.kind === "unreadable") {
    return {
      fileId, fileName, declaredFormat: declaredExtension || undefined,
      detectedFormat: sniff.kind, bytes, outcome: "failed",
      categories: [], aiIndicators: [],
      warnings: [...warnings, "File bytes could not be read safely."],
      inspectedAt: new Date().toISOString(),
    };
  }
  if (sniff.kind === "unknown" || sniff.kind === "heif-generic") {
    if (sniff.kind === "heif-generic") {
      warnings.push("Generic HEIF brand only — codec family unverified; attempting a best-effort read.");
    }
  }
  if (sniff.kind === "mp4-video") {
    return {
      fileId, fileName, declaredFormat: declaredExtension || undefined,
      detectedFormat: sniff.kind, detectedBrand, bytes, outcome: "unsupported",
      categories: [
        category("Video metadata", "not_inspected", [], [
          "Video metadata inspection lands in Phase 8 (MediaInfo.js evaluation). Nothing about this file's metadata is claimed.",
        ], "none"),
        category("C2PA / Content Credentials", "not_inspected", [], [C2PA_BLOCKER], "none"),
      ],
      aiIndicators: [],
      warnings,
      inspectedAt: new Date().toISOString(),
    };
  }
  if (sniff.kind === "avif-sequence" || sniff.kind === "heif-sequence") {
    return {
      fileId, fileName, declaredFormat: declaredExtension || undefined,
      detectedFormat: sniff.kind, detectedBrand, bytes, outcome: "unsupported",
      categories: [
        category("Image sequence", "unsupported", [], [
          "Animated/sequence container detected. Frame-sequence metadata is out of scope for the still-image inspector; refusing rather than guessing.",
        ], "binary-sniff"),
        category("C2PA / Content Credentials", "not_inspected", [], [C2PA_BLOCKER], "none"),
      ],
      aiIndicators: [],
      warnings,
      inspectedAt: new Date().toISOString(),
    };
  }
  if (sniff.kind === "unknown") {
    return {
      fileId, fileName, declaredFormat: declaredExtension || undefined,
      detectedFormat: sniff.kind, bytes, outcome: "failed",
      categories: [], aiIndicators: [],
      warnings: [...warnings, "Container not recognized from file bytes — inspection refused without a known format."],
      inspectedAt: new Date().toISOString(),
    };
  }
  if (input.readerError || !tags) {
    return {
      fileId, fileName, declaredFormat: declaredExtension || undefined,
      detectedFormat: sniff.kind, detectedBrand, bytes, outcome: "failed",
      categories: [], aiIndicators: [],
      warnings: [...warnings, `Metadata reader failed: ${input.readerError ?? "no result"}. Queue unaffected.`],
      inspectedAt: new Date().toISOString(),
    };
  }

  const isHeicFamily = sniff.kind === "heic" || sniff.kind === "heif-generic";
  const iptcNote = isHeicFamily || sniff.kind === "avif" || sniff.kind === "webp"
    ? "No native IPTC block in this container — values appear only when carried inside embedded EXIF."
    : undefined;

  // EXIF
  {
    const built = buildTags("EXIF", tags.exif as Record<string, unknown> | undefined, { source: "EXIF IFD" });
    const warns: string[] = [];
    if (built.omittedBinaries > 0) warns.push(`${built.omittedBinaries} binary tag(s) counted but not shown.`);
    categories.push(category("EXIF", built.tags.length > 0 ? "detected" : "not_detected", built.tags, warns));
    if (built.tags.length >= MAX_TAGS_PER_CATEGORY) {
      outcome = "partial";
      warns.push(`Tag list capped at ${MAX_TAGS_PER_CATEGORY}; remaining tags not shown.`);
    }
  }

  // GPS (dedicated, derived)
  {
    const derived = deriveGps(tags);
    if (derived.unreadable) {
      categories.push(category(
        "GPS", "uncertain", [],
        ["GPS tags are present but their values are unreadable (truncated or corrupt metadata) — shown as uncertain, never invented."],
      ));
      if (outcome === "completed") outcome = "partial";
    } else if (derived.latitude !== null && derived.longitude !== null) {
      const inRange =
        derived.latitude >= -90 && derived.latitude <= 90 &&
        derived.longitude >= -180 && derived.longitude <= 180;
      const gpsTags: MetadataTag[] = [
        { group: "GPS", key: "Latitude", displayedValue: String(derived.latitude), source: derived.source === "reader-gps-group" ? "reader GPS group" : "EXIF GPS tags" },
        { group: "GPS", key: "Longitude", displayedValue: String(derived.longitude), source: derived.source === "reader-gps-group" ? "reader GPS group" : "EXIF GPS tags" },
      ];
      if (derived.latRef) gpsTags.push({ group: "GPS", key: "LatitudeRef", displayedValue: derived.latRef });
      if (derived.lonRef) gpsTags.push({ group: "GPS", key: "LongitudeRef", displayedValue: derived.lonRef });
      if (derived.altitude !== null) gpsTags.push({ group: "GPS", key: "Altitude", displayedValue: `${derived.altitude} m` });
      const gpsWarnings = inRange
        ? ["Coordinates shown as signed decimals. No place names are derived from coordinates."]
        : ["Coordinates fall outside valid ranges — shown as uncertain, not trusted."];
      if (derived.refsAssumed) {
        gpsWarnings.push("GPS reference tags absent in file; N/E/above-sea-level assumed per writer convention (matches ExifTool display).");
      }
      categories.push(category(
        "GPS", inRange ? "detected" : "uncertain", gpsTags, gpsWarnings,
      ));
      if (!inRange) outcome = "partial";
    } else {
      categories.push(category("GPS", "not_detected", [], ["No GPS tags found by the reader."]));
    }
  }

  // XMP
  {
    const xmp = tags.xmp as Record<string, unknown> | undefined;
    const raw = xmp?._raw;
    const rawNote = typeof raw === "string" ? [`XMP packet (${raw.length} bytes) parsed; raw packet never displayed.`] : [];
    const built = buildTags("XMP", xmp, { source: "XMP packet", skipKeys: new Set(["_raw"]) });
    if (built.omittedBinaries > 0) rawNote.push(`${built.omittedBinaries} binary XMP node(s) omitted.`);
    categories.push(category("XMP", built.tags.length > 0 ? "detected" : "not_detected", built.tags, rawNote));
  }

  // IPTC
  {
    const built = buildTags("IPTC", tags.iptc as Record<string, unknown> | undefined, { source: "IPTC datasets" });
    const warns = iptcNote ? [iptcNote] : [];
    categories.push(category("IPTC", built.tags.length > 0 ? "detected" : "not_detected", built.tags, warns));
  }

  // Format-specific technical groups
  if (sniff.kind === "png") {
    const header = buildTags("PNG header", { ...(tags.pngFile as Record<string, unknown> | undefined) }, { source: "IHDR/pHYs", technical: true });
    categories.push(category("PNG header (technical)", header.tags.length > 0 ? "detected" : "not_detected", header.tags, ["Geometry and color-type properties; display metadata, not privacy findings."]));
    const text = buildTags("PNG text", tags.pngText as Record<string, unknown> | undefined, { source: "tEXt/zTXt/iTXt" });
    const textTags = text.tags.map((t) => ({ ...t, technical: PNG_TECHNICAL_KEYS.has(t.key) ? true : t.technical }));
    const warns: string[] = [];
    if (text.omittedBinaries > 0) warns.push(`${text.omittedBinaries} binary text node(s) omitted.`);
    categories.push(category("PNG text chunks", textTags.length > 0 ? "detected" : "not_detected", textTags, warns));
  }
  if (sniff.kind === "webp") {
    const riff = buildTags("WebP container", tags.riff as Record<string, unknown> | undefined, { source: "VP8X", technical: true });
    categories.push(category("WebP container (technical)", riff.tags.length > 0 ? "detected" : "not_detected", riff.tags, ["Animation/alpha/dimension flags; display metadata."]));
  }
  if (sniff.kind === "avif" || isHeicFamily) {
    const file = buildTags("ISOBMFF details", tags.file as Record<string, unknown> | undefined, { source: sniff.kind === "avif" ? "AVIF header" : "HEIF header", technical: true });
    categories.push(category("Container details (technical)", file.tags.length > 0 ? "detected" : "not_detected", file.tags, ["Brand/dimension properties; display metadata."]));
  }
  if (sniff.kind === "jpeg") {
    const jfif = buildTags("JPEG details", { ...(tags.jfif as Record<string, unknown> | undefined), ...(tags.file as Record<string, unknown> | undefined) }, { source: "JFIF/SOF", technical: true });
    if (jfif.tags.length > 0) {
      categories.push(category("JPEG details (technical)", "detected", jfif.tags, ["Encoding/dimension properties; display metadata."]));
    }
  }
  {
    const icc = buildTags("ICC", tags.icc as Record<string, unknown> | undefined, { source: "ICC profile", technical: true });
    if (icc.tags.length > 0) {
      categories.push(category("Color profile (technical)", "detected", icc.tags, ["Color profile retained for correct display; Phase 3 decides preservation policy."]));
    }
  }

  // Thumbnail: presence only, never bytes.
  {
    const thumb = (tags as Record<string, unknown>)["Thumbnail"];
    if (isRecord(thumb)) {
      const image = thumb["image"];
      const size = image instanceof ArrayBuffer ? image.byteLength : Array.isArray(image) ? image.length : null;
      warnings.push(`Embedded thumbnail present${size !== null ? ` (${size} bytes)` : ""} — counted, never displayed or stored.`);
    }
  }

  // C2PA: no parser in Phase 2 — never "not detected".
  categories.push(category("C2PA / Content Credentials", "not_inspected", [], [C2PA_BLOCKER], "none"));

  const aiIndicators = collectAiIndicators(tags);
  if (outcome !== "partial" && categories.some((c) => c.status === "failed" || c.status === "unsupported")) {
    outcome = "partial";
  }
  return {
    fileId, fileName,
    declaredFormat: declaredExtension || undefined,
    detectedFormat: sniff.kind, detectedBrand, bytes,
    outcome, categories, aiIndicators, warnings,
    inspectedAt: new Date().toISOString(),
  };
}

export const C2PA_BLOCKER =
  "C2PA validation was not run in this environment. The browser app uses the official C2PA WASM SDK and never treats an uninspected file as absent.";
