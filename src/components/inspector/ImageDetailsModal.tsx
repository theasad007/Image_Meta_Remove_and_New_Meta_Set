"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import BeforeAfterPanel from "../cleaning/BeforeAfterPanel";
import RewriteResultPanel from "../rewrite/RewriteResultPanel";
import Tooltip from "../ui/tooltip";
import { useDialogChrome, useDialogFocusTrap } from "../ui/dialog-chrome";
import AudioInspectionBody from "./AudioInspectionBody";
import { formatBytes } from "../../lib/format-detection/format-bytes";
import { downloadBlob } from "../../lib/reporting/download";
import type { CleaningStatus, FileCleaningResult } from "../../lib/metadata/clean/types";
import type { FileRewriteResult, RewriteStatus } from "../../lib/metadata/rewrite/rewrite";
import { AI_INDICATOR_DISCLAIMER } from "../../lib/metadata/inspect/ai-indicators";
import type { WorkspaceTool } from "../../lib/workspace/actions";
import { deriveRowStatus, type RowTone } from "../../lib/workspace/status";
import { dimensionsOf } from "../../lib/workspace/summary";
import type { ImageInspectionResult, InspectionCategoryResult, InspectionOutcome } from "../../types/inspection";
import type { QueueEntry } from "../../types/media";
import { aiIndicatorReactKey, CategorySection } from "./InspectorPanel";
import { categoriesForTabs, detailCountsOf, type DetailTabId } from "./details-tabs";
import { PreviewFallback, useEntryPreview } from "../queue/queue-previews";
import type { QueueDownloadOutput } from "../queue/QueueItem";

/**
 * Screen 05 — Image details / expanded metadata dialog.
 *
 * A portal-rendered, focus-trapped dialog triggered by each row's
 * "View details" action. Every number, field name and value shown is taken
 * from the committed inspection/verification results of exactly this queue
 * item: nothing is hardcoded, inferred past the data, or presented as
 * pixel-based AI detection. Cleaning and rewrite verification reuse the
 * existing BeforeAfterPanel/RewriteResultPanel surfaces so "original
 * findings · before cleaning" and the verified post-clean re-inspection
 * stay the single source of truth they already are in Screen 04.
 */

export interface DetailsNavPosition {
  /** Zero-based position inside the details-navigable queue slice. */
  index: number;
  total: number;
}

export interface ImageDetailsModalProps {
  entry: QueueEntry | undefined;
  navPosition: DetailsNavPosition | null;
  inspectionResult?: ImageInspectionResult;
  inspectionState: InspectionOutcome | "inspecting" | undefined;
  cleaningState: CleaningStatus | "cleaning" | undefined;
  cleaningResult?: FileCleaningResult;
  rewriteState?: RewriteStatus | "rewriting";
  rewriteResult?: FileRewriteResult;
  /** Verified downloadable output for this file (hidden until it exists). */
  downloadOutput: QueueDownloadOutput | null;
  activeTool: WorkspaceTool;
  busy: boolean;
  onStep: (delta: number) => void;
  onDownloadNotice: (name: string) => void;
  /** Runs the existing verified single-file metadata removal pipeline. */
  onRemoveForFile: (id: string) => void;
  /** Screen 06: opens the single-image edit-metadata dialog for this file
   *  (the details dialog closes first — one active focus trap at a time). */
  onEditForImage: (id: string) => void;
  onClose: () => void;
}

type DetailsTab = DetailTabId;

const TAB_DEFS: Array<{ id: DetailTabId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "ai", label: "AI Evidence" },
  { id: "c2pa", label: "C2PA" },
  { id: "exif", label: "EXIF" },
  { id: "xmp", label: "XMP" },
  { id: "iptc", label: "IPTC" },
  { id: "gps", label: "GPS" },
  { id: "technical", label: "Technical" },
];

const TONE_CHIP: Record<RowTone, string> = {
  neutral: "bg-slate-100 text-slate-600",
  busy: "bg-blue-50 text-blue-700",
  success: "bg-emerald-50 text-emerald-800",
  warning: "bg-amber-50 text-amber-800",
  danger: "bg-red-50 text-red-700",
};

const FAMILY_CHIP_TONES: Record<string, string> = {
  ai: "bg-red-50 text-red-600",
  c2pa: "bg-[#e9f2fe] text-[#2d5be9]",
  exif: "bg-indigo-50 text-indigo-700",
  gps: "bg-rose-50 text-rose-700",
  xmp: "bg-violet-50 text-violet-700",
  iptc: "bg-teal-50 text-teal-700",
  other: "bg-slate-100 text-slate-600",
};

const NEUTRAL_CHIP = "border border-slate-200 bg-white text-slate-500";

const timestampLabel = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

function Chip({ tone, children, title }: { tone: string; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-bold ${tone}`}
    >
      {children}
    </span>
  );
}

function IconTile({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span aria-hidden="true" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.7rem] ${tone}`}>
      {children}
    </span>
  );
}

function StatusChip({ inspectionState }: { inspectionState: InspectionOutcome | "inspecting" | undefined }) {
  const busy = inspectionState === "inspecting";
  if (busy || !inspectionState) {
    return (
      <Chip tone={TONE_CHIP.busy} title="Metadata inspection is running for this file.">
        {busy ? <span aria-hidden="true" className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" /> : null}
        Inspecting metadata…
      </Chip>
    );
  }
  switch (inspectionState) {
    case "completed":
      return (
        <Chip tone={TONE_CHIP.success} title="Inspection finished; findings below come from the actual file bytes.">
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="m4.5 10.5 3.4 3.4 7.6-8" />
          </svg>
          Inspection completed
        </Chip>
      );
    case "partial":
      return <Chip tone={TONE_CHIP.warning} title="Some metadata groups could not be read; honest gaps are shown in the tabs.">Partial inspection</Chip>;
    case "failed":
      return <Chip tone={TONE_CHIP.danger} title="Inspection failed for this file.">Inspection failed</Chip>;
    case "unsupported":
      return <Chip tone={TONE_CHIP.neutral} title="This file's metadata cannot be inspected.">Unsupported format</Chip>;
    case "cancelled":
      return <Chip tone={TONE_CHIP.neutral} title="Inspection was cancelled before finishing.">Inspection cancelled</Chip>;
    default:
      return null;
  }
}

function LifecycleChip({ label, tone, title }: { label: string; tone: RowTone; title: string }) {
  return (
    <Chip tone={TONE_CHIP[tone]} title={title}>
      {tone === "success" ? (
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="m4.5 10.5 3.4 3.4 7.6-8" />
        </svg>
      ) : null}
      {label}
    </Chip>
  );
}

function AiIndicatorCard({ indicator }: {
  indicator: ImageInspectionResult["aiIndicators"][number];
}) {
  return (
    <li className="rounded-xl border border-violet-200 bg-white p-3 text-xs">
      <p className="font-semibold text-[#16244a]">
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
  );
}

const AI_TILE: ReactNode = (
  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="currentColor">
    <path d="M9.8 3.9c.4-1.1 1.9-1.1 2.2 0l1 3.3a3.9 3.9 0 0 0 2.6 2.6l3.3 1c1.1.4 1.1 1.9 0 2.2l-3.3 1a3.9 3.9 0 0 0-2.6 2.6l-1 3.3c-.4 1.1-1.9 1.1-2.2 0l-1-3.3a3.9 3.9 0 0 0-2.6-2.6l-3.3-1c-1.1-.4-1.1-1.9 0-2.2l3.3-1a3.9 3.9 0 0 0 2.6-2.6l1-3.3Z" />
  </svg>
);

const OVERALL_TILE: ReactNode = (
  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4.5" y="3.5" width="15" height="17" rx="2.2" />
    <path d="M8.5 8h7M8.5 12h7M8.5 16h4" />
  </svg>
);

/** Body of the "AI metadata summary" card (identical in the desktop card and
 *  the mobile collapsible — same committed engine counts, nothing invented). */
function AiSummaryDetectedBody({
  aiCount,
  c2paDetected,
  indicators,
}: {
  aiCount: number;
  c2paDetected: boolean;
  indicators: ImageInspectionResult["aiIndicators"];
}) {
  return (
    <>
      <p className="mt-2 text-[12px] leading-5 text-[#7f1d1d]">
        This image contains signatures and metadata that may indicate AI generation or editing. This is metadata evidence, not pixel-based AI detection.
      </p>
      <ul className="mt-2 grid gap-1 text-[12px] font-semibold text-[#16244a]">
        <li className="flex items-center justify-between gap-2">
          <span>Qualified indicators</span>
          <span className="font-extrabold tabular-nums">{aiCount}</span>
        </li>
        <li className="flex items-center justify-between gap-2">
          <span>C2PA manifests</span>
          <span className="font-extrabold tabular-nums">{c2paDetected ? 1 : 0}</span>
        </li>
        <li className="flex items-center justify-between gap-2">
          <span>Explicit matches</span>
          <span className="font-extrabold tabular-nums">{indicators.filter((indicator) => indicator.confidence === "explicit").length}</span>
        </li>
        <li className="flex items-center justify-between gap-2">
          <span>Possible matches</span>
          <span className="font-extrabold tabular-nums">{indicators.filter((indicator) => indicator.confidence === "possible").length}</span>
        </li>
      </ul>
    </>
  );
}

function OverallSummaryBody({
  hasResult,
  counts,
}: {
  hasResult: boolean;
  counts: NonNullable<ReturnType<typeof detailCountsOf>>;
}) {
  return (
    <>
      <p className="mt-1.5 text-[11.5px] leading-4 text-[#5a6b85]">Total detected metadata items across all categories.</p>
      <p className="mt-1 text-[20px] font-extrabold tabular-nums text-[#16244a]" data-testid="details-total-items">
        {hasResult ? counts.total : "—"}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-1.5" aria-label="Metadata counts per family">
        {([
          ["EXIF", counts.exif, FAMILY_CHIP_TONES.exif],
          ["XMP", counts.xmp, FAMILY_CHIP_TONES.xmp],
          ["IPTC", counts.iptc, FAMILY_CHIP_TONES.iptc],
          ["GPS", counts.gps, FAMILY_CHIP_TONES.gps],
          ["AI", counts.ai, FAMILY_CHIP_TONES.ai],
          ["C2PA", counts.c2pa, FAMILY_CHIP_TONES.c2pa],
          ["Other", counts.technical, FAMILY_CHIP_TONES.other],
        ] as const).map(([label, value, tone]) => (
          <span key={label} className={`flex items-center justify-between rounded-lg px-2 py-1 text-[11px] font-bold ${tone}`}>
            {label}
            <span className="tabular-nums">{hasResult ? value : "—"}</span>
          </span>
        ))}
      </div>
    </>
  );
}

interface FindingRowProps {
  testId: string;
  tileTone: string;
  tile: ReactNode;
  title: string;
  description: string;
  chipTone: string;
  chipLabel: string;
  chipTitle: string;
  ariaLabel: string;
  children: ReactNode;
}

/** Expandable key finding (reference: tile + title + count chip + chevron). */
function FindingRow({ testId, tileTone, tile, title, description, chipTone, chipLabel, chipTitle, ariaLabel, children }: FindingRowProps) {
  return (
    <details data-testid={testId} className="group rounded-[1rem] border border-[#e6ebf3] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,.03)]">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 [&::-webkit-details-marker]:hidden">
        <IconTile tone={tileTone}>{tile}</IconTile>
        <span className="min-w-0 flex-1 basis-[12rem]">
          <span className="block text-[13.5px] font-extrabold tracking-[-0.01em] text-[#16244a]">{title}</span>
          <span className="mt-0.5 block break-words text-[11.5px] leading-4 text-[#5a6b85]">{description}</span>
        </span>
        <span className="ml-auto flex items-center gap-2">
          <Chip tone={chipTone} title={chipTitle}>{chipLabel}</Chip>
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 text-slate-400 motion-safe:transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
        <span className="sr-only">{ariaLabel}</span>
      </summary>
      <div className="mt-3 border-t border-[#eef1f7] pt-3">
        {children}
      </div>
    </details>
  );
}

export default function ImageDetailsModal({
  entry,
  navPosition,
  inspectionResult,
  inspectionState,
  cleaningState,
  cleaningResult,
  rewriteState,
  rewriteResult,
  downloadOutput,
  activeTool,
  busy,
  onStep,
  onDownloadNotice,
  onRemoveForFile,
  onEditForImage,
  onClose,
}: ImageDetailsModalProps) {
  const open = Boolean(entry);
  const panelRef = useRef<HTMLDivElement>(null);
  // Tab state resets to Overview whenever the dialog targets a different
  // file (render-derived reset — navigation can never mix evidence tabs).
  const [tabState, setTabState] = useState<{ id: DetailsTab; entryId: string | null }>({ id: "overview", entryId: null });
  const entryId = entry?.item.id ?? null;
  if (tabState.entryId !== entryId) {
    setTabState({ id: "overview", entryId });
  }
  const tab = tabState.id;
  const { url: previewUrl, status: previewStatus } = useEntryPreview(entry);

  const tabs = useMemo(
    () => (inspectionResult ? categoriesForTabs(inspectionResult) : null),
    [inspectionResult],
  );
  const counts = useMemo(
    () => (inspectionResult ? detailCountsOf(inspectionResult) : null),
    [inspectionResult],
  );
  // Navigation restacks fresh content: keep the scrolled pane at its top
  // whenever the dialog targets another file (DOM side effect only).
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [entry?.item.id]);
  const dimensions = inspectionResult ? dimensionsOf(inspectionResult) : null;
  const c2paCategory = inspectionResult?.categories.find((item) => item.category.toLowerCase().startsWith("c2pa"));
  const aiUnresolved = c2paCategory?.status === "not_inspected"
    || c2paCategory?.status === "unsupported"
    || c2paCategory?.status === "failed";

  const processingNow = cleaningState === "cleaning" || rewriteState === "rewriting";
  const removalRunning = processingNow || busy;
  const removalAvailable = Boolean(inspectionResult) && !removalRunning;
  const removalTitle = removalNowTitle(processingNow, busy, Boolean(inspectionResult));

  const focusTrap = useDialogFocusTrap(panelRef);
  const openerSelector = entry ? `[data-queue-id="${CSS.escape(entry.item.id)}"] [data-details-open]` : null;
  useDialogChrome({ open, onClose, panelRef, openerSelector });

  /** Mobile jump action: the tablist reaches the top of the viewport and
   *  the active tab is focused immediately — no scrolling required. */
  const jumpToMetadata = useCallback(() => {
    const tablist = document.getElementById("details-tablist");
    if (!tablist) return;
    tablist.scrollIntoView({ behavior: "auto", block: "start" });
    const activeTab = tablist.querySelector<HTMLElement>('[aria-selected="true"]');
    activeTab?.focus({ preventScroll: true });
    activeTab?.click();
    activeTab?.focus({ preventScroll: true });
  }, []);

  const onTablistKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const currentIndex = TAB_DEFS.findIndex((definition) => definition.id === tab);
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % TAB_DEFS.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + TAB_DEFS.length) % TAB_DEFS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = TAB_DEFS.length - 1;
    const next = TAB_DEFS[nextIndex];
    setTabState({ id: next.id, entryId });
    // Scroll the activated tab into the strip's scroll viewport explicitly
    // (inline "nearest"): the active pill is never clipped at either edge.
    const nextTab = event.currentTarget.querySelector<HTMLElement>(`[data-tab="${next.id}"]`);
    nextTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
    nextTab?.focus({ preventScroll: true });
  }, [tab, entryId]);

  if (!open || !entry) return null;

  const countsSafe = counts ?? {
    ai: 0, c2pa: 0, exif: 0, gps: 0, xmp: 0, iptc: 0, technical: 0, standard: 0, total: 0, hasUnreadGroups: false,
  };
  const hasResult = Boolean(inspectionResult);
  const detectedLabel = (inspectionResult?.detectedFormat ?? entry.item.detected.label).toUpperCase();

  const previewHeicHint = (() => {
    const extension = entry.item.detected.extension.toLowerCase();
    const brand = entry.item.detected.brand?.toLowerCase() ?? "";
    return extension === "heic" || extension === "heif" || brand.startsWith("hei");
  })();
  const addedLabel = timestampLabel(new Date(entry.item.addedAt).toISOString());
  const scannedLabel = inspectionResult ? timestampLabel(inspectionResult.inspectedAt) : null;
  const cleaningChip = cleaningResult
    ? deriveRowStatus({ inspectionState: undefined, cleaningState: undefined, cleaningResult })
    : null;
  const rewriteChip = rewriteResult
    ? deriveRowStatus({ inspectionState: undefined, cleaningState: undefined, rewriteResult })
    : null;

  const tabBadgeCounts: Partial<Record<DetailTabId, number>> = {
    ai: countsSafe.ai,
    c2pa: countsSafe.c2pa,
    exif: countsSafe.exif,
    xmp: countsSafe.xmp,
    iptc: countsSafe.iptc,
    gps: countsSafe.gps,
    technical: countsSafe.technical,
  };

  const badge = (tabId: DetailTabId) => {
    const value = tabBadgeCounts[tabId];
    if (!value || value <= 0) return null;
    const tone = tabId === "ai" ? FAMILY_CHIP_TONES.ai
      : tabId === "c2pa" ? FAMILY_CHIP_TONES.c2pa
      : tabId === "exif" ? FAMILY_CHIP_TONES.exif
      : tabId === "xmp" ? FAMILY_CHIP_TONES.xmp
      : tabId === "iptc" ? FAMILY_CHIP_TONES.iptc
      : tabId === "gps" ? FAMILY_CHIP_TONES.gps
      : FAMILY_CHIP_TONES.other;
    return (
      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${tone}`} aria-hidden="true">
        {value}
      </span>
    );
  };

  const emptyState = (bucket: InspectionCategoryResult[]) => {
    const exists = bucket.some((category) => category.status !== "not_detected");
    if (bucket.length === 0 || !exists) {
      return <p className="rounded-xl bg-[#f7f9fd] px-4 py-3 text-[12px] text-slate-500">Inspected — nothing in this group.</p>;
    }
    return null;
  };

  const categoryList = (bucket: InspectionCategoryResult[], openFirst: boolean) => (
    <>
      {bucket.length > 0 ? (
        <div className="grid gap-2">
          {bucket.map((category, index) => (
            <CategorySection key={`${category.category}:${index}`} category={category} open={openFirst ? index === 0 : false} />
          ))}
        </div>
      ) : null}
    </>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[90] overflow-y-auto bg-slate-950/55"
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        if (event.target !== event.currentTarget) return;
        // preventDefault stops the mousedown from clearing focus off the
        // dialog (and later onto the page) before the close completes —
        // focus restoration then stays in the dialog's control.
        event.preventDefault();
        onClose();
      }}
    >
      <div className="mx-auto flex min-h-full w-full max-w-[72rem] items-start justify-center sm:px-6 sm:py-8">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="details-title"
          aria-describedby="details-privacy-line"
          tabIndex={-1}
          data-testid="details-modal"
          onKeyDown={focusTrap}
          className="flex h-full w-full flex-col overflow-hidden rounded-none bg-[#f7f9fd] text-[#16244a] shadow-[0_30px_90px_rgba(15,23,42,.4)] outline-none sm:h-auto sm:max-h-[calc(100dvh-4rem)] sm:min-h-0 sm:rounded-[1.4rem] sm:ring-1 sm:ring-slate-900/10"
        >
          {/* Header */}
          <header data-testid="details-header" className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#e6ebf3] bg-white px-4 py-3 sm:px-5">
            <span data-testid="details-thumb" aria-hidden="true" className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
              {previewUrl && previewStatus !== "failed" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt="" decoding="async" className="h-full w-full object-cover" />
              ) : previewStatus === "failed" ? (
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 text-slate-400" fill="none">
                  <rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.7" />
                  <circle cx="9" cy="9" r="2" stroke="currentColor" strokeWidth="1.7" />
                  <path d="m5.5 17 4.2-4.2 3.1 3.1 2.1-2.1 3.6 3.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600 motion-reduce:animate-none" />
              )}
            </span>
            <div className="min-w-0 flex-1 basis-[12rem] sm:basis-[18rem]">
              <Tooltip label={entry.item.name} zClass="z-[120]" testId="details-name-tooltip">
                <p id="details-title" data-testid="details-title" className="truncate text-[15px] font-extrabold tracking-[-0.01em] text-[#16244a]">{entry.item.name}</p>
              </Tooltip>
              <p className="mt-0.5 truncate text-[11.5px] font-semibold text-[#5a6b85]" data-testid="details-file-meta">
                <span className="font-bold text-[#43536e]">{entry.item.detected.label}</span>
                {" · "}
                <span className="tabular-nums">{formatBytes(entry.item.sizeBytes)}</span>
                {dimensions ? <span className="tabular-nums"> · {dimensions}</span> : null}
                <span> · Added {addedLabel}</span>
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2" data-testid="details-status-chips">
              {processingNow ? (
                <Chip tone={TONE_CHIP.busy} title="The verified processing pipeline is running for this file.">
                  <span aria-hidden="true" className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />
                  Processing…
                </Chip>
              ) : null}
              <StatusChip inspectionState={inspectionState} />
              {cleaningChip && !processingNow ? (
                <LifecycleChip
                  label={cleaningChip.label}
                  tone={cleaningChip.tone}
                  title={`Metadata removal outcome for this file: ${cleaningChip.label}. The original file in the queue is untouched.`}
                />
              ) : null}
              {rewriteChip && !processingNow ? (
                <LifecycleChip
                  label={rewriteChip.label}
                  tone={rewriteChip.tone}
                  title={`Profile rewrite outcome for this file: ${rewriteChip.label}.`}
                />
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-1.5" data-testid="details-header-actions">
              {navPosition && navPosition.total > 1 ? (
                <div role="group" aria-label="Queue navigation" data-testid="details-nav" className="flex items-center gap-0.5 rounded-full border border-[#e3e9f2] bg-white p-0.5">
                  <button
                    type="button"
                    data-testid="details-prev"
                    aria-label="Previous file in the queue"
                    disabled={navPosition.index <= 0}
                    onClick={() => onStep(-1)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[#43536e] hover:bg-slate-100 focus-visible:outline-3 focus-visible:outline-[#2d5be9] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14.5 5.5 8 12l6.5 6.5" />
                    </svg>
                  </button>
                  <span aria-hidden="true" className="px-0.5 text-[10.5px] font-bold tabular-nums text-[#5a6b85]">
                    {navPosition.index + 1}/{navPosition.total}
                  </span>
                  <button
                    type="button"
                    data-testid="details-next"
                    aria-label="Next file in the queue"
                    disabled={navPosition.index >= navPosition.total - 1}
                    onClick={() => onStep(1)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[#43536e] hover:bg-slate-100 focus-visible:outline-3 focus-visible:outline-[#2d5be9] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9.5 5.5 16 12l-6.5 6.5" />
                    </svg>
                  </button>
                </div>
              ) : null}

              {downloadOutput ? (
                <Tooltip label={`Download the verified ${downloadOutput.kind} copy of ${entry.item.name}. The original file was not modified.`} zClass="z-[120]">
                  <button
                    type="button"
                    data-testid="details-download"
                    onClick={() => {
                      downloadBlob(downloadOutput.blob, downloadOutput.name);
                      onDownloadNotice(downloadOutput.name);
                    }}
                    className="inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[12px] font-bold text-[#35435c] hover:bg-slate-50 focus-visible:outline-3 focus-visible:outline-[#2d5be9]"
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 4.5v11m0 0-4.2-4.2M12 15.5l4.2-4.2M4.5 18.5h15" />
                    </svg>
                    Download {" "}
                    <span className="sr-only">verified {" "}</span>
                    {downloadOutput.kind === "cleaned" ? "cleaned" : "rewritten"}
                    <span className="sr-only"> copy</span>
                  </button>
                </Tooltip>
              ) : null}

              <Tooltip label="Open the single-image metadata editor (Screen 06). This dialog closes while the editor is open." zClass="z-[120]">
                <button
                  type="button"
                  data-testid="details-edit"
                  onClick={() => onEditForImage(entry.item.id)}
                  className="inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[12px] font-bold text-[#35435c] hover:bg-slate-50 focus-visible:outline-3 focus-visible:outline-[#2d5be9]"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4.5 19.5 15 9l-3-3L4.5 16.5v3h3ZM14.5 7.5l2 2" />
                  </svg>
                  Edit metadata
                </button>
              </Tooltip>

              <Tooltip label={removalTitle} zClass="z-[120]">
                <button
                  type="button"
                  data-testid="details-remove"
                  disabled={!removalAvailable}
                  onClick={() => onRemoveForFile(entry.item.id)}
                  className="inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-[#fecaca] bg-white px-2.5 py-1 text-[12px] font-bold text-[#b42318] hover:bg-[#fff1f2] focus-visible:outline-3 focus-visible:outline-[#0d9474] disabled:cursor-not-allowed disabled:border-[#e6ebf3] disabled:text-[#9aa8c2]"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8.5 6.5V5.3a1.8 1.8 0 0 1 1.8-1.8h3.4a1.8 1.8 0 0 1 1.8 1.8v1.2m4.2 0H4.3m1.5 0 .8 12.1a1.9 1.9 0 0 0 1.9 1.8h7a1.9 1.9 0 0 0 1.9-1.8l.8-12.1M10 10.5v5m4-5v5" />
                  </svg>
                  Remove metadata
                </button>
              </Tooltip>

              <button
                type="button"
                data-testid="details-close"
                aria-label={`Close image details for ${entry.item.name}`}
                onClick={onClose}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-slate-500 hover:border-slate-200 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-3 focus-visible:outline-[#2d5be9]"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
          </header>

          {/* Body: preview pane + tabbed inspection */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div ref={bodyRef} data-tab-body="true" className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-3 sm:p-5 lg:grid-cols-[minmax(16.5rem,21rem)_minmax(0,1fr)]">
              {/* Left pane */}
              <aside className="min-w-0">
                <div data-testid="details-preview" className="rounded-2xl border border-[#e6ebf3] bg-white p-1.5 shadow-[0_1px_2px_rgba(15,23,42,.04)]">
                  {/* Mobile: fixed, shorter frame (object-contain = the full
                      image always fits, never cropped or distorted). Desktop:
                      unchanged aspect-frame preview. */}
                  <div data-testid="details-preview-frame" className="relative flex h-44 items-center justify-center overflow-hidden rounded-xl bg-[#edf2f9] lg:aspect-[4/3] lg:h-auto">
                    {previewUrl && previewStatus !== "failed" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img data-testid="details-preview-img" src={previewUrl} alt={`${entry.item.name} preview`} decoding="async" className="h-full w-full object-contain" />
                    ) : previewStatus === "failed" ? (
                      <PreviewFallback heicHint={previewHeicHint} spinning={false} />
                    ) : (
                      <PreviewFallback heicHint={previewHeicHint} spinning />
                    )}
                  </div>
                </div>
                <p data-testid="details-image-stats" className="mt-2 px-1 text-[11.5px] font-semibold tabular-nums text-[#5a6b85]">
                  {entry.item.detected.label} · {formatBytes(entry.item.sizeBytes)}
                  {dimensions ? ` · ${dimensions}` : ""}
                  {inspectionResult?.detectedBrand ? ` · brand ${inspectionResult.detectedBrand}` : ""}
                </p>

                {/* Mobile-only jump: reachable metadata tabs without a long
                    scroll; focuses the active tab after scrolling. */}
                <button
                  type="button"
                  data-testid="details-jump-metadata"
                  aria-controls="details-tablist"
                  onClick={jumpToMetadata}
                  className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-[#c7d7f8] bg-[#e9f2fe] px-3 py-3 text-[12.5px] font-extrabold text-[#2d5be9] hover:bg-[#e2edfd] focus-visible:outline-3 focus-visible:outline-[#2d5be9] lg:hidden"
                >
                  View metadata details
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14m0 0-4.2-4.2M12 19l4.2-4.2" />
                  </svg>
                </button>

                  {countsSafe.ai > 0 ? (
                    <>
                      {/* Desktop: approved summary card (unchanged). */}
                      <div className="mt-3 hidden rounded-2xl border border-[#f4c7c7] bg-[#fdf3f3] p-3.5 lg:block" data-testid="details-ai-summary">
                        <div className="flex flex-wrap items-center gap-2">
                          <IconTile tone="bg-red-50 text-red-600">{AI_TILE}</IconTile>
                          <p className="text-[13.5px] font-extrabold text-[#16244a]">AI metadata summary</p>
                          <Chip tone="bg-red-600 text-white" title="Qualified AI metadata indicators from the actual file metadata.">AI indications found</Chip>
                        </div>
                        <AiSummaryDetectedBody
                          aiCount={countsSafe.ai}
                          c2paDetected={c2paCategory?.status === "detected"}
                          indicators={inspectionResult?.aiIndicators ?? []}
                        />
                      </div>
                      {/* Mobile: collapsed by default — one tap expands the
                          same real counts; never duplicated data. */}
                      <details className="group mt-3 rounded-2xl border border-[#f4c7c7] bg-[#fdf3f3] p-3.5 lg:hidden" data-testid="details-ai-summary-mobile">
                        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 [&::-webkit-details-marker]:hidden">
                          <IconTile tone="bg-red-50 text-red-600">{AI_TILE}</IconTile>
                          <p className="text-[13.5px] font-extrabold text-[#16244a]">AI metadata summary</p>
                          <Chip tone="bg-red-600 text-white" title="Qualified AI metadata indicators from the actual file metadata.">AI indications found</Chip>
                          <svg aria-hidden="true" viewBox="0 0 24 24" className="ml-auto h-4 w-4 text-slate-400 motion-safe:transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="m6 9 6 6 6-6" />
                          </svg>
                        </summary>
                        <AiSummaryDetectedBody
                          aiCount={countsSafe.ai}
                          c2paDetected={c2paCategory?.status === "detected"}
                          indicators={inspectionResult?.aiIndicators ?? []}
                        />
                      </details>
                    </>
                  ) : (
                    <>
                      <div className="mt-3 hidden rounded-2xl border border-[#d9ead9] bg-[#eef7ee] p-3.5 lg:block" data-testid="details-ai-summary">
                        <p className="text-[13.5px] font-extrabold text-[#16244a]">AI metadata summary</p>
                        <p className="mt-1 text-[12px] leading-5 text-[#375a37]">
                          {aiUnresolved
                            ? "AI evidence is not fully inspected because C2PA coverage is incomplete for this file."
                            : "No AI-associated metadata indicators found. "}
                          {AI_INDICATOR_DISCLAIMER}
                        </p>
                      </div>
                      <details className="group mt-3 rounded-2xl border border-[#d9ead9] bg-[#eef7ee] p-3.5 lg:hidden" data-testid="details-ai-summary-mobile">
                        <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
                          <p className="text-[13.5px] font-extrabold text-[#16244a]">AI metadata summary</p>
                          <svg aria-hidden="true" viewBox="0 0 24 24" className="ml-auto h-4 w-4 text-slate-400 motion-safe:transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="m6 9 6 6 6-6" />
                          </svg>
                        </summary>
                        <p className="mt-2 text-[12px] leading-5 text-[#375a37]">
                          {aiUnresolved
                            ? "AI evidence is not fully inspected because C2PA coverage is incomplete for this file."
                            : "No AI-associated metadata indicators found. "}
                          {AI_INDICATOR_DISCLAIMER}
                        </p>
                      </details>
                    </>
                  )}

                  {/* Overall metadata summary (desktop card + mobile collapsible). */}
                  <div className="mt-3 hidden rounded-2xl border border-[#e6ebf3] bg-white p-3.5 lg:block" data-testid="details-overall-summary">
                    <div className="flex flex-wrap items-center gap-2">
                      <IconTile tone="bg-[#e9f2fe] text-[#2d5be9]">{OVERALL_TILE}</IconTile>
                      <p className="text-[13.5px] font-extrabold text-[#16244a]">Overall metadata summary</p>
                    </div>
                    <OverallSummaryBody
                      hasResult={hasResult}
                      counts={countsSafe}
                    />
                  </div>
                  <details className="group mt-3 rounded-2xl border border-[#e6ebf3] bg-white p-3.5 lg:hidden" data-testid="details-overall-summary-mobile">
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 [&::-webkit-details-marker]:hidden">
                      <IconTile tone="bg-[#e9f2fe] text-[#2d5be9]">{OVERALL_TILE}</IconTile>
                      <p className="text-[13.5px] font-extrabold text-[#16244a]">Overall metadata summary</p>
                      <svg aria-hidden="true" viewBox="0 0 24 24" className="ml-auto h-4 w-4 text-slate-400 motion-safe:transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </summary>
                    <OverallSummaryBody
                      hasResult={hasResult}
                      counts={countsSafe}
                    />
                  </details>
                </aside>

              {/* Right pane: tabbed detailed inspection */}
              <section
                aria-label="Detailed metadata inspection"
                data-testid="inspector-panel"
                className="min-w-0 rounded-2xl border border-[#e6ebf3] bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,.04)] sm:p-4"
              >
                <div
                  id="details-tablist"
                  role="tablist"
                  aria-label="Metadata inspection tabs"
                  data-testid="details-tabs"
                  onKeyDown={onTablistKeyDown}
                  className="flex max-w-full gap-0.5 overflow-x-auto rounded-xl bg-[#eef2f7] p-1"
                >
                  {TAB_DEFS.map((definition) => (
                    <button
                      key={definition.id}
                      type="button"
                      role="tab"
                      id={`details-tab-${definition.id}`}
                      data-testid={`details-tab-${definition.id}`}
                      data-tab={definition.id}
                      aria-selected={tab === definition.id}
                      aria-controls={`details-panel-${definition.id}`}
                      tabIndex={tab === definition.id ? 0 : -1}
                      onClick={() => setTabState({ id: definition.id, entryId })}
                      /** No color transition: the active tab must be
                          unmistakable in the same frame the panel switches. */
                      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-[0.65rem] px-2 py-1.5 text-[12.5px] font-bold focus-visible:outline-3 focus-visible:outline-[#2d5be9] ${
                        tab === definition.id
                          ? "bg-white text-[#2d5be9] shadow-[0_1px_3px_rgba(15,23,42,.12)]"
                          : "text-[#43536e] hover:bg-white/70"
                      }`}
                    >
                      {definition.label}
                      {badge(definition.id)}
                    </button>
                  ))}
                </div>

                {/* All panels stay mounted (inactive hidden) so values are
                    stable for readers and tests; switching tabs never
                    re-inspects or mutates anything. */}
                {entry.item.detected.mediaKind === "audio" ? (
                  <AudioInspectionBody entry={entry} result={inspectionResult} />
                ) : (
                <div>
                  {/* Overview */}
                  <div
                    role="tabpanel"
                    id="details-panel-overview"
                    aria-labelledby="details-tab-overview"
                    data-testid="details-panel-overview"
                    hidden={tab !== "overview"}
                    className="mt-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[17px] font-extrabold tracking-[-0.02em] text-[#16244a]">Metadata overview</h3>
                      <StatusChip inspectionState={inspectionState} />
                    </div>
                    <p className="mt-1 text-[12.5px] text-[#5a6b85]">
                      Quick summary of all detected metadata in this image.
                      {scannedLabel ? ` Scanned on ${scannedLabel}.` : ""}
                    </p>

                    {inspectionResult && inspectionResult.warnings.length > 0 ? (
                      <div className="mt-3 grid gap-1">
                        {inspectionResult.warnings.map((warning, index) => (
                          <p key={`details-overview-warning-${index}:${warning.slice(0, 80)}`} className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11.5px] font-medium text-amber-800">
                            ⚠ {warning}
                          </p>
                        ))}
                      </div>
                    ) : null}

                    <div className="mt-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4" data-testid="details-overview-cards">
                      {/* AI card */}
                      <div className="rounded-[1rem] border border-[#e6ebf3] bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,.03)]" data-testid="details-card-ai">
                        <div className="flex items-center gap-2">
                          <IconTile tone={countsSafe.ai > 0 ? "bg-red-50 text-red-600" : aiUnresolved ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-400"}>
                            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="currentColor">
                              <path d="M9.8 3.9c.4-1.1 1.9-1.1 2.2 0l1 3.3a3.9 3.9 0 0 0 2.6 2.6l3.3 1c1.1.4 1.1 1.9 0 2.2l-3.3 1a3.9 3.9 0 0 0-2.6 2.6l-1 3.3c-.4 1.1-1.9 1.1-2.2 0l-1-3.3a3.9 3.9 0 0 0-2.6-2.6l-3.3-1c-1.1-.4-1.1-1.9 0-2.2l3.3-1a3.9 3.9 0 0 0 2.6-2.6l1-3.3Z" />
                            </svg>
                          </IconTile>
                          <p className="text-[12px] font-bold text-[#43536e]">AI indicators</p>
                        </div>
                        <p className="mt-2 text-[13.5px] font-extrabold text-[#16244a]">{hasResult ? (countsSafe.ai > 0 ? `${countsSafe.ai} found` : "Not found") : "—"}</p>
                        <p className="mt-0.5 text-[11px] leading-4 text-[#6b7a93]">
                          {countsSafe.ai > 0
                            ? "Possible AI generation or editing"
                            : aiUnresolved
                              ? "Coverage incomplete — not fully verified"
                              : hasResult
                                ? "No qualified AI metadata markers"
                                : "Inspection has not run"}
                        </p>
                      </div>

                      {/* C2PA card */}
                      <div className="rounded-[1rem] border border-[#e6ebf3] bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,.03)]" data-testid="details-card-c2pa">
                        <div className="flex items-center gap-2">
                          <IconTile tone={c2paCategory?.status === "detected" ? "bg-[#e9f2fe] text-[#2d5be9]" : "bg-slate-100 text-slate-400"}>
                            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 3.5c2.4 1.4 4.6 2 7.5 2.2v6.1c0 4.4-3 7.6-7.5 8.7-4.5-1.1-7.5-4.3-7.5-8.7V5.7c2.9-.2 5.1-.8 7.5-2.2Z" />
                              <path d="m9.2 12 2 2 3.6-4" opacity=".9" />
                            </svg>
                          </IconTile>
                          <p className="text-[12px] font-bold text-[#43536e]">C2PA manifests</p>
                        </div>
                        <p className="mt-2 text-[13.5px] font-extrabold text-[#16244a]">
                          {c2paCategory?.status === "detected" ? "1 found" : c2paCategory?.status === "not_detected" ? "No manifest" : c2paCategory?.status === "failed" ? "Check failed" : hasResult ? "Not inspected" : "—"}
                        </p>
                        <p className="mt-0.5 text-[11px] leading-4 text-[#6b7a93]">
                          {c2paCategory?.status === "detected"
                            ? "Content Credentials present; validity shown in the C2PA tab"
                            : c2paCategory?.status === "not_detected"
                              ? "No C2PA / Content Credentials manifest"
                              : c2paCategory?.status === "failed"
                                ? "The C2PA validator could not complete"
                                : hasResult
                                  ? "C2PA coverage incomplete for this file"
                                  : "Inspection has not run"}
                        </p>
                      </div>

                      {/* Standard metadata card */}
                      <div className="rounded-[1rem] border border-[#e6ebf3] bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,.03)]" data-testid="details-card-standard">
                        <div className="flex items-center gap-2">
                          <IconTile tone={countsSafe.standard > 0 ? "bg-[#e9f2fe] text-[#2d5be9]" : "bg-slate-100 text-slate-400"}>
                            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M13.3 3H7.1A1.8 1.8 0 0 0 5.3 4.8v14.4a1.8 1.8 0 0 0 1.8 1.8h9.8a1.8 1.8 0 0 0 1.8-1.8V8.3L13.3 3Z" />
                              <path d="M13.3 3v5.3h5.4" />
                            </svg>
                          </IconTile>
                          <p className="text-[12px] font-bold text-[#43536e]">Standard metadata</p>
                        </div>
                        <p className="mt-2 text-[13.5px] font-extrabold text-[#16244a]">{hasResult ? (countsSafe.standard > 0 ? `${countsSafe.standard} found` : "No items") : "—"}</p>
                        <p className="mt-0.5 break-words text-[11px] leading-4 text-[#6b7a93]">
                          {hasResult
                            ? (countsSafe.standard > 0
                              ? "EXIF, XMP, IPTC, GPS"
                              : countsSafe.hasUnreadGroups
                                ? "EXIF, XMP, IPTC, GPS — some groups unverified"
                                : "EXIF, XMP, IPTC, GPS — nothing detected")
                            : "Inspection has not run"}
                        </p>
                      </div>

                      {/* File format card */}
                      <div className="rounded-[1rem] border border-[#e6ebf3] bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,.03)]" data-testid="details-card-format">
                        <div className="flex items-center gap-2">
                          <IconTile tone="bg-[#e7f8f2] text-[#0d9474]">
                            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 3.5c2.4 1.4 4.6 2 7.5 2.2v6.1c0 4.4-3 7.6-7.5 8.7-4.5-1.1-7.5-4.3-7.5-8.7V5.7c2.9-.2 5.1-.8 7.5-2.2Z" />
                              <path d="m9.2 12 2 2 3.6-4" opacity=".9" />
                            </svg>
                          </IconTile>
                          <p className="text-[12px] font-bold text-[#43536e]">File format</p>
                        </div>
                        <p className="mt-2 text-[13.5px] font-extrabold text-[#16244a]">{detectedLabel}</p>
                        <p className="mt-0.5 tabular-nums text-[11px] leading-4 text-[#6b7a93]">
                          {formatBytes(entry.item.sizeBytes)}
                          {dimensions ? ` · ${dimensions}` : ""}
                          {entry.item.detected.binaryVerified ? " · verified from bytes" : ""}
                        </p>
                      </div>
                    </div>

                    <h3 className="mt-5 text-[16px] font-extrabold tracking-[-0.02em] text-[#16244a]">Key findings</h3>
                    <p className="mt-0.5 text-[12.5px] text-[#5a6b85]">Most important metadata that may affect your privacy or content authenticity.</p>

                    <div className="mt-3 grid gap-2" data-testid="details-findings">
                      {/* AI generation indicators */}
                      <FindingRow
                        testId="details-finding-ai"
                        tileTone={countsSafe.ai > 0 ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-400"}
                        tile={
                          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="currentColor">
                            <path d="M9.8 3.9c.4-1.1 1.9-1.1 2.2 0l1 3.3a3.9 3.9 0 0 0 2.6 2.6l3.3 1c1.1.4 1.1 1.9 0 2.2l-3.3 1a3.9 3.9 0 0 0-2.6 2.6l-1 3.3c-.4 1.1-1.9 1.1-2.2 0l-1-3.3a3.9 3.9 0 0 0-2.6-2.6l-3.3-1c-1.1-.4-1.1-1.9 0-2.2l3.3-1a3.9 3.9 0 0 0 2.6-2.6l1-3.3Z" />
                          </svg>
                        }
                        title="AI generation indicators"
                        description={countsSafe.ai > 0
                          ? "Found metadata that suggests this image may be AI-generated or edited."
                          : "No qualified AI-associated metadata indicators."}
                        chipTone={countsSafe.ai > 0 ? FAMILY_CHIP_TONES.ai : NEUTRAL_CHIP}
                        chipLabel={countsSafe.ai > 0 ? `${countsSafe.ai} indicators` : "None found"}
                        chipTitle={countsSafe.ai > 0 ? `${countsSafe.ai} qualified AI metadata indicator(s). Metadata inspection, not visual AI detection.` : "Inspected; no qualified AI metadata indicators detected."}
                        ariaLabel="AI generation indicators finding"
                      >
                        {inspectionResult && inspectionResult.aiIndicators.length > 0 ? (
                          <>
                            <ul className="grid gap-2">
                              {inspectionResult.aiIndicators.map((indicator, index) => (
                                <AiIndicatorCard key={aiIndicatorReactKey(indicator, index)} indicator={indicator} />
                              ))}
                            </ul>
                            <p className="mt-2 text-[11px] font-medium text-slate-600">{AI_INDICATOR_DISCLAIMER}</p>
                          </>
                        ) : (
                          <p className="rounded-xl bg-[#f7f9fd] px-3 py-2.5 text-[11.5px] text-slate-500">
                            No AI-associated metadata indicators found. {AI_INDICATOR_DISCLAIMER}
                          </p>
                        )}
                      </FindingRow>

                      {/* C2PA */}
                      <FindingRow
                        testId="details-finding-c2pa"
                        tileTone={c2paCategory?.status === "detected" ? "bg-[#e9f2fe] text-[#2d5be9]" : "bg-slate-100 text-slate-400"}
                        tile={
                          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 3.5c2.4 1.4 4.6 2 7.5 2.2v6.1c0 4.4-3 7.6-7.5 8.7-4.5-1.1-7.5-4.3-7.5-8.7V5.7c2.9-.2 5.1-.8 7.5-2.2Z" />
                            <path d="m9.2 12 2 2 3.6-4" opacity=".9" />
                          </svg>
                        }
                        title="C2PA / Content Credentials"
                        description={c2paCategory?.status === "detected"
                          ? "Contains C2PA manifest with generator information."
                          : "No C2PA manifest store was found in this file."}
                        chipTone={c2paCategory?.status === "detected" ? FAMILY_CHIP_TONES.c2pa : NEUTRAL_CHIP}
                        chipLabel={c2paCategory?.status === "detected" ? "1 manifest" : countsSafe.c2pa > 0 ? `${countsSafe.c2pa} fields` : "No manifest"}
                        chipTitle={c2paCategory?.status === "detected" ? "A C2PA/JUMBF manifest store was detected; validity is reported separately." : "No C2PA manifest store detected (or coverage incomplete)."}
                        ariaLabel="C2PA Content Credentials finding"
                      >
                        {tabs && tabs.c2pa.length > 0
                          ? categoryList(tabs.c2pa, true)
                          : (
                            <p className="rounded-xl bg-[#f7f9fd] px-3 py-2.5 text-[11.5px] text-slate-500">
                              {c2paCategory ? "Inspected — nothing in this group." : "This group is unavailable for this file."}
                            </p>
                          )}
                      </FindingRow>

                      {/* GPS */}
                      <FindingRow
                        testId="details-finding-gps"
                        tileTone={countsSafe.gps > 0 ? "bg-amber-50 text-amber-600" : "bg-slate-100 text-slate-400"}
                        tile={
                          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 21s-6.8-5.5-6.8-11A6.8 6.8 0 0 1 12 3.2 6.8 6.8 0 0 1 18.8 10c0 5.5-6.8 11-6.8 11Z" />
                            <circle cx="12" cy="10" r="2.4" />
                          </svg>
                        }
                        title="GPS location data"
                        description={countsSafe.gps > 0
                          ? "Contains location coordinates that can reveal where the photo was taken."
                          : "No GPS location metadata was found."}
                        chipTone={countsSafe.gps > 0 ? FAMILY_CHIP_TONES.gps : NEUTRAL_CHIP}
                        chipLabel={countsSafe.gps > 0 ? `${countsSafe.gps} GPS fields` : "None found"}
                        chipTitle={countsSafe.gps > 0 ? `${countsSafe.gps} GPS metadata field(s) detected.` : "Inspected; no GPS coordinates detected."}
                        ariaLabel="GPS location data finding"
                      >
                        {tabs && tabs.gps.length > 0
                          ? (
                            <>
                              {categoryList(tabs.gps, true)}
                              <p className="mt-2 text-[11px] text-slate-500">
                                GPS coordinates, where shown, are file metadata only — no place names are derived and no map is shown. GPS coordinate editing is not yet implemented.
                              </p>
                            </>
                          )
                          : (
                            <p className="rounded-xl bg-[#f7f9fd] px-3 py-2.5 text-[11.5px] text-slate-500">
                              {tabs && tabs.gps.length === 0 && tabs.gps.some((category) => category.status === "not_detected")
                                ? "Inspected — nothing in this group."
                                : "This group is unavailable for this file."}
                            </p>
                          )}
                      </FindingRow>

                      {/* Camera / device information */}
                      <FindingRow
                        testId="details-finding-camera"
                        tileTone={countsSafe.exif > 0 ? "bg-violet-50 text-violet-700" : "bg-slate-100 text-slate-400"}
                        tile={
                          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.7l1-1.5h3.6l1 1.5h3.7A2.5 2.5 0 0 1 20 8.5v9A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5v-9Z" />
                            <circle cx="12" cy="13" r="3.4" />
                          </svg>
                        }
                        title="Camera and device information"
                        description={countsSafe.exif > 0
                          ? "Contains camera model, device information and capture settings."
                          : "No EXIF camera or device metadata was found."}
                        chipTone={countsSafe.exif > 0 ? FAMILY_CHIP_TONES.exif : NEUTRAL_CHIP}
                        chipLabel={countsSafe.exif > 0 ? `${countsSafe.exif} EXIF tags` : "None found"}
                        chipTitle={countsSafe.exif > 0 ? `${countsSafe.exif} EXIF field(s) detected.` : "Inspected; no EXIF fields detected."}
                        ariaLabel="Camera and device information finding"
                      >
                        {tabs && tabs.exif.length > 0
                          ? categoryList(tabs.exif, true)
                          : (
                            <p className="rounded-xl bg-[#f7f9fd] px-3 py-2.5 text-[11.5px] text-slate-500">
                              {tabs && tabs.exif.some((category) => category.status === "not_detected")
                                ? "Inspected — nothing in this group."
                                : "This group is unavailable for this file."}
                            </p>
                          )}
                      </FindingRow>

                      {/* Descriptive metadata */}
                      <FindingRow
                        testId="details-finding-descriptive"
                        tileTone={countsSafe.xmp + countsSafe.iptc > 0 ? "bg-teal-50 text-teal-700" : "bg-slate-100 text-slate-400"}
                        tile={
                          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M6 3.5h12A1.5 1.5 0 0 1 19.5 5v14A1.5 1.5 0 0 1 18 20.5H6A1.5 1.5 0 0 1 4.5 19V5A1.5 1.5 0 0 1 6 3.5Z" />
                            <path d="M8 7h8M8 10.5h8M8 14h5" />
                          </svg>
                        }
                        title="Descriptive metadata"
                        description={countsSafe.xmp + countsSafe.iptc > 0
                          ? "Contains title, description, keywords and copyright information."
                          : "No XMP or IPTC descriptive metadata was found."}
                        chipTone={countsSafe.xmp + countsSafe.iptc > 0 ? "bg-[#eef2f7] text-[#43536e]" : NEUTRAL_CHIP}
                        chipLabel={countsSafe.xmp + countsSafe.iptc > 0
                          ? `${countsSafe.xmp} XMP + ${countsSafe.iptc} IPTC`
                          : "None found"}
                        chipTitle="Descriptive XMP and IPTC field counts detected in the file."
                        ariaLabel="Descriptive metadata finding"
                      >
                        {tabs && (tabs.xmp.length > 0 || tabs.iptc.length > 0)
                          ? (
                            <div className="grid gap-2">
                              {categoryList(tabs.xmp, true)}
                              {categoryList(tabs.iptc, true)}
                            </div>
                          )
                          : (
                            <p className="rounded-xl bg-[#f7f9fd] px-3 py-2.5 text-[11.5px] text-slate-500">
                              {tabs && (tabs.xmp.some((category) => category.status === "not_detected") || tabs.iptc.some((category) => category.status === "not_detected"))
                                ? "Inspected — nothing in this group."
                                : "This group is unavailable for this file."}
                            </p>
                          )}
                      </FindingRow>
                    </div>

                    {/* Verified outputs (cleaning / rewrite) — reused from Screen 04 */}
                    {cleaningResult || rewriteResult ? (
                      <div className="mt-5 grid gap-3" data-testid="details-verified-output">
                        <p className="text-[10px] font-bold uppercase tracking-[0.04em] text-slate-400" data-testid="details-original-caption">
                          Original findings · before cleaning
                        </p>
                        {cleaningResult ? (
                          <BeforeAfterPanel
                            result={cleaningResult}
                            embedded
                            headingId={`details-cleaning-heading-${entry.item.id}`}
                            onDownload={(finished) => onDownloadNotice(finished.outputName ?? finished.inputName)}
                          />
                        ) : null}
                        {rewriteResult ? (
                          <RewriteResultPanel
                            result={rewriteResult}
                            embedded
                            headingId={`details-rewrite-heading-${entry.item.id}`}
                            onDownload={(finished) => onDownloadNotice(finished.outputName ?? finished.inputName)}
                          />
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  {/* AI Evidence */}
                  <div
                    role="tabpanel"
                    id="details-panel-ai"
                    aria-labelledby="details-tab-ai"
                    data-testid="details-panel-ai"
                    hidden={tab !== "ai"}
                    className="mt-4"
                  >
                    {inspectionResult && inspectionResult.aiIndicators.length > 0 ? (
                      <>
                        <ul className="grid gap-2">
                          {inspectionResult.aiIndicators.map((indicator, index) => (
                            <AiIndicatorCard key={aiIndicatorReactKey(indicator, index)} indicator={indicator} />
                          ))}
                        </ul>
                        <p className="mt-2 text-[11px] font-medium text-slate-600">{AI_INDICATOR_DISCLAIMER}</p>
                        <p className="mt-1 text-[11px] text-slate-500">
                          {activeTool === "ai_metadata"
                            ? "Qualified AI indicators and Content Credentials are prioritized by the AI metadata tool. This is classified metadata evidence — never pixel-based AI detection."
                            : "Metadata inspection only — never pixel-based AI detection."}
                        </p>
                      </>
                    ) : (
                      <p className="rounded-xl bg-[#f7f9fd] px-4 py-3 text-[12px] text-slate-500">
                        {aiUnresolved
                          ? "AI evidence is not fully inspected because C2PA coverage is incomplete — no qualified indicators can be claimed."
                          : "No AI-associated metadata indicators found. "}
                        {AI_INDICATOR_DISCLAIMER}
                      </p>
                    )}
                  </div>

                  {/* C2PA */}
                  <div
                    role="tabpanel"
                    id="details-panel-c2pa"
                    aria-labelledby="details-tab-c2pa"
                    data-testid="details-panel-c2pa"
                    hidden={tab !== "c2pa"}
                    className="mt-4"
                  >
                    {/* Reading guide: presence / cryptographic state / signer
                        trust / failures are separate axes. The validator's
                        raw output below is reproduced unchanged. */}
                    <div className="mb-2 rounded-xl border border-[#dbe7f8] bg-[#eef4ff] p-3 text-[11.5px] leading-5 text-[#3b4a66]" data-testid="details-c2pa-legend">
                      <p className="text-[12px] font-extrabold text-[#16244a]">How to read these C2PA results</p>
                      <ul className="mt-1.5 grid list-disc gap-1 pl-4">
                        <li><strong>Manifest Store</strong> — whether a Content Credentials manifest is present at all (a provenance claim exists).</li>
                        <li><strong>Validation State</strong> — the validator&apos;s cryptographic result for the claim. A <strong>Valid</strong> claim means the signed bytes matched; it does <strong>not</strong> make the signer trusted.</li>
                        <li><strong>Validation failures</strong> — every reported code names what failed, separately: an untrusted credential is different from altered claim bytes or an expired certificate.</li>
                        <li><strong>Signer</strong> — who signed the claim. A signer being present is never the same as the signer being trusted.</li>
                      </ul>
                    </div>
                    {tabs && (tabs.c2pa.length > 0 ? (
                      <div data-testid="details-c2pa-sections">
                        {categoryList(tabs.c2pa, true)}
                        <p className="mt-2 text-[11px] text-slate-500">
                          A detected manifest describes provenance claims; validity/trust is reported by the embedded validator separately and presence alone never proves authenticity.
                        </p>
                      </div>
                    ) : emptyState(tabs.c2pa))}
                  </div>

                  {/* EXIF */}
                  <div
                    role="tabpanel"
                    id="details-panel-exif"
                    aria-labelledby="details-tab-exif"
                    data-testid="details-panel-exif"
                    hidden={tab !== "exif"}
                    className="mt-4"
                  >
                    {tabs && (tabs.exif.length > 0 ? categoryList(tabs.exif, true) : emptyState(tabs.exif))}
                  </div>

                  {/* XMP */}
                  <div
                    role="tabpanel"
                    id="details-panel-xmp"
                    aria-labelledby="details-tab-xmp"
                    data-testid="details-panel-xmp"
                    hidden={tab !== "xmp"}
                    className="mt-4"
                  >
                    {tabs && (tabs.xmp.length > 0 ? categoryList(tabs.xmp, true) : emptyState(tabs.xmp))}
                  </div>

                  {/* IPTC */}
                  <div
                    role="tabpanel"
                    id="details-panel-iptc"
                    aria-labelledby="details-tab-iptc"
                    data-testid="details-panel-iptc"
                    hidden={tab !== "iptc"}
                    className="mt-4"
                  >
                    {tabs && (tabs.iptc.length > 0 ? categoryList(tabs.iptc, true) : emptyState(tabs.iptc))}
                  </div>

                  {/* GPS */}
                  <div
                    role="tabpanel"
                    id="details-panel-gps"
                    aria-labelledby="details-tab-gps"
                    data-testid="details-panel-gps"
                    hidden={tab !== "gps"}
                    className="mt-4"
                  >
                    {tabs && (tabs.gps.length > 0 ? (
                      <>
                        {categoryList(tabs.gps, true)}
                        <p className="mt-2 text-[11px] text-slate-500">
                          GPS coordinates, where shown, are file metadata only — no place names are derived and no map is shown. GPS coordinate editing is not yet implemented.
                        </p>
                      </>
                    ) : emptyState(tabs.gps))}
                  </div>

                  {/* Technical */}
                  <div
                    role="tabpanel"
                    id="details-panel-technical"
                    aria-labelledby="details-tab-technical"
                    data-testid="details-panel-technical"
                    hidden={tab !== "technical"}
                    className="mt-4"
                  >
                    {tabs && (tabs.technical.length > 0 ? (
                      <>
                        <p className="mb-2 text-[11px] text-slate-500">
                          Container, geometry and color-profile details. These are marked as technical and are not treated as privacy findings.
                        </p>
                        {categoryList(tabs.technical, true)}
                      </>
                    ) : emptyState(tabs.technical))}
                  </div>
                </div>
                )}
              </section>
            </div>

            {/* Footer */}
            <footer data-testid="details-footer" className="flex flex-wrap items-center gap-3 border-t border-[#e6ebf3] bg-white px-4 py-3 sm:px-5">
              <div id="details-privacy-line" className="flex min-w-0 flex-1 items-start gap-2.5 rounded-2xl border border-[#dfe8f5] bg-[#eef4ff] p-3" data-testid="details-privacy-note">
                <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.7rem] bg-white text-[#2d5be9] shadow-[0_1px_2px_rgba(15,23,42,.06)]">
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="5.5" y="10.5" width="13" height="9" rx="2.2" />
                    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5M12 14v2" />
                  </svg>
                </span>
                <div className="min-w-0">
                  <p className="text-[12.5px] font-extrabold text-[#16244a]">Your files stay private</p>
                  <p className="mt-0.5 text-[11.5px] leading-4 text-[#5a6b85]">
                    All inspection and cleaning happens locally in your browser. Nothing is uploaded to any server.
                  </p>
                </div>
              </div>
              <button
                type="button"
                data-testid="details-close-footer"
                onClick={onClose}
                className="btn-secondary"
              >
                Close
              </button>
              <Tooltip label="Open the single-image metadata editor (Screen 06). This dialog closes while the editor is open." zClass="z-[120]" testId="details-edit-tooltip">
                <button
                  type="button"
                  data-testid="details-edit-footer"
                  onClick={() => onEditForImage(entry.item.id)}
                  className="btn-primary"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4.5 19.5 15 9l-3-3L4.5 16.5v3h3ZM14.5 7.5l2 2" />
                  </svg>
                  Edit metadata for this image
                </button>
              </Tooltip>
            </footer>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Honest disabled-removal explanation (title only; visible label kept). */
function removalNowTitle(processing: boolean, busyFlag: boolean, hasResult: boolean): string {
  if (!hasResult) return "Inspection has not completed for this file yet, so no removal scope is chosen.";
  if (processing) return "The verified processing pipeline is already running for this file.";
  if (busyFlag) return "Wait for the current inspection, processing or export task to finish.";
  return `Runs the existing verified metadata removal on this image. The original file in your queue is never modified.`;
}
