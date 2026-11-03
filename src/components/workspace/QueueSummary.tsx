"use client";

import { aggregateQueue } from "../../lib/workspace/summary";
import type { ImageInspectionResult } from "../../types/inspection";
import type { QueueEntry } from "../../types/media";

interface QueueSummaryProps {
  entries: QueueEntry[];
  results: Record<string, ImageInspectionResult>;
  inspectingIds: string[];
  cleanedCount?: number;
}

const ICON_STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
} as const;

type Row = {
  key: string;
  label: string;
  value: number;
  icon: React.ReactNode;
};

/**
 * Screen 04 right sidebar. Values come from the tested, pure aggregations
 * in `lib/workspace/summary.ts`: ONLY files with an actual inspection
 * result feed the numbers, unsupported/failed files never fold into 0,
 * and "GPS locations" / "C2PA manifests" count files, not tags.
 */
export default function QueueSummary({ entries, results, inspectingIds, cleanedCount = 0 }: QueueSummaryProps) {
  const totals = aggregateQueue(entries, results);

  const rows: Row[] = [
    {
      key: "ai",
      label: "AI indicators",
      value: totals.aiIndicators,
      icon: (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
          <path d="M9.4 4c.4-1.15 2-1.15 2.4 0l1.1 3.6a4.2 4.2 0 0 0 2.8 2.8l3.6 1.1c1.15.4 1.15 2 0 2.4l-3.6 1.1a4.2 4.2 0 0 0-2.8 2.8l-1.1 3.6c-.4 1.15-2 1.15-2.4 0l-1.1-3.6a4.2 4.2 0 0 0-2.8-2.8l-3.6-1.1c-1.15-.4-1.15-2 0-2.4l3.6-1.1a4.2 4.2 0 0 0 2.8-2.8L9.4 4Z" />
        </svg>
      ),
    },
    {
      key: "c2pa",
      label: "C2PA manifests",
      value: totals.c2paManifests,
      icon: (
        <svg viewBox="0 0 24 24" className="h-4 w-4" {...ICON_STROKE} aria-hidden="true">
          <circle cx="12" cy="12" r="8.2" />
          <path d="m8.8 12.2 2.2 2.2 4.2-4.6" />
        </svg>
      ),
    },
    {
      key: "exif",
      label: "EXIF tags",
      value: totals.exifTags,
      icon: (
        <svg viewBox="0 0 24 24" className="h-4 w-4" {...ICON_STROKE} aria-hidden="true">
          <path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
          <path d="M14 3.5v4h4M9.5 12h5m-5 3h5" />
        </svg>
      ),
    },
    {
      key: "gps",
      label: "GPS locations",
      value: totals.gpsLocations,
      icon: (
        <svg viewBox="0 0 24 24" className="h-4 w-4" {...ICON_STROKE} aria-hidden="true">
          <path d="M12 21s-6.7-5.4-6.7-10.2a6.7 6.7 0 0 1 13.4 0C18.7 15.6 12 21 12 21Z" />
          <circle cx="12" cy="10.6" r="2.4" />
        </svg>
      ),
    },
    {
      key: "xmp",
      label: "XMP tags",
      value: totals.xmpTags,
      icon: (
        <svg viewBox="0 0 24 24" className="h-4 w-4" {...ICON_STROKE} aria-hidden="true">
          <path d="m12 3.8 8.5 4.4L12 12.6 3.5 8.2 12 3.8Z" />
          <path d="m3.5 12.4 8.5 4.4 8.5-4.4" opacity=".6" />
        </svg>
      ),
    },
    {
      key: "iptc",
      label: "IPTC tags",
      value: totals.iptcTags,
      icon: (
        <svg viewBox="0 0 24 24" className="h-4 w-4" {...ICON_STROKE} aria-hidden="true">
          <path d="M4 5.5h16v6.2a2 2 0 0 1-.6 1.4l-5.4 5.4a2 2 0 0 1-2.8 0l-5-5A2 2 0 0 1 5.6 12l-.1-5.1A1.4 1.4 0 0 1 4 5.5Z" />
          <circle cx="9" cy="9" r="1.3" fill="currentColor" stroke="none" />
        </svg>
      ),
    },
  ];

  // Context for files whose data cannot be counted yet. `pendingFiles`
  // from the aggregate includes files mid-inspection; those are disclosed
  // separately so the note stays truthful while work is running.
  const inspecting = inspectingIds.filter((id) => entries.some((entry) => entry.item.id === id)).length;
  const contextParts: string[] = [];
  if (totals.pendingFiles - inspecting > 0) contextParts.push(`${totals.pendingFiles - inspecting} pending`);
  if (inspecting > 0) contextParts.push(`${inspecting} inspecting`);
  if (totals.inspectionBlockedFiles > 0) contextParts.push(`${totals.inspectionBlockedFiles} unsupported or failed`);

  return (
    <aside aria-labelledby="queue-summary-heading" className="flex min-w-0 flex-col gap-4 self-start">
      <div className="rounded-[1.1rem] border border-[#e6ebf3] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,.04)]">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#e9f2fe] text-[#2d5be9]" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" {...ICON_STROKE}>
              <path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
              <path d="M14 3.5v4h4M9 13h6m-6 3h4" />
            </svg>
          </span>
          <h2 id="queue-summary-heading" className="text-[15.5px] font-extrabold tracking-[-0.01em] text-[#16244a]">Queue summary</h2>
        </div>

        <div className="mt-3.5 grid grid-cols-2 gap-3" data-testid="queue-sidebar-totals">
          <div>
            <p className="text-[1.55rem] font-extrabold leading-none tracking-[-0.02em] text-[#111c3c]">{totals.files}</p>
            <p className="mt-1 text-[11.5px] font-semibold text-slate-500">Files added</p>
          </div>
          <div className="border-l border-[#edf1f7] pl-3">
            <p className="text-[1.55rem] font-extrabold leading-none tracking-[-0.02em] text-[#111c3c]">{totals.sizeLabel}</p>
            <p className="mt-1 text-[11.5px] font-semibold text-slate-500">Total size</p>
          </div>
        </div>

        <ul className="mt-4 grid gap-2.5 border-t border-[#edf1f7] pt-3.5" aria-label="Detected metadata totals">
          {rows.map((row) => (
            <li key={row.key} className="flex items-center gap-2.5 text-[13px]">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500" aria-hidden="true">
                {row.icon}
              </span>
              <span className="min-w-0 flex-1 font-semibold text-[#394661]">{row.label}</span>
              <span className="tabular-nums font-extrabold text-[#16244a]">{row.value}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] leading-4 text-slate-400" role="note">
          Counted from inspected files only.
          {contextParts.length > 0 ? ` Not counted: ${contextParts.join(" · ")}.` : ""}
          {cleanedCount > 0 ? ` Totals describe the original files, before cleaning for ${cleanedCount} file${cleanedCount === 1 ? "" : "s"}.` : ""}
        </p>
      </div>

      <div id="privacy" className="scroll-mt-24 rounded-[1.1rem] border border-[#d9f0e4] bg-[#f2fbf6] p-4">
        <div className="flex items-start gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0da16e] text-white" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3 19 5.6v5c0 4.7-2.8 8.2-7 10-4.2-1.8-7-5.3-7-10v-5L12 3Z" />
              <path d="m8.6 11.5 2.2 2.2 4.7-5" />
            </svg>
          </span>
          <p className="text-[12.5px] font-semibold leading-[1.55] text-[#0a5c43]">
            All image processing happens locally in your browser. Your original files are not uploaded.
          </p>
        </div>
      </div>
    </aside>
  );
}
