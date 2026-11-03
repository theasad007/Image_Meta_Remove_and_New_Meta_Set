"use client";

import { X } from "lucide-react";
import BeforeAfterPanel from "../cleaning/BeforeAfterPanel";
import InspectorPanel from "../inspector/InspectorPanel";
import RewriteResultPanel from "../rewrite/RewriteResultPanel";
import Tooltip from "../ui/tooltip";
import { formatBytes } from "../../lib/format-detection/format-bytes";
import { downloadBlob } from "../../lib/reporting/download";
import type { CleaningStatus, FileCleaningResult } from "../../lib/metadata/clean/types";
import type { FileRewriteResult, RewriteStatus } from "../../lib/metadata/rewrite/rewrite";
import type { WorkspaceTool } from "../../lib/workspace/actions";
import { deriveRowStatus, type RowStatus } from "../../lib/workspace/status";
import { chipsFor, dimensionsOf, type MetadataChip } from "../../lib/workspace/summary";
import type { ImageInspectionResult, InspectionOutcome } from "../../types/inspection";
import type { QueueEntry } from "../../types/media";
import { Preview } from "./queue-previews";

/** ---- Screen 04 row vocabulary (honest statuses, never "Completed") ---- */

/**
 * Shared desktop column template for the file table (row + header).
 * Four stable conceptual columns in every processed state: selection |
 * File (thumbnail + filename + format · size + status) | Detected
 * metadata | Actions. The Actions track is a reserved fixed width sized
 * for `Edit · View details · X` plus the second-line `Download cleaned`
 * control, so adding a verified output, badges or longer titles never
 * shifts headers or neighboring columns.
 */
export const ROW_GRID =
  "lg:grid-cols-[1.4rem_minmax(15rem,1fr)_minmax(11rem,1.4fr)_13rem]";

const TONE_CLASSES: Record<RowStatus["tone"], string> = {
  neutral: "bg-slate-100 text-slate-600",
  busy: "bg-blue-50 text-blue-700",
  success: "bg-emerald-50 text-emerald-800",
  warning: "bg-amber-50 text-amber-800",
  danger: "bg-red-50 text-red-700",
};

const SUCCESS_KEYS = new Set(["verified_clean", "verified_unchanged", "verified_rewritten"]);

/** Plain-language explanation for each honest lifecycle state. */
function statusTitle(status: RowStatus, name: string): string {
  switch (status.key) {
    case "queued": return `Queued. Inspection has not run for ${name} yet.`;
    case "inspecting": return `Metadata inspection is running for ${name}.`;
    case "inspected": return `Inspection finished for ${name}. Metadata has been recorded but nothing has been removed yet.`;
    case "inspected_partial": return `Inspection finished with gaps for ${name} — some groups could not be read. See details.`;
    case "inspected_failed": return `Inspection failed for ${name}.`;
    case "unsupported": return `Metadata tools are not available for this file. It stays queued for preview.`;
    case "cancelled": return `Work on ${name} was cancelled before finishing.`;
    case "processing": return `Cleaning or rewriting is running for ${name}.`;
    case "verified_clean": return `Metadata removal finished for ${name}; the written file was re-read to verify it.`;
    case "verified_unchanged": return `Verified for ${name}: no target metadata was present, so the output matches the input.`;
    case "verified_rewritten": return `Profile rewrite finished for ${name}; the written file was re-read to verify it.`;
    case "partial": return `Some metadata for ${name} was removed and verified; parts were retained on purpose. See details.`;
    case "failed": return `Processing failed for ${name}. No output was created.`;
  }
}

function rowStatusFor(entry: QueueEntry, args: Parameters<typeof deriveRowStatus>[0]): RowStatus & { title: string } {
  // Review-only rows (videos, unknown bytes) never enter processing.
  if (entry.item.detected.mediaKind !== "image" && entry.item.detected.mediaKind !== "audio") {
    return entry.item.detected.binaryVerified
      ? { key: "unsupported", label: "Unsupported", tone: "neutral", busy: false, verifiedOutput: false,
          title: "This file type is queued for preview only; metadata tools are not available for it." }
      : { key: "queued", label: "Queued", tone: "neutral", busy: false, verifiedOutput: false,
          title: "Waiting for the byte-level format check." };
  }
  // Images AND audio rows (Phase 11) flow through the same lifecycle:
  // inspect → clean (metadata/AI) → rewrite — MP3 engines are kind-routed
  // inside the pipeline, so honest per-file outcomes render identically.
  const derived = deriveRowStatus(args);
  const audioTitle = entry.item.detected.mediaKind === "audio"
    ? statusTitle(derived, entry.item.name).replace(/image/gi, "audio")
    : statusTitle(derived, entry.item.name);
  return { ...derived, title: audioTitle };
}

const CHIP_TONES: Record<string, string> = {
  ai: "bg-red-50 text-red-600",
  c2pa: "bg-[#e9f2fe] text-[#2d5be9]",
  exif: "bg-indigo-50 text-indigo-700",
  gps: "bg-rose-50 text-rose-700",
  xmp: "bg-violet-50 text-violet-700",
  iptc: "bg-teal-50 text-teal-700",
};

function MetadataChips({ result, state, activeTool, cleaned = false }: { result?: ImageInspectionResult; state?: InspectionOutcome | "inspecting"; activeTool: WorkspaceTool; cleaned?: boolean }) {
  if (state === "inspecting") {
    return (
      <span className="inline-flex items-center gap-2 text-xs font-semibold text-blue-700">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-700 motion-reduce:animate-none" />
        Inspecting metadata…
      </span>
    );
  }
  if (!result) return <span className="text-xs text-slate-400">Waiting for automatic inspection…</span>;

  const chips: MetadataChip[] = chipsFor(result, activeTool);
  const openAi = result.aiIndicators.some((item) => /openai|dall[ -]?e|chatgpt/i.test(`${item.label} ${item.matchedValue}`));

  return (
    <div className="min-w-0">
      {cleaned ? (
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.04em] text-slate-400" data-testid="chips-original-caption">
          Original findings · before cleaning
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5" aria-label={cleaned ? "Original metadata findings, recorded from the file before cleaning" : "Automatic metadata inspection summary"}>
        {chips.map((chip) => {
          const label = chip.key === "ai" && openAi ? "OpenAI" : chip.label;
          const tone = chip.detected
            ? (CHIP_TONES[chip.key] ?? "bg-slate-100 text-slate-700")
            : "border border-slate-200 bg-white text-slate-500";
          return (
            <span
              key={chip.key}
              title={chip.title}
              className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${tone}`}
            >
              {label} {chip.value ?? "—"}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export interface QueueDownloadOutput {
  blob: Blob;
  name: string;
  kind: "cleaned" | "rewritten";
}

interface QueueItemProps {
  entry: QueueEntry;
  autoPreview: boolean;
  activeTool: WorkspaceTool;
  expanded: boolean;
  inspectionState: InspectionOutcome | "inspecting" | undefined;
  inspectionResult?: ImageInspectionResult;
  cleaningState: CleaningStatus | "cleaning" | undefined;
  cleaningResult?: FileCleaningResult;
  rewriteState?: RewriteStatus | "rewriting";
  rewriteResult?: FileRewriteResult;
  downloadOutput?: QueueDownloadOutput | null;
  busy: boolean;
  selected: boolean;
  partialOptedIn: boolean;
  onToggleSelect: (id: string) => void;
  onToggleExpanded: (id: string) => void;
  /** Opens the Screen 05 image-details dialog for this row (never navigates away). */
  onOpenDetails: (id: string) => void;
  /** Screen 06: opens the single-image edit-metadata dialog for this row. */
  onOpenEditor: (id: string) => void;
  onTogglePartial: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onInspect: (id: string) => void;
  onDownloadNotice: (name: string) => void;
}

export default function QueueItem({
  entry, autoPreview, activeTool, expanded, inspectionState, inspectionResult,
  cleaningState, cleaningResult, rewriteState, rewriteResult, downloadOutput, busy,
  selected, partialOptedIn, onToggleSelect, onToggleExpanded, onOpenDetails, onOpenEditor,
  onTogglePartial, onRetry, onRemove, onInspect, onDownloadNotice,
}: QueueItemProps) {
  const { item } = entry;
  const outputIsBeingWritten = cleaningState === "cleaning" || rewriteState === "rewriting";
  const detailsId = `queue-details-${item.id}`;
  const status = rowStatusFor(entry, { inspectionState, cleaningState, cleaningResult, rewriteState, rewriteResult });
  const dimensions = inspectionResult ? dimensionsOf(inspectionResult) : null;
  const canRetry = cleaningState === "failed" || cleaningState === "not_verified";

  const download = () => {
    if (!downloadOutput) return;
    downloadBlob(downloadOutput.blob, downloadOutput.name);
    onDownloadNotice(downloadOutput.name);
  };

  const editButton = (
    <Tooltip label={
      entry.item.detected.mediaKind === "image"
        ? "Edit metadata for this image (Screen 06 editor)."
        : entry.item.detected.mediaKind === "audio"
          ? "Edit audio tags for this MP3 (title, artist, publisher…)."
          : "Metadata editing is available for still images and MP3 only."
    }>
      <button
        type="button"
        data-editor-open
        onClick={() => onOpenEditor(item.id)}
        className="inline-flex min-h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2 py-1 text-[12px] font-bold text-[#35435c] hover:bg-slate-50 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#2d5be9]"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4.5 19.5 15 9l-3-3L4.5 16.5v3h3ZM14.5 7.5l2 2" />
        </svg>
        Edit<span className="sr-only"> metadata for {item.name}</span>
      </button>
    </Tooltip>
  );

  /**
   * Screen 05 trigger: "View details" opens the image-details dialog for
   * exactly this row without leaving the workspace. While the row itself
   * shows the post-process expanded output surface (verified cleaning /
   * rewrite results auto-expanded after processing), the button keeps its
   * approved inline toggle ("Hide details") so the label stays truthful.
   */
  const detailsButton = inspectionResult ? (
    <button
      type="button"
      data-details-open
      onClick={() => (expanded ? onToggleExpanded(item.id) : onOpenDetails(item.id))}
      aria-expanded={expanded}
      aria-haspopup={expanded ? undefined : "dialog"}
      aria-controls={expanded ? detailsId : undefined}
      className="inline-flex min-h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2 py-1 text-[12px] font-bold text-[#35435c] hover:bg-slate-50 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#2d5be9]"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.5 12s3.6-6.2 9.5-6.2S21.5 12 21.5 12s-3.6 6.2-9.5 6.2S2.5 12 2.5 12Z" />
        <circle cx="12" cy="12" r="2.6" />
      </svg>
      {expanded ? "Hide details" : "View details"}<span className="sr-only"> for {item.name}</span>
    </button>
  ) : (
    <button
      type="button"
      onClick={() => onInspect(item.id)}
      disabled={busy}
      className="inline-flex min-h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2 py-1 text-[12px] font-bold text-[#35435c] hover:bg-slate-50 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#2d5be9] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {inspectionState === "inspecting" ? "Inspecting…" : "Inspect metadata"}<span className="sr-only"> for {item.name}</span>
    </button>
  );

  const downloadButton = downloadOutput ? (
    <Tooltip label={`Download the verified cleaned copy of ${item.name}. The original file was not modified.`}>
      <button
        type="button"
        onClick={download}
        data-testid="download-row-output"
        className="inline-flex min-h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[12px] font-bold text-emerald-800 hover:bg-emerald-100 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#0d9474]"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 4.5v11m0 0-4.2-4.2M12 15.5l4.2-4.2M4.5 18.5h15" />
        </svg>
        Download {downloadOutput.kind}
      </button>
    </Tooltip>
  ) : null;

  /** Direct single-file removal (replaces the former three-dot dropdown). */
  const removeButton = (
    <Tooltip label="Remove from workspace">
      <button
        type="button"
        onClick={() => onRemove(item.id)}
        data-testid="queue-remove"
        aria-label={`Remove ${item.name} from workspace`}
        disabled={outputIsBeingWritten}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-transparent text-red-500 hover:border-red-100 hover:bg-red-50 hover:text-red-600 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-red-500 disabled:cursor-not-allowed disabled:opacity-40 motion-safe:transition-colors"
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </Tooltip>
  );

  /** Failed/not-verified rows keep the existing retry action (menu replacement). */
  const retryButton = canRetry ? (
    <button
      type="button"
      onClick={() => onRetry(item.id)}
      disabled={outputIsBeingWritten}
      className="inline-flex min-h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-bold text-[#35435c] hover:bg-slate-50 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#2d5be9] disabled:cursor-not-allowed disabled:opacity-40"
    >
      Retry<span className="sr-only"> processing for {item.name}</span>
    </button>
  ) : null;

  const checkbox = (
    <input
      type="checkbox"
      checked={selected}
      onChange={() => onToggleSelect(item.id)}
      aria-label={`Select ${item.name}`}
      className="h-[1.15rem] w-[1.15rem] cursor-pointer accent-[#0d9474]"
    />
  );

  const thumb = (
    <div className="h-[3.25rem] w-[3.25rem] shrink-0 overflow-hidden rounded-[0.65rem] border border-slate-200 bg-slate-100">
      <Preview entry={entry} enabled={autoPreview} />
    </div>
  );

  const statusCell = (
    <span data-testid="row-status" className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${TONE_CLASSES[status.tone]}`} title={status.title}>
      {status.busy ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" aria-hidden="true" /> : null}
      {SUCCESS_KEYS.has(status.key) ? (
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="m4.5 10.5 3.4 3.4 7.6-8" />
        </svg>
      ) : null}
      {status.label}
    </span>
  );

  const fileCell = (
    <div className="flex min-w-0 items-center gap-3">
      {thumb}
      <div className="min-w-0 flex-1">
        <Tooltip label={item.name}>
          <p className="truncate text-[13px] font-extrabold text-slate-900">{item.name}</p>
        </Tooltip>
        <p className="mt-0.5 text-[12px] font-medium text-slate-500">
          <span className="font-bold text-slate-600">{item.detected.label}</span>
          {" · "}
          <span className="tabular-nums">{formatBytes(item.sizeBytes)}</span>
          {dimensions ? <span className="tabular-nums"> · {dimensions}</span> : null}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{statusCell}{retryButton}</div>
        {item.notice ? <p className="mt-0.5 line-clamp-1 text-[10.5px] leading-4 text-slate-500" title={item.notice}>{item.notice}</p> : null}
      </div>
    </div>
  );

  const chipsCell = <MetadataChips result={inspectionResult} state={inspectionState} activeTool={activeTool} cleaned={Boolean(cleaningResult || rewriteResult)} />;

  const cleaningBadges = cleaningState || rewriteState ? (
    <div className="flex flex-wrap items-center gap-1.5">
      {cleaningState === "partially_cleaned" ? (
        <label className="flex cursor-pointer items-center gap-1 text-[10.5px] font-semibold text-amber-800">
          <input type="checkbox" checked={partialOptedIn} onChange={() => onTogglePartial(item.id)} className="h-3.5 w-3.5 accent-amber-600" /> Include partial output
        </label>
      ) : null}
    </div>
  ) : null;

  return (
    <li
      data-testid="queue-item"
      data-queue-id={item.id}
      className={`relative overflow-hidden border-b border-[#eef1f7] bg-white transition last:border-b-0 ${selected ? "bg-[#f7f9ff]" : ""}`}
    >
      {/* Desktop: 4-column table-style row matching the Screen 04 reference. */}
      <div className={`hidden items-center gap-2.5 px-4 py-2.5 lg:grid xl:px-5 ${ROW_GRID}`}>
        {checkbox}
        {fileCell}
        <div className="min-w-0">
          {chipsCell}
          {cleaningBadges}
        </div>
        <div className="grid w-full justify-items-end gap-1">
          <div className="flex items-center justify-end gap-1">
            {editButton}
            {detailsButton}
            {removeButton}
          </div>
          {downloadButton}
        </div>
      </div>

      {/* Mobile/tablet: compact card with the same data and actions. */}
      <div className="flex flex-col gap-2.5 p-3 lg:hidden">
        <div className="flex items-start gap-3">
          <div className="pt-0.5">{checkbox}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <Tooltip label={item.name}>
                  <p className="truncate text-[13px] font-extrabold text-slate-900">{item.name}</p>
                </Tooltip>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-medium text-slate-500">
                  <span className="font-bold text-slate-600">{item.detected.label}</span>
                  <span className="tabular-nums">{formatBytes(item.sizeBytes)}</span>
                  {dimensions ? <span className="tabular-nums">{dimensions}</span> : null}
                </p>
              </div>
              {removeButton}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{statusCell}{retryButton}</div>
            {item.notice ? <p className="mt-1 line-clamp-2 text-[10.5px] leading-4 text-slate-500" title={item.notice}>{item.notice}</p> : null}
          </div>
        </div>
        <div>{chipsCell}{cleaningBadges}</div>
        <div className="flex flex-wrap items-center gap-1.5 border-t border-[#eef1f7] pt-2.5">
          {downloadButton}
          {editButton}
          {detailsButton}
        </div>
      </div>

      {expanded ? (
        <div id={detailsId} className="border-t border-slate-200 bg-slate-50/45 p-3 sm:p-4" data-testid="queue-item-details">
          <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
            <aside className="min-w-0">
              <div className="aspect-square max-h-72 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100"><Preview entry={entry} enabled detailed /></div>
              <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-600">
                <p className="font-bold text-slate-900">{activeTool === "ai_metadata" ? "AI metadata view" : "General metadata view"}</p>
                <p className="mt-1">{activeTool === "ai_metadata" ? "Qualified AI indicators and Content Credentials are prioritized. This is not pixel-based AI detection." : "EXIF, GPS, XMP and IPTC are prioritized. GPS coordinate editing is not available yet."}</p>
              </div>
            </aside>
            <InspectorPanel result={inspectionResult as ImageInspectionResult} embedded headingId={`inspection-heading-${item.id}`} prioritizeAi={activeTool === "ai_metadata"} />
          </div>

          {activeTool === "ai_metadata" ? <p className="mt-3 rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs leading-5 text-violet-900"><strong>Removal scope:</strong> qualified AI markers use the existing focused cleaner. Some formats require removing the containing EXIF, XMP, IPTC or text block, so unrelated fields in that block may also be removed. Verification details below show what actually changed.</p> : null}
          {cleaningResult ? <div className="mt-3"><BeforeAfterPanel result={cleaningResult} embedded headingId={`cleaning-heading-${item.id}`} onDownload={(finished) => onDownloadNotice(finished.outputName ?? finished.inputName)} /></div> : null}
          {rewriteResult ? <div className="mt-3"><RewriteResultPanel result={rewriteResult} embedded headingId={`rewrite-heading-${item.id}`} onDownload={(finished) => onDownloadNotice(finished.outputName ?? finished.inputName)} /></div> : null}
        </div>
      ) : null}
    </li>
  );
}
