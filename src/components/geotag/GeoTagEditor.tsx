"use client";

import { useMemo, useState } from "react";
import type { GpsCoordinates } from "../../lib/metadata/rewrite/gps";
import { formatAltitude, formatCoordinate } from "../../lib/metadata/rewrite/gps";
import type { MetadataChange } from "../../lib/metadata/clean/types";
import {
  blankGeoDraft,
  geoBadgeStatus,
  geoCardState,
  GEO_BADGE_LABELS,
  geoChangeSummary,
  originalGpsFromInspection,
  planGeoOperation,
  type GeoCardState,
  type GeoDraft,
  type GeoOperation,
  type GeoPlan,
} from "../../lib/workspace/geotag-state";
import type { ImageInspectionResult } from "../../types/inspection";
import GeoMapPicker from "./GeoMapPicker";
import GeoLocationSearch from "./GeoLocationSearch";

/**
 * Screen 09 — GeoTag editor (Location tab content of the Screen 06 modal).
 *
 * Every actionable control maps to the verified GPS engine: the preview is
 * the real write plan, statuses reflect actual application state, and
 * nothing claims "verified" before the produced output was re-inspected.
 * The second location card distinguishes planned drafts from coordinates
 * observed in the verified output (`geoCardState`); guests use everything
 * here without signing in; the map and location search are strictly opt-in.
 */

export interface GeoTagEditorProps {
  fileId: string;
  fileName: string;
  formatLabel: string;
  sizeLabel: string;
  isImage: boolean;
  gpsSupportedFormat: boolean;
  inspection: ImageInspectionResult | undefined;
  draft: GeoDraft;
  resultStatus: string | undefined;
  gpsChanges: MetadataChange[];
  lastOperation: "write" | "remove" | null;
  busy: boolean;
  /** Selected IMAGE ids (queue selection snapshot the bulk apply would use). */
  selectedCount: number;
  /** GPS operation currently in flight, owned by the page runner. */
  pendingOp: "write" | "remove" | null;
  /** The verified rewrite result's re-inspected OUTPUT image — the only
   *  source for "applied/verified" coordinates (never the draft inputs). */
  resultAfter: ImageInspectionResult | undefined;
  /** Whether the shared footer Apply & create clean copy is currently
   *  enabled (standard metadata fields present). Drives the footer note. */
  sharedApplyAvailable: boolean;
  onDraftChange: (draft: GeoDraft) => void;
  /** Single-image apply (this file only). */
  onApply: (operation: GeoOperation, coords: GpsCoordinates | null) => void;
  /** Bulk apply to the explicit selected-file snapshot (page takes it). */
  onApplyBulk: (operation: GeoOperation, coords: GpsCoordinates | null) => void;
  /** Screen-announcement hook (aria-live region owned by the page). */
  onAnnounce: (message: string) => void;
}

const TONE_CLASSES: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-800",
  slate: "bg-slate-100 text-slate-600",
  blue: "bg-blue-50 text-blue-700",
  amber: "bg-amber-50 text-amber-800",
  red: "bg-red-50 text-red-700",
};

/** Neutral plan: nothing requested yet (original state is shown instead). */
const NO_PLAN: GeoPlan = {
  directive: null,
  coords: null,
  errors: {},
  blockedReason: null,
  action: "none",
};

export default function GeoTagEditor({
  fileId,
  fileName,
  formatLabel,
  sizeLabel,
  isImage,
  gpsSupportedFormat,
  inspection,
  draft,
  resultStatus,
  gpsChanges,
  lastOperation,
  busy,
  selectedCount,
  pendingOp,
  resultAfter,
  sharedApplyAvailable,
  onDraftChange,
  onApply,
  onApplyBulk,
  onAnnounce,
}: GeoTagEditorProps) {
  const [confirmSingle, setConfirmSingle] = useState<"write" | "remove" | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [geoPermissionNote, setGeoPermissionNote] = useState<string | null>(null);

  const original = useMemo(() => originalGpsFromInspection(inspection), [inspection]);
  const writePlan = useMemo(() => planGeoOperation(draft, "write", original), [draft, original]);
  const removePlan = useMemo(() => planGeoOperation(draft, "remove", original), [draft, original]);
  /**
   * Coordinates independently observed in the verified output inspection —
   * the only source for "applied/verified" display (Issue 01 State C: the
   * draft's own values are never proof).
   */
  const outputGps = useMemo(() => {
    const observed = originalGpsFromInspection(resultAfter);
    if (!observed || observed.status !== "detected") return null;
    return { latitude: observed.latitude, longitude: observed.longitude, altitude: observed.altitude };
  }, [resultAfter]);
  /**
   * Which state the second location card describes: planned draft, applied-
   * and-verified output values, removal pending/verified, or empty. The
   * preview surfaces only exist for pending operations.
   */
  const card: GeoCardState = geoCardState({
    draft,
    writePlan,
    pendingOp,
    removeIntent: confirmSingle === "remove",
    resultStatus,
    lastOperation,
    outputGps,
  });
  const plan: GeoPlan = card.kind === "planned-write"
    ? writePlan
    : card.kind === "removal-planned"
      ? removePlan
      : NO_PLAN;
  const badge = geoBadgeStatus({
    original,
    draft,
    plan: pendingOp === "remove" ? removePlan : writePlan.directive ? writePlan : NO_PLAN,
    resultStatus,
    lastOperation,
    gpsSupportedFormat,
    pendingOp,
    draftMatchesVerifiedOutput: card.kind === "applied-verified" || card.kind === "removal-verified",
  });
  const badgeInfo = GEO_BADGE_LABELS[badge];
  const changeSummary = geoChangeSummary(plan.action, original, plan.coords);

  const setField = (field: keyof GeoDraft, value: string) => {
    onDraftChange({ ...draft, [field]: value });
  };

  const applyToInputs = (latitude: number, longitude: number) => {
    onDraftChange({ latitude: formatCoordinate(latitude, "lat"), longitude: formatCoordinate(longitude, "lon"), altitude: draft.altitude });
  };

  const handleUseMyLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoPermissionNote("This browser cannot provide a current location. Manual coordinates and the map remain available.");
      return;
    }
    setGeoPermissionNote("Asking the browser for permission — your location is used only to fill the fields below and is never stored or uploaded.");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        applyToInputs(latitude, longitude);
        setGeoPermissionNote("Current location copied into the coordinate fields. It is never sent to Firebase or written without Apply.");
        onAnnounce("Current location copied into the coordinate fields.");
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setGeoPermissionNote("Permission denied — no location was taken. Manual editing and the optional map keep working.");
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          setGeoPermissionNote("Location unavailable on this device. Manual coordinates remain available.");
        } else {
          setGeoPermissionNote("The location request timed out. Manual coordinates remain available.");
        }
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 },
    );
  };

  const disabled = !isImage || busy;
  /** The primary Apply exists only for a PENDING draft — values already
   *  verified in the output never need a second Apply (Issue 01 State C). */
  const applyReady = isImage && !busy && card.kind === "planned-write";
  /** No duplicate removal once the output's verified absence is recorded. */
  const removeReady = isImage && !busy && removePlan.directive !== null && card.kind !== "removal-verified";
  /** Bulk targets the other selected images, so it stays useful even when
   *  this file's values are already applied and verified. */
  const bulkReady = isImage && !busy && writePlan.directive !== null && selectedCount > 1 && gpsSupportedFormat;

  if (!isImage) {
    return (
      <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-[12px] font-medium text-amber-900" data-testid="geotag-unsupported-file">
        GPS editing is available for still images only — this file is preview-only.
      </p>
    );
  }

  return (
    <div className="grid gap-3" data-testid="geotag-editor">
      {/* Status + file identity */}
      <div className="rounded-2xl border border-[#e6ebf3] bg-white p-3" data-testid="geotag-status-card">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13px] font-extrabold text-[#16244a]">GPS metadata status</p>
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-bold ${TONE_CLASSES[badgeInfo.tone]}`} data-testid="geotag-status-badge">
            {badgeInfo.label}
          </span>
        </div>
        <p className="mt-1 text-[11px] font-semibold text-[#5a6b85]" data-testid="geotag-file-identity">
          {fileName} · {formatLabel} · {sizeLabel} · GPS writing{" "}
          {gpsSupportedFormat ? "supported for this format" : "not supported for this format (still honest: the engine will refuse and disclose)"}
        </p>
        {gpsChanges.length > 0 ? (
          <ul className="mt-2 grid gap-1" data-testid="geotag-evidence">
            {gpsChanges.slice(0, 4).map((change, index) => (
              <li key={`${change.key}:${index}`} className="rounded-lg bg-[#f7f9fd] px-2.5 py-1.5 text-[10.5px] leading-4 text-[#3b4a66]">
                <strong className="text-[#16244a]">{change.verification}</strong> — {change.reason}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* ORIGINAL vs NEW */}
      <div className="grid gap-3 md:grid-cols-2" data-testid="geotag-coordinates">
        <div className="rounded-2xl border border-[#e6ebf3] bg-[#fbfcfe] p-3" data-testid="geotag-original">
          <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#5a6b85]">Original GPS</p>
          {original && original.status === "detected" ? (
            <dl className="mt-1.5 grid gap-1 text-[11.5px]">
              <div className="flex justify-between gap-2"><dt className="text-slate-500">Latitude</dt><dd className="font-semibold text-[#16244a] tabular-nums">{formatCoordinate(original.latitude, "lat")} ({original.latRef ?? "N"})</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-slate-500">Longitude</dt><dd className="font-semibold text-[#16244a] tabular-nums">{formatCoordinate(original.longitude, "lon")} ({original.lonRef ?? "E"})</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-slate-500">Altitude</dt><dd className="font-semibold text-[#16244a] tabular-nums">{original.altitude !== null ? `${formatAltitude(original.altitude)} m` : "—"}</dd></div>
            </dl>
          ) : original && original.status === "uncertain" ? (
            <p className="mt-1.5 text-[11.5px] text-amber-800">GPS tags are present but unreadable — shown as uncertain, never invented.</p>
          ) : (
            <p className="mt-1.5 text-[11.5px] text-slate-500" data-testid="geotag-original-none">No GPS coordinates were found in this image.</p>
          )}
        </div>
        <div className={`rounded-2xl border p-3 ${
          card.kind === "planned-write" || card.kind === "removal-planned"
            ? "border-[#c7d7f8] bg-[#eef4ff]"
            : card.kind === "applied-verified" || card.kind === "removal-verified"
              ? "border-[#b7e4d0] bg-[#edfaf4]"
              : "border-[#e6ebf3] bg-white"
        }`} data-testid="geotag-new">
          {card.kind === "planned-write" ? (
            <>
              <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#5a6b85]" data-testid="geotag-new-heading">New GPS (planned)</p>
              <dl className="mt-1.5 grid gap-1 text-[11.5px]" data-testid="geotag-new-planned">
                <div className="flex justify-between gap-2"><dt className="text-slate-500">Latitude</dt><dd className="font-semibold text-[#16244a] tabular-nums">{formatCoordinate(card.coords.latitude, "lat")}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-slate-500">Longitude</dt><dd className="font-semibold text-[#16244a] tabular-nums">{formatCoordinate(card.coords.longitude, "lon")}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-slate-500">Altitude</dt><dd className="font-semibold text-[#16244a] tabular-nums">{card.coords.altitude !== null ? `${formatAltitude(card.coords.altitude)} m` : "unchanged (not requested)"}</dd></div>
              </dl>
            </>
          ) : card.kind === "applied-verified" ? (
            <>
              <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#0b6b4f]" data-testid="geotag-new-heading">Applied GPS (verified)</p>
              <dl className="mt-1.5 grid gap-1 text-[11.5px]" data-testid="geotag-new-applied">
                <div className="flex justify-between gap-2"><dt className="text-slate-500">Latitude</dt><dd className="font-semibold text-[#16244a] tabular-nums">{formatCoordinate(card.coords.latitude, "lat")}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-slate-500">Longitude</dt><dd className="font-semibold text-[#16244a] tabular-nums">{formatCoordinate(card.coords.longitude, "lon")}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-slate-500">Altitude</dt><dd className="font-semibold text-[#16244a] tabular-nums">{card.coords.altitude !== null ? `${formatAltitude(card.coords.altitude)} m` : "—"}</dd></div>
              </dl>
              <p className="mt-1 text-[10.5px] leading-3.5 text-[#3b6b57]" data-testid="geotag-new-applied-source">
                Re-read from the verified output image — observed in the produced bytes, not the typed values.
              </p>
            </>
          ) : card.kind === "removal-planned" ? (
            <>
              <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#5a6b85]" data-testid="geotag-new-heading">New GPS (removal planned)</p>
              <p className="mt-1.5 text-[11.5px] font-semibold text-[#16244a]" data-testid="geotag-new-removal-planned">
                GPS removal is pending — applying creates a verified copy without the supported coordinate metadata (EXIF GPS IFD + standard XMP mirrors).
              </p>
            </>
          ) : card.kind === "removal-verified" ? (
            <>
              <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#0b6b4f]" data-testid="geotag-new-heading">
                {card.partial ? "GPS removed (partial)" : "GPS removed (verified)"}
              </p>
              <p className="mt-1.5 text-[11.5px] font-semibold text-[#16244a]" data-testid="geotag-new-removal-verified">
                {card.partial
                  ? "EXIF GPS is gone from the verified output, but coordinate-bearing metadata remains — see the retained evidence below. Complete removal is not claimed."
                  : "No GPS coordinates remain in the verified output — re-observed from the produced bytes."}
              </p>
            </>
          ) : (
            <>
              <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#5a6b85]" data-testid="geotag-new-heading">New GPS</p>
              <p className="mt-1.5 text-[11.5px] text-slate-400" data-testid="geotag-new-none">Enter coordinates below to plan a change.</p>
            </>
          )}
        </div>
      </div>

      {/* Coordinate form */}
      <fieldset className="rounded-2xl border border-[#e6ebf3] bg-white p-3" data-testid="geotag-form">
        <legend className="px-1 text-[12.5px] font-extrabold text-[#16244a]">Coordinates (decimal degrees)</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <CoordinateField
            id="geotag-latitude"
            label="Latitude"
            hint="−90 … +90 (S is negative)"
            value={draft.latitude}
            error={writePlan.errors.latitude ?? null}
            disabled={disabled}
            onChange={(value) => setField("latitude", value)}
            placeholder="-34.6037"
            testId="geotag-input-latitude"
          />
          <CoordinateField
            id="geotag-longitude"
            label="Longitude"
            hint="−180 … +180 (W is negative)"
            value={draft.longitude}
            error={writePlan.errors.longitude ?? null}
            disabled={disabled}
            onChange={(value) => setField("longitude", value)}
            placeholder="-58.3816"
            testId="geotag-input-longitude"
          />
          <CoordinateField
            id="geotag-altitude"
            label="Altitude (m, optional)"
            hint="Meters; below sea level is negative"
            value={draft.altitude}
            error={writePlan.errors.altitude ?? null}
            disabled={disabled}
            onChange={(value) => setField("altitude", value)}
            placeholder="150"
            testId="geotag-input-altitude"
          />
        </div>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="geotag-use-original"
            disabled={disabled || !original || original.status !== "detected"}
            onClick={() => {
              if (!original) return;
              onDraftChange({
                latitude: formatCoordinate(original.latitude, "lat"),
                longitude: formatCoordinate(original.longitude, "lon"),
                altitude: original.altitude !== null ? formatAltitude(original.altitude) : "",
              });
              onAnnounce("Original coordinates copied into the form.");
            }}
            className="btn-secondary !min-h-8 !px-2.5 text-[11px]"
          >
            Use original coordinates
          </button>
          <button
            type="button"
            data-testid="geotag-use-my-location"
            disabled={disabled}
            onClick={handleUseMyLocation}
            className="btn-secondary !min-h-8 !px-2.5 text-[11px]"
          >
            Use my current location
          </button>
          <button
            type="button"
            data-testid="geotag-clear-draft"
            disabled={disabled || !geoDraftHas(draft)}
            onClick={() => { onDraftChange(blankGeoDraft()); onAnnounce("Coordinate draft cleared."); }}
            className="btn-secondary !min-h-8 !px-2.5 text-[11px]"
          >
            Clear fields
          </button>
        </div>
        {geoPermissionNote ? <p className="mt-1.5 text-[11px] font-medium text-[#375a37]" role="status" data-testid="geotag-geolocation-note">{geoPermissionNote}</p> : null}
      </fieldset>

      {/* Optional online map (consent-gated) + search */}
      <GeoMapPicker
        key={fileId}
        latitude={plan.coords?.latitude
          ?? (card.kind === "applied-verified"
            ? card.coords.latitude
            : original && original.status === "detected" ? original.latitude : null)}
        longitude={plan.coords?.longitude
          ?? (card.kind === "applied-verified"
            ? card.coords.longitude
            : original && original.status === "detected" ? original.longitude : null)}
        onPick={(latitude, longitude) => applyToInputs(latitude, longitude)}
        onCenterOriginal={original && original.status === "detected" ? () => {
          applyToInputs(original.latitude, original.longitude);
        } : null}
      />
      <GeoLocationSearch
        onPick={(result) => {
          applyToInputs(result.latitude, result.longitude);
          onAnnounce(`Map and fields moved to ${result.label}.`);
        }}
      />

      {/* Preview changes (real plan; not a verified write) */}
      {plan.directive ? (
        <div className="rounded-2xl border border-[#dbe7f8] bg-[#eef4ff] p-3.5" data-testid="geotag-preview" role="region" aria-label="Planned GPS changes preview">
          <p className="text-[12.5px] font-extrabold text-[#16244a]">Preview changes — {fileName}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl bg-white p-2.5 text-[11.5px]" data-testid="geotag-preview-original">
              <p className="text-[10.5px] font-bold uppercase tracking-wide text-[#5a6b85]">Original location</p>
              <p className="mt-0.5 break-all text-[#3b4a66]">{changeSummary.originalLine}</p>
            </div>
            <div className="rounded-xl bg-white p-2.5 text-[11.5px]" data-testid="geotag-preview-new">
              <p className="text-[10.5px] font-bold uppercase tracking-wide text-[#5a6b85]">New location</p>
              <p className="mt-0.5 break-all font-semibold text-[#16244a]">{changeSummary.newLine}</p>
            </div>
          </div>
          <ul className="mt-2 grid gap-1 text-[11px] leading-4 text-[#3b4a66]" data-testid="geotag-preview-notes">
            <li className="rounded-xl bg-white p-2.5">
              <strong className="text-[#16244a]">Change:</strong>{" "}
              {plan.action === "added" ? "GPS coordinates added to this image." : plan.action === "updated" ? "GPS coordinates replaced with the planned values." : plan.action === "removed" ? "GPS coordinates removed (supported containers)." : "No GPS change requested."}
              {" "}Output keeps the original {formatLabel} format and encoded pixels; this preview is the real write plan, not proof of writing — the output is re-inspected after Apply.
            </li>
            <li className="rounded-xl bg-white p-2.5" data-testid="geotag-preview-mode-note">
              <strong className="text-[#16244a]">Rewrite mode:</strong> the mode selected on the Advanced tab still governs the run. Replace mode strips removable non-technical metadata first, then writes GPS; Update mode edits coordinates only and may retain unrelated metadata (disclosed in the result).
            </li>
            <li className="rounded-xl bg-white p-2.5">
              <strong className="text-[#16244a]">C2PA / provenance:</strong> if this image carries signed Content Credentials, editing bytes can invalidate the signature; the result reports the re-validated state honestly and manifests are never forged.
            </li>
          </ul>
        </div>
      ) : null}

      {/* Apply actions */}
      <div className="grid gap-2" data-testid="geotag-actions">
        <div className="flex flex-wrap items-center gap-2">
          {card.kind === "planned-write" ? (
            confirmSingle === "write" ? (
              <>
                <button
                  type="button"
                  data-testid="geotag-apply-confirm"
                  disabled={disabled || !applyReady}
                  onClick={() => {
                    setConfirmSingle(null);
                    onApply("write", writePlan.coords);
                  }}
                  className="btn-primary !min-h-9 !px-3 text-[12px]"
                >
                  {busy ? "Applying…" : "Confirm: write GPS to this image"}
                </button>
                <button type="button" data-testid="geotag-apply-cancel" onClick={() => setConfirmSingle(null)} className="btn-secondary !min-h-9 !px-3 text-[12px]">Cancel</button>
              </>
            ) : (
              <button
                type="button"
                data-testid="geotag-apply"
                disabled={!applyReady}
                onClick={() => setConfirmSingle("write")}
                className="btn-primary !min-h-9 !px-3 text-[12px]"
              >
                Apply GPS to this image
              </button>
            )
          ) : null}
          {card.kind === "removal-verified" ? null : confirmSingle === "remove" ? (
            <>
              <button
                type="button"
                data-testid="geotag-remove-confirm"
                disabled={disabled || !removeReady}
                onClick={() => {
                  setConfirmSingle(null);
                  onApply("remove", null);
                }}
                className="btn-primary !min-h-9 !px-3 text-[12px]"
              >
                {busy ? "Removing…" : "Confirm: remove GPS from this image"}
              </button>
              <button type="button" data-testid="geotag-remove-cancel" onClick={() => setConfirmSingle(null)} className="btn-secondary !min-h-9 !px-3 text-[12px]">Cancel</button>
            </>
          ) : (
            <button
              type="button"
              data-testid="geotag-remove"
              disabled={disabled || !removeReady}
              onClick={() => setConfirmSingle("remove")}
              className="btn-secondary !min-h-9 !px-3 text-[12px]"
              title="Removes supported GPS metadata only — 'Remove Metadata' is the separate full-cleaning action."
            >
              Remove GPS location
            </button>
          )}
          {writePlan.blockedReason && card.kind === "planned-write" ? <p className="text-[11px] font-semibold text-amber-800" role="status" data-testid="geotag-blocked">{writePlan.blockedReason}</p> : null}
        </div>

        {/* Issue 02 guidance: which Apply saves GPS changes, and why the
            shared footer button can stay disabled during GPS-only editing. */}
        {card.kind === "planned-write" ? (
          <>
            <p className="text-[11px] font-medium leading-4 text-[#5a6b85]" data-testid="geotag-apply-guidance">
              To save your GPS changes, select Apply GPS to this image. A separate copy will be created and verified before download.
            </p>
            {!sharedApplyAvailable ? (
              <p className="text-[10.5px] leading-4 text-slate-400" data-testid="geotag-footer-note">
                GPS changes use the Apply GPS to this image button above.
              </p>
            ) : null}
          </>
        ) : null}

        {/* Bulk geotagging via the existing queue selection */}
        {writePlan.directive ? (
          confirmBulk ? (
            <div className="rounded-2xl border border-[#c7d7f8] bg-[#eef4ff] p-3" data-testid="geotag-bulk-confirm">
              <p className="text-[12px] font-extrabold text-[#16244a]">
                Apply this location to {selectedCount} selected image{selectedCount === 1 ? "" : "s"}?
              </p>
              <p className="mt-1 text-[11px] leading-4 text-[#3b4a66]" data-testid="geotag-bulk-scope">
                Scope snapshot taken now: the current file plus every still-queued selected image. Unselected files stay untouched, each output is verified independently, and failures never block the successful files.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  data-testid="geotag-bulk-confirm-button"
                  disabled={disabled || !bulkReady}
                  onClick={() => {
                    setConfirmBulk(false);
                    onApplyBulk("write", writePlan.coords);
                  }}
                  className="btn-primary !min-h-9 !px-3 text-[12px]"
                >
                  {busy ? "Applying…" : `Confirm bulk GPS apply (${selectedCount})`}
                </button>
                <button type="button" data-testid="geotag-bulk-cancel" onClick={() => setConfirmBulk(false)} className="btn-secondary !min-h-9 !px-3 text-[12px]">Cancel</button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              data-testid="geotag-bulk"
              disabled={!bulkReady}
              onClick={() => setConfirmBulk(true)}
              className="btn-secondary !min-h-9 self-start !px-3 text-[12px]"
              title={selectedCount > 1 ? "Apply these coordinates to every selected image" : "Select more images in the queue to enable bulk geotagging"}
            >
              Apply this location to selected images ({selectedCount})
            </button>
          )
        ) : null}
        {!gpsSupportedFormat && writePlan.directive ? (
          <p className="text-[11px] font-semibold text-red-700" role="status" data-testid="geotag-format-unsupported">
            GPS writing is not supported for this file layout — the engine will refuse and disclose it rather than pretending success.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function geoDraftHas(draft: GeoDraft): boolean {
  return draft.latitude.trim() !== "" || draft.longitude.trim() !== "" || draft.altitude.trim() !== "";
}

function CoordinateField({
  id,
  label,
  hint,
  value,
  error,
  disabled,
  onChange,
  placeholder,
  testId,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  error: string | null;
  disabled: boolean;
  onChange: (value: string) => void;
  placeholder: string;
  testId: string;
}) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div data-testid={`geotag-field-${id}`}>
      <label htmlFor={id} className="text-[12px] font-extrabold text-[#16244a]">{label}</label>
      <p id={hintId} className="mt-0.5 text-[10.5px] font-medium text-[#5a6b85]">{hint}</p>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        aria-describedby={`${hintId}${error ? ` ${errorId}` : ""}`}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
        data-testid={testId}
        className={`mt-1 w-full rounded-xl border px-3 py-2 text-[13px] text-[#16244a] outline-offset-2 focus-visible:outline-3 focus-visible:outline-[#2d5be9] ${
          error ? "border-red-300 bg-red-50/40" : "border-[#c9d5e8] bg-white"
        } disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400`}
      />
      {error ? (
        <p id={errorId} className="mt-1 text-[11px] font-semibold text-red-700" role="status" data-testid={`${testId}-error`}>{error}</p>
      ) : null}
    </div>
  );
}
