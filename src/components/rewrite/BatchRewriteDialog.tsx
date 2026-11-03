"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { MetadataProfile, ProfileField } from "../../lib/metadata/rewrite/fields";
import { PROFILE_FIELDS } from "../../lib/metadata/rewrite/fields";
import { editorFieldLabel, type EditorDraft } from "../../lib/workspace/editor-state";
import type { ProjectRecord } from "../../lib/projects/project-schema";
import { projectToProfile } from "../../lib/projects/project-schema";
import type { ProjectSummary } from "../../lib/firebase/projects";
import { formatBytes } from "../../lib/format-detection/format-bytes";

/**
 * Phase 06 batch rewrite scope dialog (SOL-002/003/009/013). One compact
 * surface (approved design language) that makes the Premium batch explicit
 * before anything runs: metadata source (saved profile, one saved project,
 * or a one-off custom draft), the exact field plan, per-media GPS
 * applicability, eligible/skipped counts, and a confirm step. Nothing
 * processes until "Confirm" — the page snapshots the selection at that
 * moment (mid-run selection changes never redirect writes).
 */

export type BatchRewriteSource = "profile" | "project" | "custom";

export interface BatchRewriteDialogProps {
  open: boolean;
  /** Eligible still images in the snapshot (GPS-capable). */
  imageCount: number;
  /** Eligible MP3 files in the snapshot (image fields map to ID3). */
  audioCount: number;
  /** Selected video files — preview-only, always skipped and disclosed. */
  videoCount: number;
  /** Selected files of other/unknown kinds — skipped and disclosed. */
  otherCount: number;
  totalBytes: number;
  mode: string;
  savedProfile: MetadataProfile;
  projects: ProjectSummary[];
  projectDetails: Record<string, ProjectRecord>;
  source: BatchRewriteSource;
  projectId: string | null;
  /** SOL-009: the one-off custom draft (page-owned so it survives switching). */
  customDraft: EditorDraft;
  onCustomChange: (draft: EditorDraft) => void;
  /** SOL-002: true while auth/entitlement restoration is unresolved — the
   *  dialog shows a checking state instead of a final denial. */
  accessChecking: boolean;
  busy: boolean;
  /** Honest Premium gate message when the batch is locked (null = allowed). */
  lockedReason: string | null;
  onSourceChange: (source: BatchRewriteSource) => void;
  onProjectChange: (projectId: string | null) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

function planLines(profile: MetadataProfile): Array<{ field: ProfileField; label: string; value: string }> {
  return PROFILE_FIELDS
    .map((field) => ({
      field,
      label: editorFieldLabel(field),
      value: field === "keywords" ? profile.keywordsList.join(", ") : profile[field],
    }))
    .filter((line) => line.value.trim() !== "");
}

function customPlanLines(draft: EditorDraft): Array<{ field: ProfileField; label: string; value: string }> {
  return PROFILE_FIELDS
    .map((field) => ({
      field,
      label: editorFieldLabel(field),
      value: field === "keywords" ? draft.values.keywords ?? "" : draft.values[field] ?? "",
    }))
    .filter((line) => line.value.trim() !== "");
}

/** Eligible for the batch = supported still images + MP3 audio files. */
function eligibleCountOf(props: BatchRewriteDialogProps): number {
  return props.imageCount + props.audioCount;
}

export default function BatchRewriteDialog(props: BatchRewriteDialogProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setMounted(true), 0);
    return () => window.clearTimeout(timer);
  }, []);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<Element | null>(null);
  const headingId = useId();
  const { open, onCancel } = props;

  // SOL-013: remember the opener, move focus in, trap Tab, restore on close.
  useEffect(() => {
    if (!open || !mounted) return;
    openerRef.current = document.activeElement;
    const panel = panelRef.current;
    panel?.focus({ preventScroll: true });

    const focusables = (): HTMLElement[] => {
      const root = panelRef.current;
      if (!root) return [];
      return Array.from(root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.offsetParent !== null || element === document.activeElement);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusables();
      if (elements.length === 0) return;
      const current = document.activeElement as HTMLElement | null;
      const currentIndex = current ? elements.indexOf(current) : -1;
      if (event.shiftKey) {
        event.preventDefault();
        elements[currentIndex > 0 ? currentIndex - 1 : elements.length - 1].focus();
      } else {
        event.preventDefault();
        elements[currentIndex >= 0 && currentIndex < elements.length - 1 ? currentIndex + 1 : 0].focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      // Restore focus to the opener on every close/unmount path — but
      // never to a node that has since been removed from the DOM.
      const opener = openerRef.current;
      if (opener && opener.isConnected) {
        (opener as HTMLElement).focus?.({ preventScroll: true });
      }
    };
  }, [open, mounted, onCancel]);

  if (!props.open || !mounted) return null;

  const project = props.projectId ? props.projectDetails[props.projectId] ?? null : null;
  const effectiveProfile = props.source === "project"
    ? project ? projectToProfile(project) : null
    : props.source === "profile"
      ? props.savedProfile
      : null;
  const lines = props.source === "custom"
    ? customPlanLines(props.customDraft)
    : effectiveProfile ? planLines(effectiveProfile) : [];
  const gps = props.source === "project" && project && project.latitude !== null && project.longitude !== null
    ? { latitude: project.latitude, longitude: project.longitude, altitude: project.altitudeMeters }
    : null;
  const profileUsable = planLines(props.savedProfile).length > 0;
  const eligibleCount = eligibleCountOf(props);
  const skippedCount = props.videoCount + props.otherCount;
  const ready = props.lockedReason === null
    && (props.source === "profile"
      ? profileUsable
      : props.source === "project"
        ? Boolean(project) && (lines.length > 0 || gps !== null)
        : lines.length > 0);

  const scopeSummary = [
    `${eligibleCount} eligible file${eligibleCount === 1 ? "" : "s"}`,
    props.imageCount > 0 ? `${props.imageCount} image${props.imageCount === 1 ? "" : "s"}` : null,
    props.audioCount > 0 ? `${props.audioCount} MP3 audio${props.audioCount === 1 ? "" : "s"}` : null,
    skippedCount > 0 ? `${skippedCount} selected file${skippedCount === 1 ? "" : "s"} will be skipped (not supported for rewrite)` : null,
  ].filter(Boolean).join(" · ");

  return createPortal(
    <div className="fixed inset-0 z-[90] grid place-items-center bg-[#0c1428]/55 p-4" role="presentation" data-testid="batch-rewrite-backdrop">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        data-testid="batch-rewrite-dialog"
        className="max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-[1.25rem] border border-[#e6ebf3] bg-white p-4 shadow-2xl outline-none sm:p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id={headingId} className="text-[15.5px] font-extrabold text-[#16244a]">
              Batch rewrite — {scopeSummary.split(" · ")[0]}
            </h2>
            <p className="mt-0.5 text-[12px] leading-4 text-[#5a6b85]">
              Two or more files in one verified run are a Premium batch by default. Every output is
              re-inspected and verified independently; the originals stay untouched.
            </p>
          </div>
          <button type="button" data-testid="batch-rewrite-close" onClick={props.onCancel} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Close">
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m5 5 10 10M15 5 5 15" /></svg>
          </button>
        </div>

        {props.accessChecking ? (
          <div className="mt-3 rounded-xl border border-[#dbe7f7] bg-[#f4f8ff] px-3 py-3" data-testid="batch-rewrite-checking" role="status">
            <p className="text-[12.5px] font-semibold leading-5 text-[#2d5be9]">Checking your access…</p>
            <p className="mt-0.5 text-[11px] leading-4 text-[#5a6b85]">
              Confirming your sign-in state and Premium entitlement. This only takes a moment.
            </p>
          </div>
        ) : props.lockedReason ? (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5" data-testid="batch-rewrite-locked">
            <p className="text-[12.5px] font-semibold leading-5 text-amber-900">{props.lockedReason}</p>
            <p className="mt-1 text-[11px] leading-4 text-amber-800">
              Rewriting one file at a time stays free — open any file&apos;s Edit Metadata dialog and apply
              custom values, your profile, or (Premium) a saved project.
            </p>
          </div>
        ) : (
          <>
            <fieldset className="mt-3 grid gap-2" data-testid="batch-rewrite-source">
              <legend className="text-[12px] font-extrabold text-[#16244a]">Metadata source for this batch</legend>
              <label className={`flex items-start gap-2 rounded-xl border border-[#e6ebf3] bg-white p-2.5 ${profileUsable ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}>
                <input type="radio" name="batch-rewrite-source" checked={props.source === "profile"} onChange={() => props.onSourceChange("profile")} disabled={!profileUsable} className="mt-0.5 h-4 w-4 accent-[#0d9474]" />
                <span className="text-[12px] leading-5 text-[#3b4a66]">
                  <strong className="text-[#16244a]">Use my saved profile</strong>
                  {profileUsable ? " — the profile values below, exactly as saved." : " (empty — add values on the profile page)."}
                </span>
              </label>
              <label className={`flex items-start gap-2 rounded-xl border border-[#e6ebf3] bg-white p-2.5 ${props.projects.length > 0 ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}>
                <input type="radio" name="batch-rewrite-source" checked={props.source === "project"} onChange={() => props.onSourceChange("project")} disabled={props.projects.length === 0} className="mt-0.5 h-4 w-4 accent-[#0d9474]" />
                <span className="min-w-0 flex-1 text-[12px] leading-5 text-[#3b4a66]">
                  <strong className="text-[#16244a]">Use a saved project</strong>
                  {props.projects.length === 0 ? " (no saved projects yet)." : " — that project's fields and GPS, exactly as saved."}
                </span>
              </label>
              <label className="flex items-start gap-2 rounded-xl border border-[#e6ebf3] bg-white p-2.5 cursor-pointer">
                <input type="radio" name="batch-rewrite-source" checked={props.source === "custom"} onChange={() => props.onSourceChange("custom")} className="mt-0.5 h-4 w-4 accent-[#0d9474]" />
                <span className="text-[12px] leading-5 text-[#3b4a66]">
                  <strong className="text-[#16244a]">Enter custom values</strong>
                  {" — a one-off draft for this run only. It never changes your saved profile or projects."}
                </span>
              </label>
            </fieldset>

            {props.source === "project" ? (
              <label className="mt-2 grid gap-1 text-xs font-semibold text-slate-700">
                Saved project
                <select
                  value={props.projectId ?? ""}
                  onChange={(event) => props.onProjectChange(event.target.value === "" ? null : event.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal"
                  data-testid="batch-rewrite-project-select"
                >
                  <option value="">Select a project…</option>
                  {props.projects.map((row) => (
                    <option key={row.projectId} value={row.projectId}>
                      {row.projectTitle}{row.companyPublisher ? ` — ${row.companyPublisher}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {props.source === "custom" ? (
              <fieldset className="mt-2 grid gap-2 rounded-xl border border-[#e6ebf3] bg-[#fbfcfe] p-3" data-testid="batch-rewrite-custom-fields">
                <legend className="px-1 text-[12px] font-extrabold text-[#16244a]">Custom values for this run</legend>
                {PROFILE_FIELDS.map((field) => (
                  <label key={field} className="grid gap-1 text-[11.5px] font-semibold text-[#3b4a66]">
                    {editorFieldLabel(field)}
                    <input
                      type="text"
                      value={field === "keywords" ? props.customDraft.values.keywords ?? "" : props.customDraft.values[field] ?? ""}
                      onChange={(event) => props.onCustomChange({
                        ...props.customDraft,
                        values: { ...props.customDraft.values, [field]: event.target.value },
                      })}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12.5px] font-normal text-slate-900"
                      data-testid={`batch-rewrite-custom-${field}`}
                      autoComplete="off"
                    />
                  </label>
                ))}
                <p className="text-[10.5px] leading-4 text-[#5a6b85]">
                  Empty fields are skipped — nothing is inherited from your profile or projects. GPS is not part of a
                  custom batch; per-image GPS editing lives in the Edit Metadata / GeoTag editor.
                </p>
              </fieldset>
            ) : null}

            {/* Scope preview: exact fields + GPS + per-media counts */}
            <div className="mt-3 rounded-xl border border-[#e6ebf3] bg-[#fbfcfe] p-3" data-testid="batch-rewrite-scope">
              <p className="text-[12px] font-extrabold text-[#16244a]">Scope of this run</p>
              <p className="mt-0.5 text-[11.5px] text-[#3b4a66]">
                {scopeSummary}
                {" · "}{formatBytes(props.totalBytes)} · mode: {props.mode.replace(/_/g, " ")}
              </p>
              {lines.length > 0 ? (
                <dl className="mt-1.5 grid gap-0.5 text-[11px]">
                  {lines.map((line) => (
                    <div key={line.field} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-2 border-t border-slate-100 py-0.5 first:border-t-0">
                      <dt className="font-semibold text-slate-500">{line.label}</dt>
                      <dd className="break-all text-slate-700">{line.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-1 text-[11.5px] text-slate-500">No metadata fields in this source.</p>
              )}
              <p className="mt-1 text-[11px] font-semibold text-[#3b4a66]" data-testid="batch-rewrite-gps">
                GPS: {gps
                  ? `${gps.latitude}, ${gps.longitude}${gps.altitude !== null ? ` · ${gps.altitude} m` : ""} — written and verified per image (MP3 files never receive GPS)`
                  : "no GPS change in this batch"}
              </p>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" data-testid="batch-rewrite-confirm" disabled={!ready || props.busy} onClick={props.onConfirm} className="btn-primary !min-h-10 !px-4 text-[13px]">
                {props.busy ? "Applying…" : `Confirm batch rewrite (${eligibleCount})`}
              </button>
              <button type="button" data-testid="batch-rewrite-cancel" onClick={props.onCancel} className="btn-secondary !min-h-10 !px-4 text-[13px]">
                Cancel
              </button>
              <Link href="/account/profile" prefetch={false} className="text-[11px] font-bold text-[#2d5be9] underline-offset-2 hover:underline">
                Manage profile &amp; projects
              </Link>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
