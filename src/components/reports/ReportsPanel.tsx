"use client";

import { useId } from "react";
import type { ReportDetail, ReportFormat } from "../../types/reporting";

/**
 * Report choices + standalone downloads (Phase 5), restyled as the
 * Screen 04 "Audit reports" card. The working options are preserved and
 * grouped inside a disclosure ("Report options") to keep the card as
 * compact as the reference; the CSV/PDF actions stay directly visible.
 *
 * Defaults protect privacy (summary, values hidden). Every option is
 * guest-accessible; nothing here needs an account or uploads anything.
 */
export interface ReportChoices {
  format: ReportFormat;
  detail: ReportDetail;
  includeOriginalValues: boolean;
}

interface ReportsPanelProps extends ReportChoices {
  generating: string | null;
  progress: string | null;
  error: string | null;
  fileCount: number;
  disabled: boolean;
  onChoices: (choices: ReportChoices) => void;
  onDownloadCsv: () => void;
  onDownloadTags: () => void;
  onDownloadPdf: () => void;
  onCancel: () => void;
}

const FORMATS: { value: ReportFormat; label: string; hint: string }[] = [
  { value: "none", label: "None", hint: "ZIP carries images only" },
  { value: "csv", label: "CSV", hint: "adds metadata-report.csv (+tags ledger when detailed)" },
  { value: "pdf", label: "PDF", hint: "adds metadata-report.pdf" },
  { value: "both", label: "CSV + PDF", hint: "adds all three report files" },
];

export default function ReportsPanel(props: ReportsPanelProps) {
  const {
    format, detail, includeOriginalValues,
    generating, progress, error, fileCount, disabled,
    onChoices, onDownloadCsv, onDownloadTags, onDownloadPdf, onCancel,
  } = props;
  const optionsId = useId();
  const set = (patch: Partial<ReportChoices>) =>
    onChoices({ format, detail, includeOriginalValues, ...patch });
  const busy = generating !== null;
  const controlsDisabled = busy || disabled;

  return (
    <section aria-labelledby="reports-heading" className="surface-card rounded-[1.25rem] p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#e9f2fe] text-[#2d5be9]" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-5.5 w-5.5" fill="none">
            <path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
            <path d="M14 3.5v4h4M9 12h6m-6 3h6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
          </svg>
        </span>
        <div className="min-w-0">
          <h2 id="reports-heading" className="text-[1.05rem] font-extrabold tracking-[-0.015em] text-slate-950">Audit reports</h2>
          <p className="mt-0.5 text-[12.5px] text-slate-500">Export a privacy-safe summary or include it alongside your ZIP.</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onDownloadCsv}
            disabled={controlsDisabled || fileCount === 0}
            data-testid="download-csv"
            className="btn-secondary !min-h-10 !px-3.5 text-[12.5px]"
          >
            Download CSV
          </button>
          <button
            type="button"
            onClick={onDownloadPdf}
            disabled={controlsDisabled || fileCount === 0}
            data-testid="download-pdf"
            className="btn-secondary !min-h-10 !px-3.5 text-[12.5px]"
          >
            Download PDF
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {detail === "detailed" ? (
          <button
            type="button"
            onClick={onDownloadTags}
            disabled={controlsDisabled || fileCount === 0}
            data-testid="download-tags"
            className="btn-secondary !min-h-8 !px-2.5 !py-1 text-[11.5px]"
          >
            Download tag ledger
          </button>
        ) : null}
        {busy ? (
          <button
            type="button"
            onClick={onCancel}
            data-testid="report-cancel"
            className="btn-secondary !min-h-8 !border-amber-300 !bg-amber-50 !px-2.5 !py-1 text-[11.5px] !text-amber-800"
          >
            Cancel ({generating})
          </button>
        ) : null}
        {progress ? (
          <span data-testid="report-progress" className="text-[12px] text-slate-600" role="status">
            {progress}
          </span>
        ) : null}
        {error ? (
          <span data-testid="report-error" className="text-[12px] text-red-700" role="alert">
            {error}
          </span>
        ) : null}
        {!progress && !error && !busy ? (
          <span className="text-[12px] text-slate-500">
            Reports reflect the real inspection and processing data for every queued file.
          </span>
        ) : null}
      </div>

      <details className="group mt-3 rounded-xl border border-slate-200 bg-slate-50/60 open:bg-white" data-testid="report-options">
        <summary
          data-testid="report-options-toggle"
          aria-controls={optionsId}
          className="flex min-h-9 cursor-pointer list-none items-center gap-2 px-3 text-[12.5px] font-bold text-slate-700 [&::-webkit-details-marker]:hidden"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 text-slate-500 motion-safe:transition-transform group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 5.5 6.5 6.5L9 18.5" />
          </svg>
          Report options
          <span className="ml-auto text-[11px] font-semibold text-slate-400">
            {format === "none" ? "ZIP: images only" : format === "both" ? "ZIP: CSV + PDF" : `ZIP: ${format}`}
            {" · "}{detail}{includeOriginalValues ? " · values shown" : " · values hidden"}
          </span>
        </summary>
        <div id={optionsId} className="border-t border-slate-100 p-3">
          <fieldset>
            <legend className="text-xs font-semibold text-slate-700">Include in ZIP</legend>
            <div className="mt-1.5 grid gap-2 sm:grid-cols-4">
              {FORMATS.map((option) => (
                <label
                  key={option.value}
                  className={`cursor-pointer rounded-xl border px-3 py-2 text-sm ${format === option.value ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                >
                  <input
                    type="radio"
                    name="report-format"
                    value={option.value}
                    checked={format === option.value}
                    disabled={controlsDisabled}
                    onChange={() => set({ format: option.value })}
                    className="mr-2 accent-blue-600"
                  />
                  <span className="font-semibold">{option.label}</span>
                  <span className="mt-0.5 block text-[11px] text-slate-500">{option.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-3 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-slate-700">
              Detail
              <select
                value={detail}
                disabled={controlsDisabled}
                onChange={(event) => set({ detail: event.target.value as ReportDetail })}
                data-testid="report-detail"
                className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
              >
                <option value="summary">Summary</option>
                <option value="detailed">Detailed (+ tag ledger)</option>
              </select>
            </label>
            <label className="flex max-w-xl cursor-pointer items-start gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={includeOriginalValues}
                disabled={controlsDisabled}
                onChange={(event) => set({ includeOriginalValues: event.target.checked })}
                data-testid="report-include-values"
                className="mt-0.5 h-4 w-4 accent-blue-600"
              />
              <span>
                Include original metadata values (may expose GPS coordinates, names, dates, serials, or prompt text).
                Off by default.
              </span>
            </label>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-slate-500">
            Every queued file is included. Original values stay hidden unless you opt in; browser C2PA validation results are recorded when available.
          </p>
        </div>
      </details>
    </section>
  );
}
