import type { FileCleaningResult } from "../metadata/clean/types";
import type { ImageInspectionResult } from "../../types/inspection";
import type { QueueEntry } from "../../types/media";

/** Minimal honest records for reporting unit tests (no engine needed). */
let counter = 0;

export function minimalEntry(name: string, size = 1000, mediaKind: QueueEntry["item"]["detected"]["mediaKind"] = "image"): QueueEntry {
  counter += 1;
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  return {
    item: {
      id: `test-${counter}`,
      name,
      sanitizedName: name,
      sizeBytes: size,
      detected: {
        mediaKind,
        extension,
        mimeHint: "",
        label: extension.toUpperCase() || "Unknown",
        supportedForQueue: mediaKind !== "unknown",
        detectionMethod: "binary-sniff",
        binaryVerified: true,
        isEmpty: size === 0,
        note: "test",
      },
      status: "queued",
      addedAt: 0,
    },
    source: new File([new Uint8Array(size)], name),
  };
}

export function minimalInspection(overrides: Partial<ImageInspectionResult> = {}): ImageInspectionResult {
  return {
    fileId: "test-file",
    fileName: "test.jpg",
    detectedFormat: "jpeg",
    bytes: 1000,
    outcome: "completed",
    categories: [],
    aiIndicators: [],
    warnings: [],
    inspectedAt: "2026-10-13T00:00:00.000Z",
    ...overrides,
  };
}

export function minimalCleaning(overrides: Partial<FileCleaningResult> = {}): FileCleaningResult {
  return {
    fileId: "test-file",
    inputName: "test.jpg",
    outputName: "test-clean.jpg",
    detectedFormat: "jpeg",
    inputBytes: 1000,
    outputBytes: 900,
    before: minimalInspection(),
    after: minimalInspection(),
    output: new Blob([new Uint8Array(10)]),
    policy: { mode: "privacy_safe_default" },
    status: "verified_clean",
    changes: [],
    warnings: [],
    errors: [],
    cleanedAt: "2026-10-13T00:00:00.000Z",
    ...overrides,
  };
}
