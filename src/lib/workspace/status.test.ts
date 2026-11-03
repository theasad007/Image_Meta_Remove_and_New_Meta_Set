import { describe, expect, it } from "vitest";
import {
  deriveRowStatus,
  type RowStateInput,
} from "./status";
import type { FileCleaningResult } from "../metadata/clean/types";
import type { FileRewriteResult } from "../metadata/rewrite/rewrite";
import type { ImageInspectionResult, InspectionOutcome } from "../../types/inspection";
import { emptyInspection } from "../../types/inspection";

function inspection(outcome: InspectionOutcome, over: Partial<ImageInspectionResult> = {}): ImageInspectionResult {
  return { ...emptyInspection("f1", "a.jpg", 100), outcome, warnings: [], ...over };
}

function cleaning(status: FileCleaningResult["status"], over: Partial<FileCleaningResult> = {}): FileCleaningResult {
  return {
    fileId: "f1",
    inputName: "a.jpg",
    detectedFormat: "jpeg",
    inputBytes: 100,
    before: inspection("completed"),
    policy: { mode: "privacy_safe_default" },
    status,
    changes: [],
    warnings: [],
    errors: [],
    cleanedAt: "2024-01-01T00:00:00.000Z",
    ...over,
  } as FileCleaningResult;
}

function rewrite(status: FileRewriteResult["status"], over: Partial<FileRewriteResult> = {}): FileRewriteResult {
  return {
    fileId: "f1",
    inputName: "a.jpg",
    detectedFormat: "jpeg",
    inputBytes: 100,
    before: inspection("completed"),
    mode: "update_selected",
    requestedFields: [],
    status,
    changes: [],
    warnings: [],
    errors: [],
    rewrittenAt: "2024-01-01T00:00:00.000Z",
    ...over,
  } as FileRewriteResult;
}

function state(over: Partial<RowStateInput>): RowStateInput {
  return { inspectionState: undefined, cleaningState: undefined, ...over };
}

describe("deriveRowStatus", () => {
  it("calls an inspected-but-uncleaned image Inspected — never Completed", () => {
    const status = deriveRowStatus(state({ inspectionState: "completed" }));
    expect(status.label).toBe("Inspected");
    expect(status.key).toBe("inspected");
    expect(status.verifiedOutput).toBe(false);
    expect(status.tone).toBe("success");
  });

  it("marks queued rows without any result", () => {
    expect(deriveRowStatus(state({})).label).toBe("Queued");
    expect(deriveRowStatus(state({ inspectionState: undefined })).key).toBe("queued");
  });

  it("shows an active Processing state for cleaning and rewriting", () => {
    expect(deriveRowStatus(state({ cleaningState: "cleaning" })).label).toBe("Processing…");
    expect(deriveRowStatus(state({ rewriteState: "rewriting", rewriteResult: undefined })).busy).toBe(true);
  });

  it("maps verified cleaning to a truthful verified label with output", () => {
    expect(deriveRowStatus(state({
      inspectionState: "completed",
      cleaningState: "verified_clean",
      cleaningResult: cleaning("verified_clean"),
    }))).toMatchObject({ key: "verified_clean", label: "Cleaned · verified", tone: "success", verifiedOutput: true });
  });

  it("does not claim cleaning success for failed or partial states", () => {
    expect(deriveRowStatus(state({ cleaningState: "failed", cleaningResult: cleaning("failed") })).label).toBe("Failed");
    const partial = deriveRowStatus(state({ cleaningState: "partially_cleaned", cleaningResult: cleaning("partially_cleaned") }));
    expect(partial.label).toBe("Partial");
    expect(partial.verifiedOutput).toBe(true); // partial output exists, but is never sold as fully clean
    expect(partial.tone).not.toBe("success");
  });

  it("maps rewrite results, preferring the latest stage over cleaning", () => {
    expect(deriveRowStatus(state({
      cleaningState: "verified_clean",
      cleaningResult: cleaning("verified_clean"),
      rewriteState: "verified_rewritten",
      rewriteResult: rewrite("verified_rewritten"),
    }))).toMatchObject({ key: "verified_rewritten", label: "Rewritten · verified" });
  });

  it("falls back to a verified cleaning label when the rewrite failed", () => {
    expect(deriveRowStatus(state({
      cleaningState: "verified_clean",
      cleaningResult: cleaning("verified_clean", { output: new Blob(), outputName: "a-clean.jpg" }),
      rewriteState: "failed",
      rewriteResult: rewrite("failed"),
    })).key).toBe("verified_clean");
  });

  it("keeps inspection failure and unsupported vocabulary", () => {
    expect(deriveRowStatus(state({ inspectionState: "failed" })).label).toBe("Inspection failed");
    expect(deriveRowStatus(state({ inspectionState: "unsupported" })).label).toBe("Unsupported");
    expect(deriveRowStatus(state({ inspectionState: "partial" })).label).toBe("Inspected (partial)");
  });
});
