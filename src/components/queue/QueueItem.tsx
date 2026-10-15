"use client";

import { useEffect, useState } from "react";
import { formatBytes } from "../../lib/format-detection/format-bytes";
import type { CleaningStatus } from "../../lib/metadata/clean/types";
import type { RewriteStatus } from "../../lib/metadata/rewrite/rewrite";
import type { ImageInspectionResult, InspectionOutcome } from "../../types/inspection";
import type { QueueEntry } from "../../types/media";

function PhotoPlaceholder({ loading = false }: { loading?: boolean }) {
  return (
    <span className="flex h-full w-full items-center justify-center bg-slate-100 text-slate-400" aria-label={loading ? "Loading image preview" : "Image preview unavailable"}>
      {loading ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" /> : (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-7 w-7" fill="none">
          <rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.7" />
          <circle cx="9" cy="9" r="2" stroke="currentColor" strokeWidth="1.7" />
          <path d="m5.5 17 4.2-4.2 3.1 3.1 2.1-2.1 3.6 3.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

function ObjectUrlImage({ blob, onBroken }: { blob: Blob; onBroken?: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const next = URL.createObjectURL(blob);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" aria-hidden="true" className="h-full w-full object-cover" onError={onBroken} />
  ) : <PhotoPlaceholder loading />;
}

function ObjectUrlVideo({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const next = URL.createObjectURL(blob);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url ? <video src={url} muted playsInline controls preload="metadata" className="h-full w-full object-cover" /> : <PhotoPlaceholder loading />;
}

function HeicPreview({ source }: { source: File }) {
  const [nativeFailed, setNativeFailed] = useState(false);
  const [decoded, setDecoded] = useState<Blob | null>(null);
  const [decodeFailed, setDecodeFailed] = useState(false);

  useEffect(() => {
    if (!nativeFailed) return;
    let active = true;
    void import("heic-to/csp")
      .then(({ heicTo }) => heicTo({ blob: source, type: "image/jpeg", quality: 0.82 }))
      .then((preview) => {
        if (active) setDecoded(preview);
      })
      .catch(() => {
        if (active) setDecodeFailed(true);
      });
    return () => {
      active = false;
    };
  }, [nativeFailed, source]);

  if (decoded) return <ObjectUrlImage blob={decoded} />;
  if (decodeFailed) return <PhotoPlaceholder />;
  if (nativeFailed) return <PhotoPlaceholder loading />;
  return <ObjectUrlImage blob={source} onBroken={() => setNativeFailed(true)} />;
}

function Preview({ entry, enabled }: { entry: QueueEntry; enabled: boolean }) {
  if (!enabled) return <PhotoPlaceholder />;
  const extension = entry.item.detected.extension.toLowerCase();
  const brand = entry.item.detected.brand?.toLowerCase() ?? "";
  const heic = extension === "heic" || extension === "heif" || brand.startsWith("hei");
  if (heic) return <HeicPreview source={entry.source} />;
  if (entry.item.detected.mediaKind === "video") return <ObjectUrlVideo blob={entry.source} />;
  if (entry.item.detected.mediaKind !== "image") return <PhotoPlaceholder />;
  return <ObjectUrlImage blob={entry.source} />;
}

const CLEANING_STYLES: Record<string, string> = {
  cleaning: "bg-emerald-50 text-emerald-800",
  verified_clean: "bg-emerald-50 text-emerald-800",
  partially_cleaned: "bg-amber-50 text-amber-800",
  unchanged_no_target_tags: "bg-slate-100 text-slate-600",
  not_verified: "bg-amber-50 text-amber-800",
  unsupported: "bg-slate-100 text-slate-500",
  failed: "bg-red-50 text-red-700",
  cancelled: "bg-slate-100 text-slate-600",
};

function MetadataSummary({ result, state }: { result?: ImageInspectionResult; state?: InspectionOutcome | "inspecting" }) {
  if (state === "inspecting") {
    return <span className="inline-flex items-center gap-2 text-xs font-semibold text-blue-700"><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-700" />Scanning metadata…</span>;
  }
  if (!result) return <span className="text-xs text-slate-400">Waiting for automatic scan…</span>;

  const category = (names: string[]) => result.categories.find((item) => names.some((name) => item.category.toLowerCase().startsWith(name)));
  const groups = [
    { label: "EXIF", item: category(["exif"]) },
    { label: "GPS", item: category(["gps"]) },
    { label: "XMP", item: category(["xmp"]) },
    { label: "IPTC", item: category(["iptc"]) },
    { label: "Text", item: category(["png text"]) },
    { label: "C2PA", item: category(["c2pa"]) },
  ].filter((group) => group.item);
  const openAi = result.aiIndicators.some((item) => /openai|dall[ -]?e|chatgpt/i.test(`${item.label} ${item.matchedValue}`));

  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Automatic metadata inspection summary">
      {groups.map(({ label, item }) => {
        const detected = item?.status === "detected" && item.tags.length > 0;
        return <span key={label} className={`rounded-full border px-2 py-1 text-[10px] font-bold ${detected ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-400 grayscale"}`}>{label} {detected ? item?.tags.length : "0"}</span>;
      })}
      <span className={`rounded-full border px-2 py-1 text-[10px] font-bold ${result.aiIndicators.length > 0 ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-400 grayscale"}`}>{openAi ? "OpenAI" : "AI"} {result.aiIndicators.length}</span>
    </div>
  );
}

interface QueueItemProps {
  entry: QueueEntry;
  index: number;
  autoPreview: boolean;
  inspectionState: InspectionOutcome | "inspecting" | undefined;
  inspectionResult?: ImageInspectionResult;
  cleaningState: CleaningStatus | "cleaning" | undefined;
  hasCleaningResult: boolean;
  rewriteState?: RewriteStatus | "rewriting" | undefined;
  hasRewriteResult?: boolean;
  busy: boolean;
  cleanable: boolean;
  selected: boolean;
  partialOptedIn: boolean;
  rewriteEnabled?: boolean;
  onToggleSelect: (id: string) => void;
  onTogglePartial: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onInspect: (id: string) => void;
  onShow: (id: string) => void;
  onClean: (id: string) => void;
  onShowCleaning: (id: string) => void;
  onRewrite?: (id: string) => void;
  onShowRewrite?: (id: string) => void;
}

export default function QueueItem({
  entry, index, autoPreview, inspectionState, inspectionResult, cleaningState,
  hasCleaningResult, rewriteState, hasRewriteResult, busy, cleanable, selected, partialOptedIn,
  rewriteEnabled, onToggleSelect, onTogglePartial, onRetry, onRemove, onInspect, onShow,
  onClean, onShowCleaning, onRewrite, onShowRewrite,
}: QueueItemProps) {
  const { item } = entry;
  const outputIsBeingWritten = cleaningState === "cleaning";

  return (
    <li data-testid="queue-item" className={`grid gap-3 rounded-2xl border bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,.03)] transition lg:grid-cols-[2rem_4.75rem_minmax(10rem,1fr)_minmax(18rem,1.35fr)_auto_2.25rem] lg:items-center ${selected ? "border-blue-200 ring-1 ring-blue-100" : "border-slate-200"}`}>
      <div className="flex items-center justify-between lg:block">
        <input type="checkbox" checked={selected} onChange={() => onToggleSelect(item.id)} aria-label={`Select ${item.name}`} className="h-5 w-5 cursor-pointer accent-[#0d9474]" />
        <span className="text-[10px] font-bold text-slate-400 lg:hidden">#{index + 1}</span>
      </div>
      <div className="h-28 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 lg:h-[4.75rem] lg:w-[4.75rem]"><Preview entry={entry} enabled={autoPreview} /></div>
      <div className="min-w-0">
        <p className="truncate text-sm font-extrabold text-slate-900" title={item.name}>{item.name}</p>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500"><span className="rounded-full bg-slate-100 px-2 py-1 font-bold text-slate-700">{item.detected.label}</span><span>{formatBytes(item.sizeBytes)}</span><span className="hidden lg:inline">#{index + 1}</span></p>
        {item.notice ? <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-500">{item.notice}</p> : null}
      </div>
      <div className="min-w-0 rounded-xl bg-slate-50/80 p-2.5">
        <MetadataSummary result={inspectionResult} state={inspectionState} />
        {cleaningState ? <div className="mt-2 flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${CLEANING_STYLES[cleaningState] ?? "bg-slate-100 text-slate-600"}`}>{cleaningState === "cleaning" ? "Cleaning…" : cleaningState.replace(/_/g, " ")}</span>{cleaningState === "partially_cleaned" ? <label className="flex cursor-pointer items-center gap-1 text-[10px] font-semibold text-amber-800"><input type="checkbox" checked={partialOptedIn} onChange={() => onTogglePartial(item.id)} className="h-3.5 w-3.5 accent-amber-600" /> Include in ZIP</label> : null}{rewriteState ? <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-800">{rewriteState === "rewriting" ? "Rewriting…" : rewriteState.replace(/_/g, " ")}</span> : null}</div> : rewriteState ? <div className="mt-2 flex flex-wrap items-center gap-2"><span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-800">{rewriteState === "rewriting" ? "Rewriting…" : rewriteState.replace(/_/g, " ")}</span></div> : null}
      </div>
      <div className="flex flex-wrap gap-2 lg:justify-end">
        {inspectionResult ? <button type="button" onClick={() => onShow(item.id)} className="btn-secondary !min-h-10 !px-3 !py-2 text-xs">View details</button> : <button type="button" onClick={() => onInspect(item.id)} disabled={busy} className="btn-secondary !min-h-10 !px-3 !py-2 text-xs">{inspectionState === "inspecting" ? "Inspecting…" : "Inspect metadata"}</button>}
        {cleanable ? (hasCleaningResult ? <button type="button" onClick={() => onShowCleaning(item.id)} className="btn-success !min-h-10 !px-4 !py-2 text-xs">View result</button> : <button type="button" onClick={() => onClean(item.id)} disabled={busy} className="btn-success !min-h-10 !px-4 !py-2 text-xs" title={busy ? "Wait for the current task to finish." : "Remove the selected metadata types and verify the output."}>{cleaningState === "cleaning" ? "Cleaning…" : "Remove metadata"}</button>) : <span className="self-center text-[10px] font-semibold text-slate-400">Review only</span>}
        {cleanable && onRewrite ? (hasRewriteResult ? <button type="button" onClick={() => onShowRewrite?.(item.id)} className="btn-secondary !min-h-10 !px-3 !py-2 text-xs">View rewrite</button> : <button type="button" onClick={() => onRewrite(item.id)} disabled={busy || !rewriteEnabled} title={!rewriteEnabled ? "Sign in and set a profile to enable rewriting." : "Apply the current profile to this file."} className="btn-secondary !min-h-10 !px-3 !py-2 text-xs">{rewriteState === "rewriting" ? "Rewriting…" : "Rewrite"}</button>) : null}
        {cleaningState === "failed" || cleaningState === "not_verified" ? <button type="button" onClick={() => onRetry(item.id)} disabled={busy} className="btn-secondary !min-h-10 !px-3 !py-2 text-xs">Retry</button> : null}
      </div>
      <button type="button" onClick={() => onRemove(item.id)} aria-label={`Remove ${item.name} from queue`} data-testid={`queue-remove-${item.id}`} disabled={outputIsBeingWritten} className="flex h-9 w-9 items-center justify-center justify-self-end rounded-full border border-slate-200 text-xl leading-none text-slate-400 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-40" title="Remove from queue">×</button>
    </li>
  );
}
