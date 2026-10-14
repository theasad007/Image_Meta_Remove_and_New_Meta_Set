"use client";

import type { ReportDetail, ReportFormat } from "../../types/reporting";

/**
 * Report choices + standalone downloads (Phase 5).
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
  const set = (patch: Partial<ReportChoices>) =>
    onChoices({ format, detail, includeOriginalValues, ...patch });
  const busy = generating !== null;
  const controlsDisabled = busy || disabled;

  return (
    <section aria-labelledby="reports-heading" className="surface-card mt-6 rounded-[1.5rem] p-4 sm:p-6">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#eef2ff] text-[#3157d5]">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none">
            <path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
            <path d="M14 3.5v4h4M9 12h6m-6 3h6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
          </svg>
        </span>
        <div>
          <h2 id="reports-heading" className="text-lg font-extrabold tracking-[-0.015em] text-slate-950">Audit reports</h2>
          <p className="mt-1 text-sm text-slate-600">Export a privacy-safe summary, or include it alongside your ZIP.</p>
        </div>
        <span className="ml-auto rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">Local generation</span>
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-500">Every queued file is included. Original values stay hidden unless you opt in; browser C2PA validation results are recorded when available.</p>

      <fieldset className="mt-3">
        <legend className="text-xs font-semibold text-slate-700">Include in ZIP</legend>
        <div className="mt-1 grid gap-2 sm:grid-cols-4">
          {FORMATS.map((option) => (
            <label
              key={option.value}
              className={`cursor-pointer rounded-xl border px-3 py-2 text-sm ${format === option.value ? "border-blue-600 bg-blue-50" : "border-slate-200 hover:bg-slate-50"}`}
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
              <span className="block text-[11px] text-slate-500">{option.hint}</span>
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
        <label className="flex cursor-pointer items-start gap-2 text-xs text-slate-700">
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

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <button
          type="button"
          onClick={onDownloadCsv}
          disabled={controlsDisabled || fileCount === 0}
          data-testid="download-csv"
          className="btn-secondary"
        >
          Download CSV
        </button>
        {detail === "detailed" ? (
          <button
            type="button"
            onClick={onDownloadTags}
            disabled={controlsDisabled || fileCount === 0}
            data-testid="download-tags"
            className="btn-secondary"
          >
            Download tag ledger
          </button>
        ) : null}
        <button
          type="button"
          onClick={onDownloadPdf}
          disabled={controlsDisabled || fileCount === 0}
          data-testid="download-pdf"
          className="btn-secondary"
        >
          Download PDF
        </button>
        {busy ? (
          <button
            type="button"
            onClick={onCancel}
            data-testid="report-cancel"
            className="btn-secondary !border-amber-300 !bg-amber-50 !text-amber-800"
          >
            Cancel ({generating})
          </button>
        ) : null}
        {progress ? (
          <span data-testid="report-progress" className="text-xs text-slate-600" role="status">
            {progress}
          </span>
        ) : null}
        {error ? (
          <span data-testid="report-error" className="text-xs text-red-700" role="alert">
            {error}
          </span>
        ) : null}
      </div>
    </section>
  );
}
