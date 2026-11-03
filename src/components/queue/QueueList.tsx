"use client";

import QueueItem, { type QueueDownloadOutput, ROW_GRID } from "./QueueItem";
import QueueToolbar from "./QueueToolbar";
import type { CleaningStatus, FileCleaningResult } from "../../lib/metadata/clean/types";
import type { FileRewriteResult, RewriteStatus } from "../../lib/metadata/rewrite/rewrite";
import type { WorkspaceTool } from "../../lib/workspace/actions";
import type { ImageInspectionResult, InspectionOutcome } from "../../types/inspection";
import type { QueueEntry } from "../../types/media";

export const MAX_AUTO_PREVIEWS = 60;

interface QueueListProps {
  entries: QueueEntry[];
  activeTool: WorkspaceTool;
  announcement: string;
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
  selectedOf: (id: string) => boolean;
  expandedOf: (id: string) => boolean;
  selectedCount: number;
  selectedCleanableCount: number;
  outputCount: number;
  partialOptedInOf: (id: string) => boolean;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onToggleExpanded: (id: string) => void;
  onOpenDetails: (id: string) => void;
  onOpenEditor: (id: string) => void;
  onChooseFiles: (files: File[]) => void;
  onRemoveSelected: () => void;
  onTogglePartial: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onInspect: (id: string) => void;
  onDownloadNotice: (name: string) => void;
  onCancelInspections: () => void;
  onCancelProcessing: () => void;
}

/**
 * Screen 04 file list: toolbar row, column headers and the structured
 * file table. The removal actions themselves live in the workspace card
 * header (see AfterUploadWorkspace); this component owns the list, its
 * selection state wiring and the honest per-row statuses.
 */
export default function QueueList(props: QueueListProps) {
  const {
    entries, activeTool, announcement, inspectionOf, inspectionResultOf, cleaningOf,
    cleaningResultOf, rewriteOf, rewriteResultOf, outputOf, inspectingCount, processingCount,
    busy, selectedOf, expandedOf, selectedCount, selectedCleanableCount,
    outputCount, partialOptedInOf, onToggleSelect, onToggleSelectAll, onToggleExpanded,
    onOpenDetails, onOpenEditor, onChooseFiles, onRemoveSelected, onTogglePartial, onRetry, onRemove, onClear, onInspect,
    onDownloadNotice, onCancelInspections, onCancelProcessing,
  } = props;
  const allSelected = entries.length > 0 && selectedCount === entries.length;
  const selectedUnsupportedCount = Math.max(0, selectedCount - selectedCleanableCount);

  // The upload surface is the empty state. Keeping the list out of the
  // DOM until a file exists avoids disabled “(0)” actions and an empty
  // control bar competing with the primary upload action.
  if (entries.length === 0) return null;

  return (
    <section aria-labelledby="queue-heading" className="min-w-0">
      <h2 id="queue-heading" className="sr-only">Queue file list</h2>
      <div role="status" aria-live="polite" className="sr-only">{announcement}</div>
      {announcement ? <p className="border-b border-[#edf1f7] bg-blue-50/60 px-4 py-2.5 text-xs font-medium text-blue-900 sm:px-5" data-testid="queue-announcement">{announcement}</p> : null}

      <QueueToolbar
        allSelected={allSelected}
        busy={busy}
        selectedCount={selectedCount}
        selectedUnsupportedCount={selectedUnsupportedCount}
        workCount={inspectingCount + processingCount}
        onToggleSelectAll={onToggleSelectAll}
        onChooseFiles={onChooseFiles}
        onRemoveSelected={onRemoveSelected}
        onClear={onClear}
        onCancelWork={() => {
          if (inspectingCount > 0) onCancelInspections();
          if (processingCount > 0) onCancelProcessing();
        }}
      />

      {/* Column headers: same 4-column template as every row. */}
      <div className={`hidden gap-2.5 border-b border-[#e8edf4] bg-[#f8fafd] px-4 py-2.5 text-[11.5px] font-bold text-slate-500 lg:grid xl:px-5 ${ROW_GRID}`}>
        <span aria-hidden="true" />
        <span>File</span>
        <span>Detected metadata</span>
        <span className="text-right">Actions</span>
      </div>

      <ul data-testid="queue-list" className="grid">
        {entries.map((entry, index) => (
          <QueueItem
            key={entry.item.id}
            entry={entry}
            autoPreview={index < MAX_AUTO_PREVIEWS}
            activeTool={activeTool}
            expanded={expandedOf(entry.item.id)}
            inspectionState={inspectionOf(entry.item.id)}
            inspectionResult={inspectionResultOf(entry.item.id)}
            cleaningState={cleaningOf(entry.item.id)}
            cleaningResult={cleaningResultOf(entry.item.id)}
            rewriteState={rewriteOf(entry.item.id)}
            rewriteResult={rewriteResultOf(entry.item.id)}
            downloadOutput={outputOf(entry.item.id)}
            busy={busy}
            selected={selectedOf(entry.item.id)}
            partialOptedIn={partialOptedInOf(entry.item.id)}
            onToggleSelect={onToggleSelect}
            onToggleExpanded={onToggleExpanded}
            onOpenDetails={onOpenDetails}
            onOpenEditor={onOpenEditor}
            onTogglePartial={onTogglePartial}
            onRetry={onRetry}
            onRemove={onRemove}
            onInspect={onInspect}
            onDownloadNotice={onDownloadNotice}
          />
        ))}
      </ul>
      <p className="sr-only">
        {outputCount} file{outputCount === 1 ? "" : "s"} currently have verified downloadable outputs.
      </p>
    </section>
  );
}
