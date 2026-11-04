"use client";

import type { CleaningStatus, FileCleaningResult } from "../../lib/metadata/clean/types";
import type { FileRewriteResult, RewriteStatus } from "../../lib/metadata/rewrite/rewrite";
import type { WorkspaceTool } from "../../lib/workspace/actions";
import type { BatchCounts, ZipBuildState } from "../../types/batch";
import type { InspectionOutcome, ImageInspectionResult } from "../../types/inspection";
import type { QueueEntry } from "../../types/media";
import { formatBytes } from "../../lib/format-detection/format-bytes";
import BatchPanel from "../batch/BatchPanel";
import QueueList from "../queue/QueueList";
import type { QueueDownloadOutput } from "../queue/QueueItem";
import ReportsPanel, { type ReportChoices } from "../reports/ReportsPanel";
import QueueSummary from "./QueueSummary";
import ToolSwitcher from "./ToolSwitcher";
import { cn } from "../../lib/cn";

export interface AfterUploadWorkspaceProps {
  entries: QueueEntry[];
  activeTool: WorkspaceTool;
  onToolChange: (tool: WorkspaceTool) => void;
  announcement: string;
  results: Record<string, ImageInspectionResult>;
  inspectingIds: string[];
  inspectionOf: (id: string) => InspectionOutcome | "inspecting" | undefined;
  inspectionResultOf: (id: string) => ImageInspectionResult | undefined;
  cleaningOf: (id: string) => CleaningStatus | "cleaning" | undefined;
  cleaningResultOf: (id: string) => FileCleaningResult | undefined;
  rewriteOf: (id: string) => RewriteStatus | "rewriting" | undefined;
  rewriteResultOf: (id: string) => FileRewriteResult | undefined;
  outputOf: (id: string) => QueueDownloadOutput | null;
  inspectingCount: number;
  processingCount: number;
  busy: boolean;
  cleanableOf: (id: string) => boolean;
  selectedOf: (id: string) => boolean;
  expandedOf: (id: string) => boolean;
  selectedCount: number;
  selectedCleanableCount: number;
  outputCount: number;
  partialOptedInOf: (id: string) => boolean;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onToggleExpanded: (id: string) => void;
  /** Screen 05: opens the image-details dialog for one queue item. */
  onOpenDetails: (id: string) => void;
  /** Screen 06: opens the single-image edit-metadata dialog for one queue item. */
  onOpenEditor: (id: string) => void;
  onFiles: (files: File[]) => void;
  onRemoveSelected: () => void;
  onTogglePartial: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onInspect: (id: string) => void;
  onDownloadNotice: (name: string) => void;
  onCancelInspections: () => void;
  onCancelProcessing: () => void;
  onRemoveMetadata: () => void;
  onRemoveAiMetadata: () => void;
  onOpenRewrite: () => void;
  /** Feature-policy notice (Phase 02): a Premium-required message for the
   *  current action, dismissible; null when nothing is locked. */
  premiumNotice?: string | null;
  onDismissPremiumNotice?: () => void;
  batchRunning: boolean;
  batchDone: number;
  batchTotal: number;
  batchCurrentName: string | null;
  batchCounts: BatchCounts;
  zip: ZipBuildState;
  partialExcluded: number;
  includeAllPartials: boolean;
  reportFailure: string | null;
  failedCount: number;
  onCancelBatch: () => void;
  onCancelZip: () => void;
  onRetryFailed: () => void;
  onTogglePartials: () => void;
  onDownloadZip: () => void;
  onDownloadZipBare: () => void;
  reportChoices: ReportChoices;
  reportGenerating: string | null;
  reportProgress: string | null;
  reportError: string | null;
  reportDisabled: boolean;
  onReportChoices: (choices: ReportChoices) => void;
  onDownloadCsv: () => void;
  onDownloadTags: () => void;
  onDownloadPdf: () => void;
  onCancelReport: () => void;
  rewriteProgress: string | null;
}

/**
 * Screen 04 — the in-route after-upload state of `/`.
 *
 * Composition follows the approved reference: a compact two-tool switcher
 * with the "Local-only processing" badge, then the "Files in your
 * workspace" card (primary actions + file table + Queue summary sidebar),
 * the Verified outputs / Audit reports cards and the compact file-support
 * strip. The landing hero, big dropzone and SEO sections stay hidden while
 * files are queued; removing every file hands the route back to the locked
 * Screen 01 view.
 *
 * Every action stays the existing engine contract: the three header
 * buttons drive bulk removal/rewrite on the selection, outcomes carry
 * honest per-row statuses (never "Completed" for uncleaned files), and the
 * two export cards remain guest-usable ZIP/CSV/PDF surfaces.
 */
export default function AfterUploadWorkspace(props: AfterUploadWorkspaceProps) {
  const eligible = props.selectedCleanableCount;
  const unsupported = Math.max(0, props.selectedCount - eligible);
  const actionsDisabled = props.busy || eligible === 0;
  // SOL-012: explicit per-kind counts — MP3 is audio, never folded into video.
  const audio = props.entries.filter((entry) => entry.item.detected.mediaKind === "audio").length;
  const videos = props.entries.filter((entry) => entry.item.detected.mediaKind === "video").length;

  const removalReason = eligible === 0
    ? "Select at least one eligible file (image or MP3) to enable this action."
    : props.busy
      ? "Wait for the current inspection, processing or export task to finish."
      : `Runs on ${eligible} selected eligible file${eligible === 1 ? "" : "s"}. Existing removal scopes apply.`;
  const aiReason = eligible === 0
    ? "Select at least one eligible file (image or MP3) to enable this action."
    : props.busy
      ? "Wait for the current task to finish."
      : `${removalReason} AI-focused removal can remove a containing metadata family when safe single-tag surgery is unavailable; row verification shows what actually changed.`;
  const rewriteReason = eligible === 0
    ? "Select at least one eligible file (image or MP3) to enable this action."
    : props.busy
      ? "Wait for the current task to finish."
      : "Opens the profile-based rewrite workflow for images and MP3 files. Guests can use both removal actions without signing in.";

  return (
    <div className="mx-auto max-w-7xl px-4 pb-4 pt-5 sm:px-6 lg:px-8">
      {/* Compact two-tool switcher (same tabs state, compact layout). */}
      <ToolSwitcher
        variant="compact"
        activeTool={props.activeTool}
        onChange={props.onToolChange}
      />

      <section
        id="workspace-panel"
        aria-labelledby="workspace-heading"
        data-testid="workspace-card"
        className="surface-card mt-3.5 rounded-[1.4rem] p-3.5 sm:p-5"
      >
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[0.8rem] bg-[#e9f2fe] text-[#2d5be9]" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8.2 7.5h7.4a1.6 1.6 0 0 1 1.6 1.6v9a1.9 1.9 0 0 1-1.9 1.9H8.5a1.9 1.9 0 0 1-1.9-1.9v-9a1.6 1.6 0 0 1 1.6-1.6Z" />
              <path d="M9.5 7.5v-1a2.5 2.5 0 0 1 2.5-2.5 2.5 2.5 0 0 1 2.5 2.5v1" />
              <path d="m7.8 12 4.2 2.4L16.2 12" opacity=".8" />
              <path d="m7.8 15.6 4.2 2.4 4.2-2.4" opacity=".5" />
            </svg>
          </span>
          <div className="min-w-0">
            <h1 id="workspace-heading" className="text-[19px] font-extrabold tracking-[-0.02em] text-[#16244a]">
              Files in your workspace
            </h1>
            <p className="mt-0.5 text-[13px] leading-5 text-[#5a6b85]">
              Inspect results, choose actions, and download your cleaned files.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:ml-2 sm:pt-0.5" data-testid="queue-stats" role="status">
            <span className="inline-flex items-center rounded-full bg-[#e9f2fe] px-2.5 py-1 text-[12px] font-bold text-[#2d5be9]">
              {props.entries.length} file{props.entries.length === 1 ? "" : "s"}
            </span>
            <span className="inline-flex items-center rounded-full bg-white px-2.5 py-1 text-[12px] font-bold text-[#43536e] ring-1 ring-[#e3e9f2]">
              {formatBytes(props.entries.reduce((sum, entry) => sum + entry.source.size, 0))}
            </span>
            {audio > 0 ? (
              <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-[12px] font-bold text-emerald-800" data-testid="queue-stats-audio">
                {audio} audio file{audio === 1 ? "" : "s"} (MP3 · inspect + clean + rewrite)
              </span>
            ) : null}
            {videos > 0 ? (
              <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-[12px] font-bold text-amber-800">
                {videos} video{videos === 1 ? "" : "s"} (preview only)
              </span>
            ) : null}
          </div>

          <div className="grid w-full grid-cols-1 gap-2 sm:ml-auto sm:flex sm:w-auto sm:flex-wrap sm:justify-end" aria-label="Selected file actions">
            <button
              type="button"
              onClick={props.onRemoveMetadata}
              disabled={actionsDisabled}
              aria-describedby="ws-remove-metadata-help"
              data-testid="batch-clean-all"
              title={removalReason}
              className="inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-[0.75rem] border border-[#8fb0f2] bg-white px-3.5 text-[13px] font-bold text-[#2d5be9] outline-offset-2 hover:border-[#5d82f5] hover:bg-[#f2f6ff] focus-visible:outline-3 focus-visible:outline-[#2d5be9] motion-safe:transition-colors disabled:cursor-not-allowed disabled:border-[#dfe6f2] disabled:bg-white disabled:text-[#9aa8c2]"
            >
              <span aria-hidden="true" className="text-[15px] leading-none">−</span>
              Remove Metadata ({eligible})
            </button>
            <span id="ws-remove-metadata-help" className="sr-only">{removalReason}</span>
            <button
              type="button"
              onClick={props.onRemoveAiMetadata}
              disabled={actionsDisabled}
              aria-describedby="ws-remove-ai-help"
              data-testid="remove-ai-metadata"
              title={aiReason}
              className="inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-[0.75rem] border border-[#2d5be9] bg-[#2d5be9] px-3.5 text-[13px] font-bold text-white outline-offset-2 shadow-[0_8px_18px_rgba(45,91,233,.22)] hover:bg-[#1f4ad6] focus-visible:outline-3 focus-visible:outline-[#2d5be9] motion-safe:transition-colors disabled:cursor-not-allowed disabled:border-[#c9d8f8] disabled:bg-[#b7ccf5] disabled:shadow-none"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                <path d="M9.8 3.9c.4-1.1 1.9-1.1 2.2 0l1 3.3a3.9 3.9 0 0 0 2.6 2.6l3.3 1c1.1.4 1.1 1.9 0 2.2l-3.3 1a3.9 3.9 0 0 0-2.6 2.6l-1 3.3c-.4 1.1-1.9 1.1-2.2 0l-1-3.3a3.9 3.9 0 0 0-2.6-2.6l-3.3-1c-1.1-.4-1.1-1.9 0-2.2l3.3-1a3.9 3.9 0 0 0 2.6-2.6l1-3.3Z" />
              </svg>
              Remove AI Metadata ({eligible})
            </button>
            <span id="ws-remove-ai-help" className="sr-only">{aiReason}</span>
            <button
              type="button"
              onClick={props.onOpenRewrite}
              disabled={actionsDisabled}
              aria-describedby="ws-rewrite-help"
              data-testid="open-rewrite-workflow"
              title={rewriteReason}
              className="inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-[0.75rem] border border-slate-200 bg-white px-3.5 text-[13px] font-bold text-[#33415c] outline-offset-2 hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-3 focus-visible:outline-[#2d5be9] motion-safe:transition-colors disabled:cursor-not-allowed disabled:border-[#e6ebf3] disabled:text-[#9aa8c2]"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.5 5.5 18.5 9.5M4 20l1-4.2L16.2 4.6a1.9 1.9 0 0 1 2.7 0l0 0a1.9 1.9 0 0 1 0 2.7L7.8 18.5 4 20Z" />
              </svg>
              Remove &amp; Rewrite
            </button>
            <span id="ws-rewrite-help" className="sr-only">{rewriteReason}</span>
            <span className="sr-only" aria-live="polite">
              {unsupported > 0 ? `${unsupported} selected file${unsupported === 1 ? " is" : "s are"} review-only and excluded from removal.` : ""}
            </span>
          </div>

          {props.premiumNotice ? (
            <div
              className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2"
              data-testid="premium-notice"
              role="status"
            >
              <p className="min-w-0 flex-1 text-[12px] font-medium leading-4 text-amber-900">{props.premiumNotice}</p>
              <button
                type="button"
                data-testid="premium-notice-dismiss"
                onClick={props.onDismissPremiumNotice}
                className="rounded-md border border-amber-300 bg-white px-2 py-1 text-[11px] font-bold text-amber-900 hover:bg-amber-100"
              >
                Dismiss
              </button>
            </div>
          ) : null}
        </div>

        {props.rewriteProgress ? (
          <p role="status" className="mt-3 rounded-xl bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-900">{props.rewriteProgress}</p>
        ) : null}

        {/* File table + Queue summary sidebar. */}
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_19rem]">
          <div
            data-testid="queue-panel"
            className="min-w-0 self-start overflow-hidden rounded-[1.1rem] border border-[#e3e9f2] bg-white shadow-[0_1px_2px_rgba(15,23,42,.04)]"
          >
            <QueueList
              entries={props.entries}
              activeTool={props.activeTool}
              announcement={props.announcement}
              inspectionOf={props.inspectionOf}
              inspectionResultOf={props.inspectionResultOf}
              cleaningOf={props.cleaningOf}
              cleaningResultOf={props.cleaningResultOf}
              rewriteOf={props.rewriteOf}
              rewriteResultOf={props.rewriteResultOf}
              outputOf={props.outputOf}
              inspectingCount={props.inspectingCount}
              processingCount={props.processingCount}
              busy={props.busy}
              selectedOf={props.selectedOf}
              expandedOf={props.expandedOf}
              selectedCount={props.selectedCount}
              selectedCleanableCount={eligible}
              outputCount={props.outputCount}
              partialOptedInOf={props.partialOptedInOf}
              onToggleSelect={props.onToggleSelect}
              onToggleSelectAll={props.onToggleSelectAll}
              onToggleExpanded={props.onToggleExpanded}
              onOpenDetails={props.onOpenDetails}
              onOpenEditor={props.onOpenEditor}
              onChooseFiles={props.onFiles}
              onRemoveSelected={props.onRemoveSelected}
              onTogglePartial={props.onTogglePartial}
              onRetry={props.onRetry}
              onRemove={props.onRemove}
              onClear={props.onClear}
              onInspect={props.onInspect}
              onDownloadNotice={props.onDownloadNotice}
              onCancelInspections={props.onCancelInspections}
              onCancelProcessing={props.onCancelProcessing}
            />
          </div>
          <QueueSummary
            entries={props.entries}
            results={props.results}
            inspectingIds={props.inspectingIds}
            cleanedCount={props.outputCount}
          />
        </div>
      </section>

      {/* Verified outputs + Audit reports cards. */}
      <div className="mt-4 grid gap-4 xl:grid-cols-2" id="exports">
        <BatchPanel
          disabled={props.busy && !props.batchRunning && props.zip.phase !== "archiving"}
          running={props.batchRunning}
          done={props.batchDone}
          total={props.batchTotal}
          currentName={props.batchCurrentName}
          counts={props.batchCounts}
          zip={props.zip}
          partialExcluded={props.partialExcluded}
          includePartials={props.includeAllPartials}
          zipEligible={props.outputCount}
          reportFailure={props.reportFailure}
          failedCount={props.failedCount}
          onCancel={props.onCancelBatch}
          onCancelZip={props.onCancelZip}
          onRetryFailed={props.onRetryFailed}
          onTogglePartials={props.onTogglePartials}
          onDownloadZip={props.onDownloadZip}
          onDownloadZipBare={props.onDownloadZipBare}
        />
        <ReportsPanel
          format={props.reportChoices.format}
          detail={props.reportChoices.detail}
          includeOriginalValues={props.reportChoices.includeOriginalValues}
          generating={props.reportGenerating}
          progress={props.reportProgress}
          error={props.reportError}
          fileCount={props.entries.length}
          disabled={props.reportDisabled}
          onChoices={props.onReportChoices}
          onDownloadCsv={props.onDownloadCsv}
          onDownloadTags={props.onDownloadTags}
          onDownloadPdf={props.onDownloadPdf}
          onCancel={props.onCancelReport}
        />
      </div>

      {/* Compact file-support strip. */}
      <div id="formats" className="mt-4 scroll-mt-24">
        <WorkFormatsStrip />
      </div>
    </div>
  );
}

/** Screen 04's compact "File support" strip (same content as the landing disclosure). */
function WorkFormatsStrip() {
  return (
    <section aria-labelledby="formats-heading" className="pb-2">
      <details className="surface-card group rounded-[1.1rem] p-3.5">
        <summary className="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.7rem] bg-[#eef2f7] text-[#43536e]" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13.3 3H7.1A1.8 1.8 0 0 0 5.3 4.8v14.4a1.8 1.8 0 0 0 1.8 1.8h9.8a1.8 1.8 0 0 0 1.8-1.8V8.3L13.3 3Z" />
              <path d="M13.3 3v5.3h5.4" />
            </svg>
          </span>
          <span id="formats-heading" className="text-[14.5px] font-extrabold tracking-[-0.01em] text-[#16244a]">File support</span>
          <span className="text-[12.5px] font-semibold text-[#5a6b85]">JPEG · PNG · WebP · AVIF · HEIC</span>
          <span className="ml-auto text-[12.5px] font-bold text-[#2d5be9] group-open:hidden">View details</span>
          <span className="ml-auto hidden text-[12.5px] font-bold text-[#2d5be9] group-open:block">Hide details</span>
        </summary>
        <ul className="mt-3.5 grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          {FORMAT_ROWS.map((row) => (
            <li key={row.ext} className="rounded-xl border border-[#e6eaf2] bg-white p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-[13px] font-bold text-[#16244a]">{row.ext}</p>
                <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-bold", row.ready ? "bg-[#e4f6ec] text-[#0a7a58]" : "bg-amber-50 text-amber-800")}>
                  {row.status}
                </span>
              </div>
              <p className="mt-2 text-[11.5px] leading-5 text-[#5f6c85]">{row.note}</p>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

const FORMAT_ROWS = [
  { ext: "JPG / JPEG", status: "Inspect + clean", note: "EXIF, GPS, XMP, IPTC and comments. Orientation and color data are preserved when needed.", ready: true },
  { ext: "PNG", status: "Inspect + clean", note: "EXIF and text chunks are removed without re-encoding the image.", ready: true },
  { ext: "WebP", status: "Inspect + clean", note: "Still images are supported. Animated WebP is identified and safely refused.", ready: true },
  { ext: "AVIF", status: "Inspect + clean", note: "Supported still-image layouts keep encoded image payloads unchanged.", ready: true },
  { ext: "HEIC / HEIF", status: "Preview + clean", note: "A local decoder provides the preview. Tested still layouts can be cleaned without changing the image payload.", ready: true },
  { ext: "MP4 / MOV / WebM", status: "Preview only", note: "Files may be queued, but video metadata inspection and cleaning are not available yet.", ready: false },
];
