import type { ImageInspectionResult } from "../../types/inspection";
import type { QueueEntry } from "../../types/media";
import type { GpsCoordinates, GpsEngineDirective, GpsFieldError } from "../metadata/rewrite/gps";
import {
  GPS_VERIFY_TOLERANCE_DEGREES,
  GPS_VERIFY_TOLERANCE_METERS,
  proposeCoordinates,
} from "../metadata/rewrite/gps";

/**
 * Screen 09 GeoTag state — pure planning layer (mirror of editor-state.ts
 * discipline). The modal UI and the page handlers both consume these
 * functions so draft isolation, operation planning and bulk snapshot
 * scoping are testable without a browser.
 *
 * Non-negotiable rules encoded here:
 * - Drafts are keyed by the queue's stable per-file id; switching files can
 *   never transfer one image's coordinates to another.
 * - Coordinates are never invented: an original without GPS stays "none".
 * - Bulk operations use an explicit snapshot of selected file ids, taken at
 *   confirm time — later queue changes cannot silently join or leave.
 */

export interface GeoDraft {
  latitude: string;
  longitude: string;
  altitude: string;
}

export function blankGeoDraft(): GeoDraft {
  return { latitude: "", longitude: "", altitude: "" };
}

export function geoDraftHasValues(draft: GeoDraft): boolean {
  return draft.latitude.trim() !== "" || draft.longitude.trim() !== "" || draft.altitude.trim() !== "";
}

export interface OriginalGps {
  latitude: number;
  longitude: number;
  altitude: number | null;
  latRef: string | null;
  lonRef: string | null;
  /** Inspector GPS category status: detected / uncertain / not_detected / … */
  status: string;
}

function tagValue(result: ImageInspectionResult | undefined, key: string): string {
  return result?.categories.find((category) => category.category === "GPS")?.tags.find((tag) => tag.key === key)?.displayedValue ?? "";
}

/** Honest read of the ORIGINAL inspection's GPS category — never invented. */
export function originalGpsFromInspection(result: ImageInspectionResult | undefined): OriginalGps | null {
  const category = result?.categories.find((item) => item.category === "GPS");
  if (!category) return null;
  if (category.status !== "detected" && category.status !== "uncertain") return null;
  const latText = tagValue(result, "Latitude");
  const lonText = tagValue(result, "Longitude");
  const lat = Number.parseFloat(latText);
  const lon = Number.parseFloat(lonText);
  if (category.status !== "detected" || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { latitude: Number.isFinite(lat) ? lat : 0, longitude: Number.isFinite(lon) ? lon : 0, altitude: null, latRef: tagValue(result, "LatitudeRef") || null, lonRef: tagValue(result, "LongitudeRef") || null, status: category.status };
  }
  const altText = tagValue(result, "Altitude");
  const alt = altText === "" ? null : Number.parseFloat(altText.replace(/\s*m$/, ""));
  return {
    latitude: lat,
    longitude: lon,
    altitude: alt !== null && Number.isFinite(alt) ? alt : null,
    latRef: tagValue(result, "LatitudeRef") || null,
    lonRef: tagValue(result, "LongitudeRef") || null,
    status: category.status,
  };
}

export type GeoOperation = "write" | "remove";

export type GeoBadgeStatus =
  | "gps-detected"
  | "no-gps"
  | "modified-not-applied"
  | "removal-pending"
  | "written-verified"
  | "removal-verified"
  | "removal-partial"
  | "operation-failed"
  | "writing-unsupported";

export interface GeoPlan {
  /** A ready directive; null means "nothing valid to apply yet". */
  directive: GpsEngineDirective | null;
  coords: GpsCoordinates | null;
  errors: Partial<Record<keyof GeoDraft, GpsFieldError>>;
  blockedReason: string | null;
  /** Honest change classification for the preview (real plan, not prose). */
  action: "added" | "updated" | "removed" | "none";
}

/** Plan the operation exactly as the engine will receive it. */
export function planGeoOperation(
  draft: GeoDraft,
  operation: GeoOperation,
  original: OriginalGps | null,
): GeoPlan {
  if (operation === "remove") {
    if (!original || original.status !== "detected") {
      return {
        directive: null,
        coords: null,
        errors: {},
        blockedReason: "No GPS coordinates were found in this image — there is nothing to remove.",
        action: "none",
      };
    }
    return {
      directive: { op: "remove" },
      coords: null,
      errors: {},
      blockedReason: null,
      action: "removed",
    };
  }

  const proposal = proposeCoordinates(draft);
  if (!proposal.ok || !proposal.coords) {
    return {
      directive: null,
      coords: null,
      errors: proposal.errors,
      blockedReason: Object.keys(proposal.errors).length > 0 ? "Fix the highlighted coordinate errors first." : "Enter a latitude and a longitude to apply GPS metadata.",
      action: "none",
    };
  }
  const action: "added" | "updated" = original && original.status === "detected" ? "updated" : "added";
  return {
    directive: { op: "write", coords: proposal.coords },
    coords: proposal.coords,
    errors: {},
    blockedReason: null,
    action,
  };
}

/** Status badge reflecting REAL state only (never a fabricated success). */
export function geoBadgeStatus(input: {
  original: OriginalGps | null;
  draft: GeoDraft;
  plan: GeoPlan;
  resultStatus: string | undefined;
  lastOperation: "write" | "remove" | null;
  gpsSupportedFormat: boolean;
  /** Operation actually in flight (confirmed, result not landed yet). */
  pendingOp?: "write" | "remove" | null;
  /** True when a verified result stands and the draft neither modifies nor
   *  re-enters those values (drives the pending-vs-verified distinction). */
  draftMatchesVerifiedOutput?: boolean;
}): GeoBadgeStatus {
  if (input.pendingOp === "remove") return "removal-pending";
  if (input.resultStatus === "unsupported") return "writing-unsupported";
  if (input.resultStatus === "verified_rewritten" || input.resultStatus === "partially_rewritten") {
    if (input.lastOperation === "write") {
      // A pending draft that differs from the verified output is exactly
      // that — pending — even though an earlier verified output exists.
      if (input.plan.directive?.op === "write" && input.draftMatchesVerifiedOutput === false) {
        return "modified-not-applied";
      }
      return "written-verified";
    }
    if (input.lastOperation === "remove") {
      return input.resultStatus === "partially_rewritten" ? "removal-partial" : "removal-verified";
    }
  }
  if (input.resultStatus === "failed" || input.resultStatus === "not_verified") return "operation-failed";
  // A *planned* removal alone does not change the badge: nothing has
  // happened yet, so the honest state is still what the file contains.
  // "GPS removed — pending verification" is reserved for a confirmed
  // in-flight removal (pendingOp).
  if (input.plan.directive?.op === "write") return "modified-not-applied";
  if (!input.original || input.original.status !== "detected") return "no-gps";
  return "gps-detected";
}

export const GEO_BADGE_LABELS: Record<GeoBadgeStatus, { label: string; tone: "green" | "slate" | "blue" | "amber" | "red" }> = {
  "gps-detected": { label: "GPS detected", tone: "green" },
  "no-gps": { label: "No GPS coordinates", tone: "slate" },
  "modified-not-applied": { label: "Coordinates modified — not yet applied", tone: "blue" },
  "removal-pending": { label: "GPS removed — pending verification", tone: "blue" },
  "written-verified": { label: "GPS written and verified", tone: "green" },
  "removal-verified": { label: "GPS removal verified", tone: "green" },
  "removal-partial": { label: "GPS removal partial — location evidence remains", tone: "amber" },
  "operation-failed": { label: "GPS operation failed", tone: "red" },
  "writing-unsupported": { label: "GPS writing unsupported for this file", tone: "red" },
};

// ------------------------------------------------------------ location card state

/**
 * Which state the NEW/second location card describes (Issue 01). The card
 * must never describe verified values as planned, nor a pending draft as
 * verified. Verified coordinates always come from the OUTPUT inspection —
 * the draft's own values are never proof.
 *
 * - `none` — nothing requested; empty-state message.
 * - `planned-write` — a valid draft awaits Apply (including a draft edited
 *   after an earlier verified run: the new values are pending again).
 * - `applied-verified` — the draft matches coordinates independently
 *   observed in the verified output; no second Apply is needed.
 * - `removal-planned` — removal requested/confirming, not yet verified.
 * - `removal-verified` — output re-inspection confirmed the removal
 *   (`partial: true` when coordinate evidence remains — never claimed complete).
 */
export type GeoCardState =
  | { kind: "none" }
  | { kind: "planned-write"; coords: GpsCoordinates }
  | { kind: "applied-verified"; coords: GpsCoordinates }
  | { kind: "removal-planned" }
  | { kind: "removal-verified"; partial: boolean };

export interface GeoCardInput {
  draft: GeoDraft;
  /** Plan for the pending write draft (directive null when not valid/empty). */
  writePlan: GeoPlan;
  /** GPS operation currently in flight (page-owned). */
  pendingOp: "write" | "remove" | null;
  /** The user opened the removal confirm step. */
  removeIntent: boolean;
  resultStatus: string | undefined;
  lastOperation: "write" | "remove" | null;
  /** GPS independently observed in the verified output inspection
   *  (null when the output has no detected GPS category). */
  outputGps: { latitude: number; longitude: number; altitude: number | null } | null;
}

function draftMatchesObserved(draft: GeoDraft, coords: GpsCoordinates, observed: { latitude: number; longitude: number; altitude: number | null }): boolean {
  if (Math.abs(observed.latitude - coords.latitude) > GPS_VERIFY_TOLERANCE_DEGREES) return false;
  if (Math.abs(observed.longitude - coords.longitude) > GPS_VERIFY_TOLERANCE_DEGREES) return false;
  // Altitude only counts as a difference when the user actually requested one.
  if (coords.altitude !== null) {
    if (observed.altitude === null || Math.abs(observed.altitude - coords.altitude) > GPS_VERIFY_TOLERANCE_METERS) return false;
  }
  void draft;
  return true;
}

export function geoCardState(input: GeoCardInput): GeoCardState {
  const verified = input.resultStatus === "verified_rewritten" || input.resultStatus === "partially_rewritten";
  const partial = input.resultStatus === "partially_rewritten";

  // Removal requested (confirm step or in flight) always reads as pending.
  if (input.pendingOp === "remove" || input.removeIntent) {
    return { kind: "removal-planned" };
  }

  // A valid write draft is pending — unless it exactly restates the values
  // independently observed in the verified output of the last write run.
  if (input.writePlan.directive?.op === "write" && input.writePlan.coords) {
    const verifiedWrite = verified && input.lastOperation === "write";
    const matches = verifiedWrite
      && input.outputGps !== null
      && draftMatchesObserved(input.draft, input.writePlan.coords, input.outputGps);
    if (verifiedWrite && matches && input.outputGps) {
      return { kind: "applied-verified", coords: input.outputGps };
    }
    return { kind: "planned-write", coords: input.writePlan.coords };
  }

  // Verified removal (with no pending write draft on top of it).
  if (verified && input.lastOperation === "remove") {
    return { kind: "removal-verified", partial };
  }

  return { kind: "none" };
}

/**
 * The explicit snapshot for a bulk geotag: the editor's own file first,
 * then every still-queued selected IMAGE — computed once at confirm time.
 */
export function bulkGeoSnapshot(
  editorId: string,
  selection: readonly string[],
  entries: readonly QueueEntry[],
): string[] {
  const selectedSet = new Set(selection);
  const ids: string[] = [];
  const editorEntry = entries.find((entry) => entry.item.id === editorId);
  if (editorEntry && editorEntry.item.detected.mediaKind === "image") ids.push(editorId);
  for (const entry of entries) {
    if (entry.item.detected.mediaKind !== "image") continue;
    if (entry.item.id === editorId) continue;
    if (!selectedSet.has(entry.item.id)) continue;
    ids.push(entry.item.id);
  }
  return ids;
}

/** Coordinate change summary for the preview cards (original vs proposed). */
export function geoChangeSummary(
  action: GeoPlan["action"],
  original: OriginalGps | null,
  coords: GpsCoordinates | null,
): { originalLine: string; newLine: string } {
  if (action === "removed") {
    const originalLine = original && original.status === "detected"
      ? `${original.latitude.toFixed(6)}, ${original.longitude.toFixed(6)}${original.altitude !== null ? ` · alt ${original.altitude} m` : ""}`
      : "none detected";
    return { originalLine, newLine: "removed" };
  }
  if (action === "none" || !coords) return { originalLine: "none detected", newLine: "—" };
  const originalLine = original && original.status === "detected"
    ? `${original.latitude.toFixed(6)}, ${original.longitude.toFixed(6)}${original.altitude !== null ? ` · alt ${original.altitude} m` : ""}`
    : "none detected";
  const newLine = `${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}${coords.altitude !== null ? ` · alt ${coords.altitude} m` : ""}`;
  return { originalLine, newLine };
}
