"use client";

import type { BatchCounts, ZipBuildState } from "../../types/batch";

/**
 * Bulk controls + honest progress (Phase 4).
 *
 * Every number derives from completed work: `done/total` from the scheduler,
 * outcome counts from committed `FileCleaningResult`s. Archive progress is a
 * separate phase that only completes when the ZIP finalizes extractably.
 */
interface BatchPanelProps {
  disabled: boolean;
  running: boolean;
  done: number;
  total: number;
  currentName: string | null;
  counts: BatchCounts;
  zip: ZipBuildState;
  partialExcluded: number;
  includePartials: boolean;
  zipEligible: number;
  reportFailure: string | null;
  onCancel: () => void;
  onCancelZip: () => void;
  onRetryFailed: () => void;
  onTogglePartials: () => void;
  onDownloadZip: () => void;
  onDownloadZipBare: () => void;
  failedCount: number;
}

export default function BatchPanel(props: BatchPanelProps) {
  const {
    disabled, running, done, total, currentName, counts, zip,
    partialExcluded, includePartials, zipEligible, reportFailure,
    onCancel, onCancelZip, onRetryFailed,
    onTogglePartials, onDownloadZip, onDownloadZipBare, failedCount,
  } = props;
  return (
    <section aria-labelledby="batch-heading" className="surface-card mt-6 rounded-[1.5rem] p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="section-kicker">Verified outputs</p>
          <h2 id="batch-heading" className="mt-1 text-lg font-extrabold tracking-[-0.02em] text-slate-950">
            Download cleaned images
          </h2>
          <p className="mt-1 text-xs text-slate-500">Only successfully verified files are available here.</p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {running ? (
            <button
              type="button"
              onClick={onCancel}
              data-testid="batch-cancel"
              className="btn-secondary !border-amber-300 !bg-amber-50 !text-amber-800"
            >
              Cancel batch
            </button>
          ) : zip.phase === "archiving" ? (
            <button
              type="button"
              onClick={onCancelZip}
              data-testid="zip-cancel"
              className="btn-secondary !border-amber-300 !bg-amber-50 !text-amber-800"
            >
              Cancel ZIP
            </button>
          ) : failedCount > 0 ? <button type="button" onClick={onRetryFailed} disabled={disabled} data-testid="batch-retry" className="btn-secondary">Retry failed ({failedCount})</button> : null}
        </div>
      </div>

      {total > 0 ? (
        <div className="mt-5" role="status" aria-live="off">
          <progress className="h-2 w-full overflow-hidden rounded-full accent-[#0d9474]" value={done} max={total} aria-label={`${done} of ${total} files processed`} />
          <p data-testid="batch-progress" className="mt-2 text-sm text-slate-600">
            {done} of {total} files processed · {counts.verified} verified · {counts.unchanged} unchanged ·{" "}
            {counts.partial} partial · {counts.failed} failed · {counts.unsupported} unsupported
            {counts.cancelled > 0 ? ` · ${counts.cancelled} cancelled` : ""}
            {running && currentName ? ` · now: ${currentName}` : ""}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-500">Clean one image or use the bulk controls above the file table.</p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={includePartials}
            onChange={onTogglePartials}
            data-testid="zip-include-partials"
            className="h-4 w-4 accent-emerald-600"
          />
          Include partial outputs in ZIP (off by default)
        </label>
        <span className="text-sm text-slate-500">
          {zipEligible} eligible · {partialExcluded} partial excluded
        </span>
        <div className="ml-auto flex items-center gap-2">
          {zip.phase === "archiving" ? (
            <span data-testid="zip-progress" className="text-sm text-slate-600" role="status">
              Archiving {zip.filesDone} of {zip.filesTotal}…
            </span>
          ) : null}
          {zip.phase === "failed" ? (
            <span data-testid="zip-error" className="text-sm text-red-700" role="alert">
              ZIP failed: {zip.error}
            </span>
          ) : null}
          {reportFailure ? (
            <span className="flex flex-wrap items-center gap-2 text-sm text-red-700" role="alert">
              Report failed: {reportFailure}
              <button
                type="button"
                onClick={onDownloadZipBare}
                data-testid="download-zip-bare"
                className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                Download ZIP without reports
              </button>
            </span>
          ) : null}
          {zip.phase === "ready" ? (
            <span data-testid="zip-ready" className="text-sm font-bold text-emerald-800">
              ZIP ready: {zip.entryCount} files{zip.archiveBytes ? ` · ${(zip.archiveBytes / 1048576).toFixed(2)} MB` : ""}
            </span>
          ) : null}
          <button
            type="button"
            onClick={onDownloadZip}
            disabled={disabled || running || zipEligible === 0 || zip.phase === "archiving"}
            data-testid="download-zip"
            title={zipEligible === 0 ? "No eligible verified outputs yet." : `Download ${zipEligible} verified output(s) as ZIP.`}
            className="btn-primary"
          >
            Download ZIP{zipEligible > 0 ? ` (${zipEligible})` : ""}
          </button>
        </div>
      </div>
    </section>
  );
}
