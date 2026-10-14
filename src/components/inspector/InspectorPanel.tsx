"use client";

import { AI_INDICATOR_DISCLAIMER } from "../../lib/metadata/inspect/ai-indicators";
import type {
  ImageInspectionResult,
  InspectionCategoryResult,
} from "../../types/inspection";

const OUTCOME_STYLES: Record<string, string> = {
  completed: "bg-blue-50 text-blue-800",
  partial: "bg-amber-50 text-amber-800",
  failed: "bg-red-50 text-red-700",
  unsupported: "bg-slate-100 text-slate-600",
  cancelled: "bg-slate-100 text-slate-600",
};

const STATUS_STYLES: Record<string, string> = {
  detected: "bg-blue-50 text-blue-800",
  not_detected: "bg-slate-100 text-slate-600",
  not_inspected: "bg-slate-100 text-slate-500",
  unsupported: "bg-slate-100 text-slate-500",
  uncertain: "bg-amber-50 text-amber-800",
  failed: "bg-red-50 text-red-700",
};

function StatusPill({ value }: { value: string }) {
  const label = value.replace(/_/g, " ");
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${STATUS_STYLES[value] ?? "bg-slate-100 text-slate-600"}`}
    >
      {label}
    </span>
  );
}

export function CategorySection({
  category,
  open,
}: {
  category: InspectionCategoryResult;
  open: boolean;
}) {
  return (
    <details
      open={open}
      className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,.03)]"
    >
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-semibold">
        {category.category}
        <StatusPill value={category.status} />
        <span className="ml-auto text-xs font-normal text-slate-500">
          {category.tags.length} tag{category.tags.length === 1 ? "" : "s"}
          {category.reader ? ` · ${category.reader}` : ""}
        </span>
      </summary>
      {category.warnings.map((warning) => (
        <p key={warning.slice(0, 80)} className="mt-2 text-xs text-slate-600">
          ⚠ {warning}
        </p>
      ))}
      {category.tags.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">
          {category.status === "not_detected"
            ? "Inspected — nothing in this group."
            : "Nothing to show for this group."}
        </p>
      ) : (
        <dl className="mt-2 grid gap-1">
          {category.tags.map((tag) => (
            <div
              key={`${tag.group}:${tag.key}`}
              className="grid gap-1 border-t border-slate-100 py-2 text-xs sm:grid-cols-[minmax(0,12rem)_1fr] sm:gap-3"
            >
              <dt className="break-words font-medium text-slate-700" title={tag.key}>
                {tag.namespace ? (
                  <span className="mr-1 rounded bg-slate-100 px-1 font-mono text-[10px] text-slate-500">
                    {tag.namespace}
                  </span>
                ) : null}
                {tag.key}
                {tag.technical ? (
                  <span className="ml-1 text-[10px] font-normal text-slate-400">(technical)</span>
                ) : null}
              </dt>
              <dd className="break-words text-slate-800" title={tag.displayedValue}>
                {tag.displayedValue === "" ? <span className="text-slate-400">—</span> : tag.displayedValue}
                {tag.truncated ? <span className="text-slate-400"> (truncated)</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </details>
  );
}

export default function InspectorPanel({
  result,
  onClose,
}: {
  result: ImageInspectionResult;
  onClose: () => void;
}) {
  return (
    <section
      aria-labelledby="inspector-heading"
      data-testid="inspector-panel"
      className="surface-card mt-6 rounded-[1.5rem] p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="inspector-heading" className="text-base font-semibold">
          Inspection: <span className="break-all">{result.fileName}</span>
        </h2>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${OUTCOME_STYLES[result.outcome] ?? "bg-slate-100"}`}
        >
          {result.outcome}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="btn-secondary ml-auto !min-h-9 !px-3 !py-1.5"
        >
          Close
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-600">
        True format from bytes: <strong>{result.detectedFormat ?? "?"}</strong>
        {result.detectedBrand ? ` (brand ${result.detectedBrand})` : ""}
        {result.declaredFormat ? ` · name suggested .${result.declaredFormat}` : ""} ·{" "}
        {result.bytes} bytes · inspected {result.inspectedAt}
      </p>
      {result.warnings.map((warning) => (
        <p key={warning.slice(0, 80)} className="mt-1 text-xs text-amber-800">
          ⚠ {warning}
        </p>
      ))}

      <div className="mt-4">
        <h3 className="text-sm font-semibold">AI-associated indicators</h3>
        {result.aiIndicators.length === 0 ? (
          <p className="mt-1 text-xs text-slate-600">
            No AI-associated metadata indicators found. {AI_INDICATOR_DISCLAIMER}
          </p>
        ) : (
          <>
            <ul className="mt-2 grid gap-2">
              {result.aiIndicators.map((indicator) => (
                <li
                  key={`${indicator.evidenceGroup}:${indicator.evidenceKey}`}
                  className="rounded-xl border border-violet-200 bg-white p-3 text-xs"
                >
                  <p className="font-semibold">
                    {indicator.label}{" "}
                    <span className="rounded-full bg-violet-50 px-2 py-0.5 font-medium text-violet-800">
                      {indicator.confidence}
                    </span>
                  </p>
                  <p className="mt-1 break-words text-slate-700">
                    Evidence: {indicator.evidenceGroup} · {indicator.evidenceKey} = “
                    {indicator.matchedValue}”
                  </p>
                  <p className="mt-1 text-slate-600">{indicator.explanation}</p>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs font-medium text-slate-700">{AI_INDICATOR_DISCLAIMER}</p>
          </>
        )}
      </div>

      <div className="mt-4 grid gap-2">
        {result.categories.map((category, index) => (
          <CategorySection key={category.category} category={category} open={index === 0} />
        ))}
      </div>
      <p className="mt-3 text-[11px] text-slate-500">
        GPS coordinates, where shown, are file metadata only — no place names
        are derived and no map is shown in this phase.
      </p>
    </section>
  );
}
