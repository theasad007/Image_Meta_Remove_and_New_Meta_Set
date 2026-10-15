"use client";

import QueueItem from "./QueueItem";
import { formatBytes } from "../../lib/format-detection/format-bytes";
import type { CleaningStatus, CleaningTarget } from "../../lib/metadata/clean/types";
import type { RewriteStatus } from "../../lib/metadata/rewrite/rewrite";
import type { ImageInspectionResult, InspectionOutcome } from "../../types/inspection";
import type { QueueEntry } from "../../types/media";

export const MAX_AUTO_PREVIEWS = 60;

interface QueueListProps {
  entries: QueueEntry[];
  announcement: string;
  inspectionOf: (id: string) => InspectionOutcome | "inspecting" | undefined;
  inspectionResultOf: (id: string) => ImageInspectionResult | undefined;
  cleaningOf: (id: string) => CleaningStatus | "cleaning" | undefined;
  hasCleaningResultFor: (id: string) => boolean;
  rewriteOf?: (id: string) => RewriteStatus | "rewriting" | undefined;
  hasRewriteResultFor?: (id: string) => boolean;
  rewriteEnabled?: boolean;
  inspectingCount: number;
  cleaningCount: number;
  busy: boolean;
  batchRunning: boolean;
  cleanableOf: (id: string) => boolean;
  selectedOf: (id: string) => boolean;
  selectedCount: number;
  selectedCleanableCount: number;
  eligibleInputs: number;
  cleaningTargets: CleaningTarget[];
  partialOptedInOf: (id: string) => boolean;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onToggleCleaningTarget: (target: CleaningTarget) => void;
  onRemoveSelected: () => void;
  onTogglePartial: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onInspect: (id: string) => void;
  onShow: (id: string) => void;
  onClean: (id: string) => void;
  onShowCleaning: (id: string) => void;
  onCleanAll: () => void;
  onCleanSelected: () => void;
  onCancelInspections: () => void;
  onCancelCleaning: () => void;
  onRewrite?: (id: string) => void;
  onShowRewrite?: (id: string) => void;
}

const TARGETS: Array<{ value: CleaningTarget; label: string; hint: string }> = [
  { value: "exif_gps", label: "EXIF + GPS", hint: "Camera, device and location data" },
  { value: "descriptive", label: "XMP / IPTC / text", hint: "Descriptions, prompts, authors and comments" },
  { value: "ai_markers", label: "AI indicators only", hint: "Removes the EXIF/XMP/text block that supplied an AI marker, plus identified C2PA stores carrying AI markers." },
];

export default function QueueList(props: QueueListProps) {
  const {
    entries, announcement, inspectionOf, inspectionResultOf, cleaningOf,
    hasCleaningResultFor, rewriteOf, hasRewriteResultFor, rewriteEnabled, inspectingCount, cleaningCount, busy, batchRunning,
    cleanableOf, selectedOf, selectedCount, selectedCleanableCount, eligibleInputs, cleaningTargets,
    partialOptedInOf, onToggleSelect, onToggleSelectAll, onToggleCleaningTarget,
    onRemoveSelected, onTogglePartial, onRetry, onRemove, onClear, onInspect,
    onShow, onClean, onShowCleaning, onCleanAll, onCleanSelected,
    onCancelInspections, onCancelCleaning, onRewrite, onShowRewrite,
  } = props;
  const totalBytes = entries.reduce((sum, entry) => sum + entry.source.size, 0);
  const images = entries.filter((entry) => entry.item.detected.mediaKind === "image").length;
  const videos = entries.filter((entry) => entry.item.detected.mediaKind === "video").length;
  const allSelected = entries.length > 0 && selectedCount === entries.length;
  const noTarget = cleaningTargets.length === 0;

  return (
    <section aria-labelledby="queue-heading" className="mt-7 border-t border-slate-200 pt-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <p className="section-kicker">Your files</p>
          <h2 id="queue-heading" className="mt-1 text-xl font-extrabold tracking-[-0.02em] text-slate-950">Images and detected metadata</h2>
          <p className="mt-1 text-xs text-slate-500">Metadata is inspected automatically and shown in the same row.</p>
        </div>
        {inspectingCount > 0 || cleaningCount > 0 ? (
          <button type="button" onClick={() => { if (inspectingCount > 0) onCancelInspections(); if (cleaningCount > 0) onCancelCleaning(); }} data-testid="inspect-cancel" className="btn-secondary ml-auto !border-amber-300 !bg-amber-50 !text-amber-800">Cancel work ({inspectingCount + cleaningCount})</button>
        ) : null}
      </div>

      <div role="status" aria-live="polite" data-testid="queue-stats" className="mt-3 text-xs font-medium text-slate-500">
        {entries.length === 0 ? "No files queued yet." : `${entries.length} file${entries.length === 1 ? "" : "s"} · ${images} image${images === 1 ? "" : "s"} · ${videos} video${videos === 1 ? "" : "s"} · ${formatBytes(totalBytes)}`}
      </div>
      <div role="status" aria-live="polite" className="sr-only">{announcement}</div>
      {announcement ? <p className="mt-3 rounded-xl bg-blue-50 px-3 py-2 text-xs font-medium text-blue-900">{announcement}</p> : null}

      {entries.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-6 text-center"><p className="text-sm font-bold text-slate-700">Add images above to start</p><p className="mt-1 text-xs text-slate-500">Preview and metadata findings will appear automatically.</p></div>
      ) : (
        <>
          <div className="sticky top-[4.4rem] z-20 mt-4 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-[0_8px_28px_rgba(15,23,42,.08)] backdrop-blur">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"><input type="checkbox" checked={allSelected} onChange={onToggleSelectAll} className="h-4 w-4 accent-[#0d9474]" />Select all</label>
              <button type="button" onClick={onRemoveSelected} disabled={selectedCount === 0 || busy} className="btn-secondary !min-h-9 !px-3 !py-1.5 text-xs">Remove selected ({selectedCount})</button>
              <button type="button" onClick={onClear} disabled={busy} data-testid="queue-clear" className="btn-secondary !min-h-9 !px-3 !py-1.5 text-xs">Remove all</button>
              <span className="hidden h-7 w-px bg-slate-200 xl:block" />
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[10px] font-extrabold uppercase tracking-[.12em] text-slate-400">Remove</span>
                {TARGETS.map((target) => <label key={target.value} title={target.hint} className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-bold ${cleaningTargets.includes(target.value) ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-500"}`}><input type="checkbox" checked={cleaningTargets.includes(target.value)} onChange={() => onToggleCleaningTarget(target.value)} className="h-3.5 w-3.5 accent-emerald-600" />{target.label}</label>)}
              </div>
              <div className="ml-auto flex flex-wrap gap-2">
                {batchRunning ? null : <button type="button" onClick={onCleanSelected} disabled={busy || noTarget || selectedCleanableCount === 0} data-testid="batch-clean-selected" className="btn-secondary !min-h-10 !border-emerald-300 !px-3 !py-2 text-xs !text-emerald-800">Clean selected ({selectedCleanableCount})</button>}
                {batchRunning ? null : <button type="button" onClick={onCleanAll} disabled={busy || noTarget || eligibleInputs === 0} data-testid="batch-clean-all" className="btn-success !min-h-10 !px-4 !py-2 text-xs">Clean all ({eligibleInputs})</button>}
              </div>
            </div>
            {noTarget ? <p className="mt-2 text-[11px] font-semibold text-amber-700">Choose at least one metadata type before cleaning.</p> : null}
          </div>

          <div className="mt-4 hidden grid-cols-[2rem_4.75rem_minmax(10rem,1fr)_minmax(18rem,1.35fr)_auto_2.25rem] gap-3 px-3 text-[10px] font-extrabold uppercase tracking-[.12em] text-slate-400 lg:grid"><span /><span>Preview</span><span>File</span><span>Detected metadata</span><span className="text-right">Actions</span><span /></div>
          <ul data-testid="queue-list" className="mt-2 grid gap-2">
            {entries.map((entry, index) => <QueueItem key={entry.item.id} entry={entry} index={index} autoPreview={index < MAX_AUTO_PREVIEWS} inspectionState={inspectionOf(entry.item.id)} inspectionResult={inspectionResultOf(entry.item.id)} cleaningState={cleaningOf(entry.item.id)} hasCleaningResult={hasCleaningResultFor(entry.item.id)} rewriteState={rewriteOf?.(entry.item.id)} hasRewriteResult={hasRewriteResultFor?.(entry.item.id) ?? false} rewriteEnabled={rewriteEnabled} busy={busy} cleanable={cleanableOf(entry.item.id)} selected={selectedOf(entry.item.id)} partialOptedIn={partialOptedInOf(entry.item.id)} onToggleSelect={onToggleSelect} onTogglePartial={onTogglePartial} onRetry={onRetry} onRemove={onRemove} onInspect={onInspect} onShow={onShow} onClean={onClean} onShowCleaning={onShowCleaning} onRewrite={onRewrite} onShowRewrite={onShowRewrite} />)}
          </ul>
        </>
      )}
    </section>
  );
}
