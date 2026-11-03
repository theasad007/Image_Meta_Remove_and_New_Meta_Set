import { describe, expect, it } from "vitest";
import { minimalEntry, minimalInspection } from "../reporting/testkit";
import type { ImageInspectionResult } from "../../types/inspection";
import {
  blankGeoDraft,
  bulkGeoSnapshot,
  geoBadgeStatus,
  geoCardState,
  geoChangeSummary,
  geoDraftHasValues,
  GEO_BADGE_LABELS,
  originalGpsFromInspection,
  planGeoOperation,
  type GeoCardInput,
  type GeoDraft,
} from "./geotag-state";

/**
 * Screen 09 planning layer: draft isolation, honest operation planning,
 * bulk-snapshot scoping and badge truthfulness — the guarantees the modal
 * and the page handlers both rely on (tested without a browser).
 */

function gpsInspection(overrides: { latitude?: string; longitude?: string; status?: "detected" | "uncertain" | "not_detected" } = {}): ImageInspectionResult {
  const detected = overrides.status === "not_detected";
  return minimalInspection({
    categories: [
      {
        category: "GPS",
        status: detected ? "not_detected" : (overrides.status ?? "detected"),
        warnings: [],
        tags: detected ? [] : [
          { group: "GPS", key: "Latitude", displayedValue: overrides.latitude ?? "-33.8688", source: "EXIF GPS tags" },
          { group: "GPS", key: "LatitudeRef", displayedValue: "S", source: "EXIF GPS tags" },
          { group: "GPS", key: "Longitude", displayedValue: overrides.longitude ?? "-58.3816", source: "EXIF GPS tags" },
          { group: "GPS", key: "LongitudeRef", displayedValue: "W", source: "EXIF GPS tags" },
        ],
      },
    ],
  });
}

const draft = (latitude: string, longitude: string, altitude = ""): GeoDraft => ({ latitude, longitude, altitude });

describe("draft helpers", () => {
  it("starts empty and reports value presence without inventing coordinates", () => {
    const empty = blankGeoDraft();
    expect(empty).toEqual({ latitude: "", longitude: "", altitude: "" });
    expect(geoDraftHasValues(empty)).toBe(false);
    expect(geoDraftHasValues(draft("", "", "0"))).toBe(true);
    expect(geoDraftHasValues(draft("0", "-0.0"))).toBe(true);
  });
});

describe("originalGpsFromInspection", () => {
  it("reads detected coordinates and never invents missing ones", () => {
    const original = originalGpsFromInspection(gpsInspection());
    expect(original?.status).toBe("detected");
    expect(original?.latitude).toBeCloseTo(-33.8688, 6);
    expect(original?.lonRef).toBe("W");
    expect(original?.altitude).toBeNull(); // no Altitude tag — stays null
  });

  it("returns null for files without a GPS category (no invented 0,0)", () => {
    expect(originalGpsFromInspection(undefined)).toBeNull();
    expect(originalGpsFromInspection(minimalInspection())).toBeNull();
    expect(originalGpsFromInspection(gpsInspection({ status: "not_detected" }))).toBeNull();
  });

  it("keeps uncertain files uncertain instead of guessing values", () => {
    const original = originalGpsFromInspection(gpsInspection({ status: "uncertain" }));
    expect(original?.status).toBe("uncertain");
  });
});

describe("planGeoOperation", () => {
  it("plans an addition when the file had no GPS", () => {
    const plan = planGeoOperation(draft("23.8103", "90.4125", "12"), "write", null);
    expect(plan.directive).toEqual({ op: "write", coords: { latitude: 23.8103, longitude: 90.4125, altitude: 12 } });
    expect(plan.action).toBe("added");
    expect(plan.blockedReason).toBeNull();
  });

  it("plans a replacement when GPS already exists", () => {
    const original = originalGpsFromInspection(gpsInspection());
    const plan = planGeoOperation(draft("12.345678", "98.765432"), "write", original);
    expect(plan.directive?.op).toBe("write");
    expect(plan.action).toBe("updated");
  });

  it("blocks invalid drafts and surfaces per-field errors (nothing applied)", () => {
    const plan = planGeoOperation(draft("95", "abc", "1m"), "write", null);
    expect(plan.directive).toBeNull();
    expect(plan.errors.latitude).toMatch(/between −90 and \+90/);
    expect(plan.errors.longitude).toMatch(/decimal number/);
    expect(plan.errors.altitude).toMatch(/number of meters/);
    expect(plan.action).toBe("none");
  });

  it("blocks an empty draft with per-field required errors (never a silent no-op)", () => {
    const plan = planGeoOperation(blankGeoDraft(), "write", null);
    expect(plan.directive).toBeNull();
    expect(plan.errors.latitude).toMatch(/Latitude is required/);
    expect(plan.errors.longitude).toMatch(/Longitude is required/);
    expect(plan.blockedReason).toMatch(/Fix the highlighted coordinate errors/);
    expect(plan.action).toBe("none");
  });

  it("plans removal only for detected GPS and refuses to fake removals", () => {
    const detected = originalGpsFromInspection(gpsInspection());
    const removal = planGeoOperation(blankGeoDraft(), "remove", detected);
    expect(removal.directive).toEqual({ op: "remove" });
    expect(removal.action).toBe("removed");

    const none = originalGpsFromInspection(gpsInspection({ status: "not_detected" }));
    const refused = planGeoOperation(blankGeoDraft(), "remove", none);
    expect(refused.directive).toBeNull();
    expect(refused.blockedReason).toMatch(/No GPS coordinates were found/);
    expect(refused.action).toBe("none");
  });
});

describe("geoBadgeStatus — real state only", () => {
  const original = () => originalGpsFromInspection(gpsInspection())!;
  const none = () => originalGpsFromInspection(gpsInspection({ status: "not_detected" }));

  it("shows GPS detected before any action (never a phantom pending removal)", () => {
    const badge = geoBadgeStatus({
      original: original(),
      draft: blankGeoDraft(),
      plan: planGeoOperation(blankGeoDraft(), "write", original()),
      resultStatus: undefined,
      lastOperation: null,
      gpsSupportedFormat: true,
    });
    expect(badge).toBe("gps-detected");
  });

  it("shows no-GPS for files without coordinates", () => {
    const badge = geoBadgeStatus({
      original: none(),
      draft: blankGeoDraft(),
      plan: planGeoOperation(blankGeoDraft(), "write", none()),
      resultStatus: undefined,
      lastOperation: null,
      gpsSupportedFormat: true,
    });
    expect(badge).toBe("no-gps");
  });

  it("shows modified-not-applied only when a valid write plan exists", () => {
    const plan = planGeoOperation(draft("1", "2"), "write", original());
    const badge = geoBadgeStatus({
      original: original(), draft: draft("1", "2"), plan,
      resultStatus: undefined, lastOperation: null, gpsSupportedFormat: true,
    });
    expect(badge).toBe("modified-not-applied");
  });

  it("shows removal-pending only while a confirmed removal runs", () => {
    const base = {
      original: original(),
      draft: blankGeoDraft(),
      plan: planGeoOperation(blankGeoDraft(), "remove", original()),
      resultStatus: undefined,
      lastOperation: null,
      gpsSupportedFormat: true,
    };
    expect(geoBadgeStatus({ ...base, pendingOp: "remove" })).toBe("removal-pending");
    // Without a confirmed op the badge stays honest about the current state.
    expect(geoBadgeStatus(base)).toBe("gps-detected");
  });

  it("reflects verified writes and removals through the last operation", () => {
    const base = {
      original: original(),
      draft: draft("1", "2"),
      plan: planGeoOperation(draft("1", "2"), "write", original()),
      resultStatus: "verified_rewritten",
      gpsSupportedFormat: true,
    };
    expect(geoBadgeStatus({ ...base, lastOperation: "write" })).toBe("written-verified");
    expect(geoBadgeStatus({ ...base, lastOperation: "remove" })).toBe("removal-verified");
    expect(GEO_BADGE_LABELS["written-verified"].label).toBe("GPS written and verified");
    expect(GEO_BADGE_LABELS["removal-verified"].label).toBe("GPS removal verified");
  });

  it("reports failures and unsupported formats honestly", () => {
    const base = {
      original: original(),
      draft: blankGeoDraft(),
      plan: planGeoOperation(blankGeoDraft(), "write", original()),
      lastOperation: "write" as const,
      gpsSupportedFormat: true,
    };
    expect(geoBadgeStatus({ ...base, resultStatus: "failed" })).toBe("operation-failed");
    expect(geoBadgeStatus({ ...base, resultStatus: "not_verified" })).toBe("operation-failed");
    expect(geoBadgeStatus({ ...base, resultStatus: "unsupported" })).toBe("writing-unsupported");
    expect(GEO_BADGE_LABELS["operation-failed"].tone).toBe("red");
  });
});

describe("bulkGeoSnapshot — explicit selected-file scoping", () => {
  const entries = [
    minimalEntry("a.jpg", 10, "image"),
    minimalEntry("b.png", 10, "image"),
    minimalEntry("c.webp", 10, "image"),
    minimalEntry("clip.mp4", 10, "video"),
  ];

  it("places the editor's own file first, then selected images only", () => {
    const ids = bulkGeoSnapshot(entries[0]!.item.id, [entries[1]!.item.id, entries[2]!.item.id], entries);
    expect(ids).toEqual([
      entries[0]!.item.id,
      entries[1]!.item.id,
      entries[2]!.item.id,
    ]);
  });

  it("never includes unselected or non-image files (explicit snapshot)", () => {
    const ids = bulkGeoSnapshot(entries[0]!.item.id, [entries[1]!.item.id, entries[3]!.item.id], entries);
    expect(ids).toEqual([entries[0]!.item.id, entries[1]!.item.id]);
    // A snapshot taken now is unaffected by later selection changes.
    const frozen = bulkGeoSnapshot(entries[0]!.item.id, [], entries);
    expect(frozen).toEqual([entries[0]!.item.id]);
  });

  it("skips the editor file when it is not an image", () => {
    const video = minimalEntry("clip.mp4", 10, "video");
    const ids = bulkGeoSnapshot(video.item.id, [entries[0]!.item.id], [video, ...entries]);
    expect(ids).toEqual([entries[0]!.item.id]);
  });
});

describe("geoChangeSummary — preview honesty", () => {
  it("describes the original and new locations without inventing altitude", () => {
    const original = originalGpsFromInspection(gpsInspection())!;
    const summary = geoChangeSummary("updated", original, { latitude: 12.345678, longitude: 98.765432, altitude: null });
    expect(summary.originalLine).toContain("-33.868800");
    expect(summary.newLine).toContain("12.345678");
    expect(summary.newLine).not.toContain("alt"); // altitude not requested
  });

  it("shows none-detected originals for additions and removed targets for removals", () => {
    const addition = geoChangeSummary("added", null, { latitude: 1, longitude: 2, altitude: null });
    expect(addition.originalLine).toBe("none detected");
    const original = originalGpsFromInspection(gpsInspection())!;
    const removal = geoChangeSummary("removed", original, null);
    expect(removal.newLine).toBe("removed");
    expect(removal.originalLine).toContain("-33.8688");
  });
});

// ------------------------------------------------------- location card state (Issue 01)

function outputGpsOf(overrides: { latitude?: number; longitude?: number; altitude?: number | null } = {}): NonNullable<GeoCardInput["outputGps"]> {
  return { latitude: overrides.latitude ?? 51.5007, longitude: overrides.longitude ?? -0.1246, altitude: overrides.altitude ?? null };
}

function cardInput(overrides: Partial<GeoCardInput> = {}): GeoCardInput {
  return {
    draft: blankGeoDraft(),
    writePlan: planGeoOperation(blankGeoDraft(), "write", null),
    pendingOp: null,
    removeIntent: false,
    resultStatus: undefined,
    lastOperation: null,
    outputGps: null,
    ...overrides,
  };
}

describe("geoCardState — planned vs applied vs removed (Issue 01)", () => {
  it("state A: an empty draft shows the plain NEW GPS empty state (nothing pending)", () => {
    expect(geoCardState(cardInput())).toEqual({ kind: "none" });
    expect(geoCardState(cardInput({ lastOperation: "write", resultStatus: "verified_rewritten", outputGps: outputGpsOf() }))).toEqual({ kind: "none" });
  });

  it("state B: entered coordinates read as NEW GPS (planned) before applying", () => {
    const pendingDraft = draft("51.5007", "-0.1246", "35");
    const state = geoCardState(cardInput({ draft: pendingDraft, writePlan: planGeoOperation(pendingDraft, "write", null) }));
    expect(state).toEqual({ kind: "planned-write", coords: { latitude: 51.5007, longitude: -0.1246, altitude: 35 } });
  });

  it("state C: a verified write whose draft still matches shows APPLIED (VERIFIED) with the OUTPUT coordinates", () => {
    const pendingDraft = draft("51.5007", "-0.1246", "35");
    const state = geoCardState(cardInput({ draft: pendingDraft,
      writePlan: planGeoOperation(pendingDraft, "write", null),
      resultStatus: "verified_rewritten",
      lastOperation: "write",
      // Output observation differs in the last decimal — the card must show
      // the OUTPUT values, never re-serve the typed inputs as proof.
      outputGps: outputGpsOf({ latitude: 51.50070001, longitude: -0.12460001, altitude: 35.000001 }),
    }));
    expect(state).toEqual({ kind: "applied-verified", coords: { latitude: 51.50070001, longitude: -0.12460001, altitude: 35.000001 } });
  });

  it("state G: editing coordinates after a verified result returns the card to PLANNED", () => {
    const pendingDraft = draft("12.345678", "98.765432");
    const state = geoCardState(cardInput({ draft: pendingDraft,
      writePlan: planGeoOperation(pendingDraft, "write", null),
      resultStatus: "verified_rewritten",
      lastOperation: "write",
      outputGps: outputGpsOf(), // verified output holds the OLD values
    }));
    expect(state).toEqual({ kind: "planned-write", coords: { latitude: 12.345678, longitude: 98.765432, altitude: null } });
  });

  it("state G (badge): a differing draft after verification flips the badge to modified-not-applied", () => {
    const pendingDraft = draft("12.345678", "98.765432");
    const badge = geoBadgeStatus({ original: null,
      draft: pendingDraft,
      plan: planGeoOperation(pendingDraft, "write", null),
      resultStatus: "verified_rewritten",
      lastOperation: "write",
      gpsSupportedFormat: true,
      draftMatchesVerifiedOutput: false,
    });
    expect(badge).toBe("modified-not-applied");
    // …and matching values keep the verified badge honest.
    const same = geoBadgeStatus({
      original: null,
      draft: draft("51.5007", "-0.1246"),
      plan: planGeoOperation(draft("51.5007", "-0.1246"), "write", null),
      resultStatus: "verified_rewritten",
      lastOperation: "write",
      gpsSupportedFormat: true,
      draftMatchesVerifiedOutput: true,
    });
    expect(same).toBe("written-verified");
  });

  it("state D: a requested (confirming or in-flight) removal reads as REMOVAL PLANNED", () => {
    expect(geoCardState(cardInput({ removeIntent: true })).kind).toBe("removal-planned");
    expect(geoCardState(cardInput({ pendingOp: "remove" })).kind).toBe("removal-planned");
  });

  it("state E: verified removal reads as GPS REMOVED (VERIFIED); partial removal never claims complete", () => {
    const full = geoCardState(cardInput({ resultStatus: "verified_rewritten", lastOperation: "remove" }));
    expect(full).toEqual({ kind: "removal-verified", partial: false });
    const partial = geoCardState(cardInput({ resultStatus: "partially_rewritten", lastOperation: "remove" }));
    expect(partial).toEqual({ kind: "removal-verified", partial: true });
    expect(GEO_BADGE_LABELS["removal-partial"].label).toMatch(/partial/i);
  });

  it("state F: failed operations never produce an applied/removed verified card", () => {
    const pendingDraft = draft("51.5007", "-0.1246");
    const failedWrite = geoCardState(cardInput({ draft: pendingDraft,
      writePlan: planGeoOperation(pendingDraft, "write", null),
      resultStatus: "failed",
      lastOperation: "write",
      outputGps: outputGpsOf(),
    }));
    expect(failedWrite.kind).toBe("planned-write"); // still pending, honestly
    const failedRemoval = geoCardState(cardInput({ resultStatus: "failed", lastOperation: "remove", outputGps: outputGpsOf() }));
    expect(failedRemoval).toEqual({ kind: "none" });
    const unverified = geoCardState(cardInput({ resultStatus: "not_verified", lastOperation: "remove" }));
    expect(unverified).toEqual({ kind: "none" });
  });

  it("verified coordinates never come from the draft when the output observation is missing", () => {
    const pendingDraft = draft("51.5007", "-0.1246");
    const state = geoCardState(cardInput({ draft: pendingDraft,
      writePlan: planGeoOperation(pendingDraft, "write", null),
      resultStatus: "verified_rewritten",
      lastOperation: "write",
      outputGps: null, // no detected GPS category in the output inspection
    }));
    expect(state.kind).toBe("planned-write");
  });
});
