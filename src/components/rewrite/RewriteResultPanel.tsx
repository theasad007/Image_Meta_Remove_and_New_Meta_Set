"use client";

import { isRewriteDownloadable, type FileRewriteResult } from "../../lib/metadata/rewrite/rewrite";
import { CategorySection } from "../inspector/InspectorPanel";

/**
 * Rewrite result evidence (Phase 6): requested vs actual vs verified per
 * field, preserved/unsupported disclosure, C2PA honesty, and a
 * `-rewritten` download offered only for verified/partial outputs.
 */
export default function RewriteResultPanel({
  result,
  onClose,
  onDownload,
}: {
  result: FileRewriteResult;
  onClose: () => void;
  onDownload: (result: FileRewriteResult) => void;
}) {
  const downloadable = isRewriteDownloadable(result.status) && result.output !== undefined;

  const handleDownload = () => {
    if (!downloadable || !result.output) return;
    const url = URL.createObjectURL(result.output);
    try {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.outputName ?? "rewritten-image";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
    onDownload(result);
  };

  const verified = result.changes.filter((c) => c.action === "rewritten" && c.verification === "verified").length;
  const unsupported = result.changes.filter((c) => c.action === "retained_unsupported").length;

  return (
    <section
      aria-labelledby="rewrite-result-heading"
      data-testid="rewrite-result-panel"
      className="surface-card mt-6 rounded-[1.5rem] p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="rewrite-result-heading" className="text-base font-semibold">
          Rewrite result: <span className="break-all">{result.inputName}</span>
        </h2>
        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs font-semibold text-white">
          {result.status.replace(/_/g, " ")}
        </span>
        <button type="button" onClick={onClose} className="btn-secondary ml-auto !min-h-9 !px-3 !py-1.5">
          Close
        </button>
      </div>

      <p className="mt-2 text-xs text-slate-600">
        Format preserved: <strong>{result.detectedFormat}</strong>
        {result.detectedBrand ? ` (${result.detectedBrand})` : ""} ·{" "}
        {result.inputBytes} → {result.outputBytes ?? "?"} bytes · mode {result.mode.replace(/_/g, " ")} ·{" "}
        {result.requestedFields.length} field(s) requested ({result.requestedFields.join(", ") || "none"})
      </p>
      <p className="mt-1 text-xs text-slate-600">
        {verified} field{verified === 1 ? "" : "s"} verified rewritten · {unsupported} unsupported retention{unsupported === 1 ? "" : "s"}.
        Never a forged C2PA manifest or an AI-invisibility claim.
      </p>
      {result.status === "partially_rewritten" ? (
        <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs font-medium text-amber-800">
          Partial rewrite: some requested fields could not be written or verified (see below). Unsupported
          layouts/fields are disclosed, never silently converted.
        </p>
      ) : null}
      {result.errors.map((error) => (
        <p key={error.slice(0, 80)} className="mt-1 text-xs text-red-700">✖ {error}</p>
      ))}
      {result.warnings.map((warning) => (
        <p key={warning.slice(0, 80)} className="mt-1 text-xs text-amber-800">⚠ {warning}</p>
      ))}

      <h3 className="mt-4 text-sm font-semibold">Per-field evidence (requested → observed → verification)</h3>
      <ul className="mt-2 grid gap-1">
        {result.changes.map((change, index) => (
          <li
            key={`${change.group}:${change.key ?? index}`}
            className="grid gap-1 border-t border-slate-200 py-2 text-xs sm:grid-cols-[minmax(0,10rem)_1fr_auto] sm:items-baseline sm:gap-2"
          >
            <span className="break-words font-medium text-slate-700">
              {change.group}
              {change.key ? <span className="text-slate-500"> · {change.key}</span> : null}
            </span>
            <span className="break-words text-slate-600">
              {change.action.replace(/_/g, " ")}
              {change.after ? ` → ${change.after.slice(0, 160)}` : ""}
              {change.reason ? ` — ${change.reason}` : ""}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                change.verification === "verified"
                  ? "bg-blue-50 text-blue-800"
                  : change.verification === "failed"
                    ? "bg-red-50 text-red-700"
                    : "bg-amber-50 text-amber-800"
              }`}
            >
              {change.verification.replace(/_/g, " ")}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-4 grid gap-2 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold">Before ({result.before.categories.length} groups)</h3>
          <div className="mt-2 grid gap-2">
            {result.before.categories.map((category) => (
              <CategorySection key={category.category} category={category} open={false} />
            ))}
          </div>
        </div>
        <div>
          <h3 className="text-sm font-semibold">
            After{result.after ? ` (${result.after.categories.length} groups)` : " (unavailable)"}
          </h3>
          <div className="mt-2 grid gap-2">
            {result.after
              ? result.after.categories.map((category) => (
                  <CategorySection key={category.category} category={category} open={false} />
                ))
              : (
                <p className="text-xs text-slate-500">No output inspection — nothing is claimed about the output.</p>
                )}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {downloadable ? (
          <button type="button" onClick={handleDownload} data-testid="download-rewritten" className="btn-success">
            Download rewritten image{result.status === "partially_rewritten" ? " (partial — see warnings)" : ""}
          </button>
        ) : (
          <button
            type="button"
            disabled
            title="No verified rewrite output is available for download."
            aria-disabled="true"
            className="cursor-not-allowed rounded-lg bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-500"
          >
            Download unavailable ({result.status.replace(/_/g, " ")})
          </button>
        )}
        <span className="text-[11px] text-slate-500">
          {result.outputName} · original and any cleaned output stay in the queue untouched
        </span>
      </div>
    </section>
  );
}
