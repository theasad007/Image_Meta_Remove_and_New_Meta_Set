import type { ImageInspectionResult, InspectionCategoryResult } from "../../../types/inspection";
import type { SniffedKind } from "../../format-detection/signatures";
import { probeMp3, type Id3FrameView, type Mp3Probe } from "./id3";
import { classifyMp3Evidence } from "./ai-evidence";

/**
 * MP3 inspection (Phase 07) — read-only, byte-honest. Produces the shared
 * inspection result shape with audio-specific categories. NEVER displays
 * "EXIF 0"/"GPS 0" style claims for audio: those systems are not checked,
 * so unsupported surfaces say N/A instead.
 *
 * C2PA note (Phase 08 refines): a GEOB frame whose metadata hints at C2PA
 * is reported as a DETECTED CARRIER — never as a validated manifest.
 */

const MAX_INSPECT_BYTES = 256 * 1024 * 1024;

function category(
  name: string,
  status: InspectionCategoryResult["status"],
  tags: InspectionCategoryResult["tags"],
  warnings: string[] = [],
): InspectionCategoryResult {
  return { category: name, status, tags, warnings, reader: "Private Metadata Cleaner (ID3)" };
}

function frameTag(frame: Id3FrameView): InspectionCategoryResult["tags"][number] {
  return {
    group: "ID3",
    key: frame.id,
    label: frame.label,
    displayedValue: frame.values.length > 0 ? frame.values.join(" | ") : "(binary payload)",
    valueType: frame.artwork ? "binary" : "text",
    technical: frame.warning !== undefined,
  };
}

function summarizeProbe(probe: Mp3Probe, fileName: string, bytes: number): ImageInspectionResult {
  const categories: InspectionCategoryResult[] = [];
  const warnings: string[] = [...probe.warnings];

  if (probe.tag) {
    const tags = probe.tag.frames.map(frameTag);
    categories.push(category(`ID3v2.${probe.tag.major} tags`, tags.length > 0 ? "detected" : "not_detected", tags));
    const flagNotes: string[] = [];
    if (probe.tag.unsynchronisation) flagNotes.push("unsynchronisation flag set");
    if (probe.tag.extendedHeader) flagNotes.push("extended header present");
    if (probe.tag.experimental) flagNotes.push("experimental flag set");
    if (flagNotes.length > 0) categories.push(category("ID3 header flags", "detected", [], flagNotes));
  } else {
    categories.push(category("ID3v2 tags", "not_detected", [], ["No ID3v2 tag in this file."]));
  }

  if (probe.id3v1) {
    const v1 = probe.id3v1;
    categories.push(category("ID3v1 tag (end of file)", "detected", [{
      group: "ID3v1",
      key: "TAG",
      label: "ID3v1 summary",
      displayedValue: [v1.title, v1.artist, v1.album].filter((value) => value !== "").join(" · ") || "(empty fields)",
      valueType: "text",
    }]));
  } else {
    // Always present so the verifier can prove absence (full removal).
    categories.push(category("ID3v1 tag (end of file)", "not_detected", [], ["No ID3v1 tag at end-of-file."]));
  }

  const stream = probe.stream;
  const streamTags: InspectionCategoryResult["tags"] = [];
  if (stream) {
    streamTags.push(
      { group: "MPEG", key: "frames", label: "Audio frames (scanned)", displayedValue: String(stream.frameCount), valueType: "number" },
      { group: "MPEG", key: "sampleRate", label: "Sample rate", displayedValue: stream.sampleRate !== null ? `${stream.sampleRate} Hz` : "unknown", valueType: "number" },
      { group: "MPEG", key: "channels", label: "Channel mode", displayedValue: stream.channelMode ?? "unknown", valueType: "text" },
      { group: "MPEG", key: "bitrate", label: "Bitrate", displayedValue: stream.bitrateKbps !== null ? `${stream.bitrateKbps} kbps` : "unknown", valueType: "number" },
      {
        group: "MPEG",
        key: "duration",
        label: "Duration (estimated)",
        displayedValue: stream.durationSeconds !== null
          ? `${stream.durationSeconds.toFixed(2)} s${stream.durationExact ? "" : " · estimate"}`
          : "unknown",
        valueType: "text",
        technical: !stream.durationExact,
      },
      { group: "MPEG", key: "xing", label: "Xing/Info header", displayedValue: stream.xing ? "present" : "absent", valueType: "text" },
    );
  }
  categories.push(category(
    "MPEG audio stream",
    stream ? "detected" : "not_detected",
    streamTags,
    stream ? [] : ["No valid MPEG Layer III frames were found after the tag."],
  ));

  if (probe.trailing.length > 0) {
    categories.push(category("Trailing structures", "detected", probe.trailing.map((structure) => ({
      group: "Trailing",
      key: structure.kind,
      label: structure.kind,
      displayedValue: `${structure.size} bytes at offset ${structure.start} — read-only/unsupported`,
      valueType: "text",
      technical: false,
    }) as InspectionCategoryResult["tags"][number])));
  } else {
    categories.push(category("Trailing structures", "not_detected", [], ["No APEv2/Lyrics3 trailing structures detected."]));
  }

  // Phase 08: AI evidence + C2PA classification (metadata-only, honest
  // statuses — never an acoustic verdict, never claimed cryptographic
  // validation without a proven signed fixture).
  const evidence = classifyMp3Evidence(probe);
  const geobFrames = probe.tag?.frames.filter((frame) => frame.kind === "geob") ?? [];
  const c2paHint = geobFrames.some((frame) => /c2pa/i.test(frame.values.join(" ") + frame.label));
  categories.push(category(
    "C2PA / Content Credentials",
    c2paHint ? "detected" : "not_inspected",
    c2paHint ? [{
      group: "C2PA",
      key: "GEOB",
      label: "C2PA-like GEOB carrier",
      displayedValue: "A GEOB frame references C2PA — carrier detected, cryptographic validation NOT performed.",
      valueType: "text",
    }] : [],
    c2paHint ? [] : ["No C2PA carrier check beyond the GEOB marker scan for MP3."],
  ));

  // AI metadata evidence (from the same classifier that drives the details body).
  const aiEvidenceCategory = category(
    "AI metadata evidence (ID3)",
    evidence.status === "qualified-indicator" || evidence.status === "c2pa-carrier-detected" ? "detected" : "not_detected",
    evidence.indicators.map((indicator) => ({
      group: indicator.evidenceGroup,
      key: indicator.evidenceKey,
      label: indicator.label,
      displayedValue: indicator.matchedValue,
      valueType: "text",
    })),
    [evidence.summary],
  );
  categories.push(aiEvidenceCategory);

  return {
    fileId: "",
    fileName,
    detectedFormat: "mp3",
    bytes,
    outcome: probe.ok ? "completed" : "failed",
    categories,
    aiIndicators: evidence.indicators,
    warnings,
    inspectedAt: new Date().toISOString(),
  };
}

/** Inspect an MP3 (or any bytes already sniffed as mp3-audio). */
export async function inspectAudio(
  fileId: string,
  source: File | Blob,
  fileName: string,
  kind: SniffedKind = "mp3-audio",
): Promise<ImageInspectionResult> {
  if (source.size > MAX_INSPECT_BYTES) {
    return {
      fileId,
      fileName,
      detectedFormat: kind,
      bytes: source.size,
      outcome: "unsupported",
      categories: [],
      aiIndicators: [],
      warnings: ["File exceeds the local inspection size limit — refused safely, nothing was uploaded."],
      inspectedAt: new Date().toISOString(),
    };
  }
  const buffer = await source.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const probe = probeMp3(bytes);
  const result = summarizeProbe(probe, fileName, bytes.length);
  return { ...result, fileId };
}
