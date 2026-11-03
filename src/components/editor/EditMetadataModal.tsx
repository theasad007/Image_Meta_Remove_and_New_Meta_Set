"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ChevronDown } from "lucide-react";
import RewriteResultPanel from "../rewrite/RewriteResultPanel";
import Tooltip from "../ui/tooltip";
import { useDialogChrome, useDialogFocusTrap } from "../ui/dialog-chrome";
import { Preview, PreviewFallback, useEntryPreview } from "../queue/queue-previews";
import { formatBytes } from "../../lib/format-detection/format-bytes";
import type { SniffedKind } from "../../lib/format-detection/signatures";
import { sniffImageBytes } from "../../lib/format-detection/signatures";
import {
  DEFAULT_REWRITE_MAX_BYTES,
  type FileRewriteResult,
  type RewriteMode,
  browserXmlCodec,
} from "../../lib/metadata/rewrite/rewrite";
import {
  PROFILE_FIELDS,
  PROFILE_LIMITS,
  isProfileEmpty,
  type MetadataProfile,
  type ProfileField,
} from "../../lib/metadata/rewrite/fields";
import { planFieldWrite } from "../../lib/metadata/rewrite/writes";
import { observeFieldValues } from "../../lib/metadata/rewrite/verify-fields";
import {
  blankEditorDraft,
  buildEditorPreview,
  editorDraftHasValues,
  editorFieldLabel,
  editorKeywordList,
  editorPlanFor,
  type EditorApplyPlan,
  type EditorDraft,
  type EditorSource,
} from "../../lib/workspace/editor-state";
import { dimensionsOf } from "../../lib/workspace/summary";
import type { ImageInspectionResult, InspectionOutcome } from "../../types/inspection";
import type { QueueEntry } from "../../types/media";
import type { GpsCoordinates } from "../../lib/metadata/rewrite/gps";
import type { ProjectRecord } from "../../lib/projects/project-schema";
import { projectToProfile } from "../../lib/projects/project-schema";
import type { ProjectSummary } from "../../lib/firebase/projects";
import type { GeoDraft, GeoOperation } from "../../lib/workspace/geotag-state";
import GeoTagEditor from "../geotag/GeoTagEditor";

/**
 * Screen 06 — Single-image Edit Metadata dialog.
 *
 * A guest-accessible per-image metadata editor wired to the existing
 * verified rewrite pipeline. Every writable field maps to a real, tested
 * writer channel (`planFieldWrite`); unsupported capabilities are never
 * faked. The Location (GPS) tab hosts the Screen 09 GeoTag editor (real
 * verified GPS write/remove on the same pipeline); the Basic Info,
 * Advanced and Preset & Profile tabs are unchanged.
 *
 * Source precedence is enforced by `editorPlanFor` (pure layer): an
 * image-specific custom draft fully REPLACES the saved profile for that
 * image — the two sources are never merged (spec Rule C). The saved
 * profile is only available to signed-in users and is never edited here.
 */

const EDITOR_TABS = [
  { id: "basic", label: "Basic info" },
  { id: "location", label: "Location (GPS)" },
  { id: "advanced", label: "Advanced" },
  { id: "preset", label: "Preset & Profile" },
] as const;

type EditorTab = (typeof EDITOR_TABS)[number]["id"];

const BASIC_FIELDS: ProfileField[] = [
  "company",
  "creator",
  "copyright",
  "rightsOwner",
  "website",
  "contact",
  "title",
  "description",
  "keywords",
];

/** Hints show the real writer channels per field (from writes.ts). */
const FIELD_HINTS: Record<ProfileField, string> = {
  company: "XMP dc:publisher · JPEG IPTC 2:110 Credit",
  creator: "EXIF Artist (315) · XMP dc:creator · JPEG IPTC 2:80 By-line",
  copyright: "EXIF Copyright (33432) · XMP dc:rights · JPEG IPTC 2:116",
  rightsOwner: "XMP xmpRights:Owner (no EXIF/IPTC home)",
  website: "XMP Iptc4xmpCore CreatorContactInfo/UrlWork — http(s) only, never fetched",
  contact: "XMP dc:contributor · JPEG IPTC 2:118",
  title: "EXIF DocumentName (269) · XMP dc:title · JPEG IPTC 2:5",
  description: "EXIF ImageDescription (270) · XMP dc:description · JPEG IPTC 2:120",
  keywords: "XMP dc:subject Bag · JPEG IPTC 2:25 per keyword (deduped)",
  locationName: "XMP Iptc4xmpCore:Location · JPEG IPTC 2:92 Sub-location (descriptive text only)",
};

const FIELD_PLACEHOLDERS: Record<ProfileField, string> = {
  company: "Company or publisher name",
  creator: "Creator or author name",
  copyright: "Copyright notice text",
  rightsOwner: "Rights owner name",
  website: "https://example.com",
  contact: "Contact information",
  title: "Image title",
  description: "Image description",
  keywords: "keyword-one, keyword-two (max 30 unique)",
  locationName: "Descriptive location name (not coordinates)",
};

const MULTILINE_FIELDS: ReadonlySet<ProfileField> = new Set(["description"]);

/** MP3 labels (Phase 10/11): the real ID3 destination per field. Fields
 *  without a verified target say so — nothing pretends to write. */
const AUDIO_FIELD_LABELS: Partial<Record<ProfileField, string>> = {
  company: "Publisher (ID3 TPUB)",
  creator: "Artist (ID3 TPE1)",
  copyright: "Copyright (ID3 TCOP)",
  rightsOwner: "Rights owner (unsupported for MP3)",
  contact: "Contact information (unsupported for MP3)",
  title: "Audio title (ID3 TIT2)",
  description: "Comment (ID3 COMM)",
  keywords: "Keywords (ID3 TXXX:KEYWORDS)",
  locationName: "Location name (ID3 TXXX:LOCATION — descriptive, not GPS)",
  website: "Website (ID3 WXXX)",
};
/** Keywords accept commas, newlines and semicolons — a textarea is required
 *  (single-line <input> values strip line breaks per the HTML spec). */
const KEYWORD_TEXTAREA_ROWS = 2;

export interface EditMetadataModalProps {
  entry: QueueEntry | undefined;
  draft: EditorDraft;
  inspectionResult: ImageInspectionResult | undefined;
  inspectionState: InspectionOutcome | "inspecting" | undefined;
  savedProfile: MetadataProfile;
  signedIn: boolean;
  /** Phase 05: the signed-in user's saved projects (summaries + cached
   *  details for the selected id). Empty for guests. */
  projects: ProjectSummary[];
  projectDetails: Record<string, ProjectRecord>;
  result: FileRewriteResult | undefined;
  progress: string | null;
  busy: boolean;
  onFieldChange: (field: ProfileField, value: string) => void;
  onModeChange: (mode: RewriteMode) => void;
  onSourceChange: (source: EditorSource) => void;
  /** Phase 05: selects a saved project (also switches source to project). */
  onProjectSelect: (projectId: string | null) => void;
  onSaveDraft: (draft: EditorDraft) => void;
  onDiscardDraft: () => void;
  /** Copies the current saved-profile values into the custom form —
   *  an independent image-specific copy (never a live merge). */
  onCopyProfileIntoDraft: () => void;
  /** Starts the verified single-file rewrite for this image. */
  onApply: (plan: EditorPlanPayload) => void;
  /** Screen 09: per-image GeoTag draft, keyed by file id upstream. */
  geoDraft: GeoDraft;
  /** GPS operation currently in flight for any file (page-owned lifecycle). */
  geoPendingOp: "write" | "remove" | null;
  /** Screen 09: draft edits surface straight to the page store. */
  onGeoDraftChange: (draft: GeoDraft) => void;
  /** Last GPS operation applied for this file (badge honesty). */
  geoLastOperation: "write" | "remove" | null;
  /** Selected queue-image count for the bulk scope preview. */
  selectedImageCount: number;
  /** Screen 09: runs the verified GPS write/remove via the same pipeline. */
  onGeoApply: (operation: GeoOperation, coords: GpsCoordinates | null) => void;
  /** Screen 09: bulk-apply the planned GPS operation to the selected snapshot. */
  onGeoApplyBulk: (operation: GeoOperation, coords: GpsCoordinates | null) => void;
  /** Page announcement (aria-live). */
  onAnnounce: (message: string) => void;
  /** Returns to the Screen 05 details dialog for this file. */
  onViewDetails: () => void;
  onDownloadNotice: (name: string) => void;
  onClose: () => void;
}

export interface EditorPlanPayload {
  profile: MetadataProfile;
  selectedFields: ProfileField[];
  mode: RewriteMode;
  /** Phase 05: selected saved-project id (premium apply path). */
  projectId: string | null;
  /** Phase 05: the project's GPS coordinates (verified write directive). */
  gps: GpsCoordinates | null;
}

interface DetectedReadout {
  fileId: string;
  fields: Partial<Record<ProfileField, string>>;
}

/** Read the mapped standard locations from the original bytes (honest read). */
async function readDetectedEditableValues(entry: QueueEntry): Promise<Partial<Record<ProfileField, string>>> {
  const head = new Uint8Array(await entry.source.slice(0, Math.min(65536, entry.source.size)).arrayBuffer());
  const sniff = sniffImageBytes(head, entry.source.size, entry.item.detected.extension);
  const bytes = new Uint8Array(await entry.source.arrayBuffer());
  const plans = PROFILE_FIELDS.filter((field) => field !== "keywords").map((field) => planFieldWrite(field, "", []));
  // Keyword probe so dc:subject / IPTC 2:25 become observable per field.
  plans.push(planFieldWrite("keywords", "", ["probe"]));
  const observed = observeFieldValues(bytes, sniff.kind, plans, browserXmlCodec());
  const fields: Partial<Record<ProfileField, string>> = {};
  for (const field of PROFILE_FIELDS) {
    const seen = observed.get(field);
    if (!seen) continue;
    const single = [...seen.singles.values()].find((value) => value.trim() !== "") ?? "";
    if (single.trim() !== "") {
      fields[field] = single;
      continue;
    }
    const multi = [...seen.multis.values()].flat().filter((value) => value.trim() !== "");
    if (multi.length > 0) fields[field] = multi.join(", ");
  }
  return fields;
}

function heicHintOf(entry: QueueEntry): boolean {
  const extension = entry.item.detected.extension.toLowerCase();
  const brand = entry.item.detected.brand?.toLowerCase() ?? "";
  return extension === "heic" || extension === "heif" || brand.startsWith("hei");
}

function sniffKindOf(entry: QueueEntry): SniffedKind {
  // The bytes-based kind lives behind an async sniff; the queue's verified
  // integer mapping is equivalent for preview notes. Map detected extension
  // onto the same vocabulary the writers use.
  const label = entry.item.detected.label.toUpperCase();
  if (label.startsWith("JPEG") || label.startsWith("JPG")) return "jpeg";
  if (label === "PNG") return "png";
  if (label.startsWith("WEBP")) return "webp";
  if (label === "AVIF") return "avif";
  if (label.startsWith("HEIC") || label.startsWith("HEIF")) return "heic";
  return "unknown";
}

export default function EditMetadataModal({
  entry,
  draft,
  inspectionResult,
  inspectionState,
  savedProfile,
  signedIn,
  projects,
  projectDetails,
  result,
  progress,
  busy,
  onFieldChange,
  onModeChange,
  onSourceChange,
  onProjectSelect,
  onSaveDraft,
  onDiscardDraft,
  onCopyProfileIntoDraft,
  onApply,
  geoDraft,
  geoPendingOp,
  onGeoDraftChange,
  geoLastOperation,
  selectedImageCount,
  onGeoApply,
  onGeoApplyBulk,
  onAnnounce,
  onViewDetails,
  onDownloadNotice,
  onClose,
}: EditMetadataModalProps) {
  const open = Boolean(entry);
  const panelRef = useRef<HTMLDivElement>(null);
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const [pendingDetected, setPendingDetected] = useState<DetectedReadout | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [detectedNotice, setDetectedNotice] = useState<string | null>(null);

  const isImage = Boolean(entry && entry.item.detected.mediaKind === "image");
  const dimensions = inspectionResult ? dimensionsOf(inspectionResult) : null;

  /** Switching files resets tab + preview + discard privacy (never leaks). */
  const entryId = entry?.item.id ?? null;
  const [viewState, setViewState] = useState<{ fileId: string | null; tab: EditorTab; previewOpen: boolean }>({
    fileId: null,
    tab: "basic",
    previewOpen: false,
  });
  if (viewState.fileId !== entryId) {
    setViewState({ fileId: entryId, tab: "basic", previewOpen: false });
  }
  const tab: EditorTab = viewState.fileId === entryId ? viewState.tab : "basic";
  const previewOpen = viewState.fileId === entryId ? viewState.previewOpen : false;
  const setTab = (next: EditorTab) => setViewState({ fileId: entryId, tab: next, previewOpen });
  const togglePreview = () => setViewState({ fileId: entryId, tab, previewOpen: !previewOpen });

  /** The draft's selected project record (details cached by the page). */
  const selectedProject = draft.projectId ? projectDetails[draft.projectId] ?? null : null;
  const plan = useMemo(
    () => editorPlanFor(draft, savedProfile, selectedProject),
    [draft, savedProfile, selectedProject],
  );
  const keywordsCount = editorKeywordList(draft.values.keywords ?? "").length;
  const detectedValuesForFile = pendingDetected && pendingDetected.fileId === entryId ? pendingDetected.fields : null;
  const detectionEligible = Boolean(isImage && entry && entry.source.size <= DEFAULT_REWRITE_MAX_BYTES);
  const kind: SniffedKind = entry ? (isImage ? sniffKindOf(entry) : "unknown") : "unknown";
  const editorPreview = useMemo(
    () => (previewOpen && plan.canApply && isImage ? buildEditorPreview(plan, kind === "unknown" ? "jpeg" : kind) : null),
    [previewOpen, plan, isImage, kind],
  );

  const focusTrap = useDialogFocusTrap(panelRef);
  const openerSelector = entryId ? `[data-queue-id="${CSS.escape(entryId)}"] [data-editor-open]` : null;
  useDialogChrome({ open, onClose, panelRef, openerSelector });

  const { url: previewUrl, status: previewStatus } = useEntryPreview(entry);

  /** One action: read the mapped channels, then fill EMPTY form fields from
   *  the actual file values (explicit user action — privacy note shown).
   *  Already-typed draft values are never clobbered. */
  const applyDetectedValues = async () => {
    if (!entry || detecting || !detectionEligible) return;
    setDetecting(true);
    setDetectError(null);
    setDetectedNotice(null);
    try {
      const fields = await readDetectedEditableValues(entry);
      setPendingDetected({ fileId: entry.item.id, fields });
      const next = blankEditorDraft(draft.mode);
      let copied = 0;
      for (const field of PROFILE_FIELDS) {
        const found = (fields[field] ?? "").trim();
        const existing = (draft.values[field] ?? "").trim();
        if (found !== "" && existing === "") {
          next.values[field] = found;
          copied += 1;
        } else {
          next.values[field] = existing;
        }
      }
      onSaveDraft(next);
      setDetectedNotice(copied > 0
        ? `Copied ${copied} detected value${copied === 1 ? "" : "s"} into the empty form fields. This reinserts the image's existing data — replace mode strips it again before your values are written.`
        : "Nothing to copy — either no mapped editable values exist or all of them already have form entries.");
    } catch {
      setPendingDetected(null);
      setDetectError("The mapped editable values could not be read from this file.");
    } finally {
      setDetecting(false);
    }
  };

  if (!open || !entry) return null;

  const counts = {
    hasResult: Boolean(inspectionResult),
    ai: inspectionResult?.aiIndicators.length ?? 0,
    c2pa: inspectionResult?.categories.find((category) => category.category.toLowerCase().startsWith("c2pa"))?.status === "detected" ? 1 : 0,
    exif: inspectionResult?.categories.find((category) => category.category.toLowerCase().startsWith("exif"))?.tags.length ?? 0,
    gps: inspectionResult?.categories.find((category) => category.category.toLowerCase().startsWith("gps"))?.tags.length ?? 0,
    xmp: inspectionResult?.categories.find((category) => category.category.toLowerCase().startsWith("xmp"))?.tags.length ?? 0,
    iptc: inspectionResult?.categories.find((category) => category.category.toLowerCase().startsWith("iptc"))?.tags.length ?? 0,
  };

  const detectedChips: Array<{ label: string; value: string; tone: string }> = [
    { label: "AI", value: counts.hasResult ? String(counts.ai) : "—", tone: "bg-red-50 text-red-600" },
    { label: "C2PA", value: counts.hasResult ? String(counts.c2pa) : "—", tone: "bg-[#e9f2fe] text-[#2d5be9]" },
    { label: "EXIF", value: counts.hasResult ? String(counts.exif) : "—", tone: "bg-indigo-50 text-indigo-700" },
    { label: "GPS", value: counts.hasResult ? String(counts.gps) : "—", tone: "bg-rose-50 text-rose-700" },
    { label: "XMP", value: counts.hasResult ? String(counts.xmp) : "—", tone: "bg-violet-50 text-violet-700" },
    { label: "IPTC", value: counts.hasResult ? String(counts.iptc) : "—", tone: "bg-teal-50 text-teal-700" },
  ];

  const draftHasValues = editorDraftHasValues(draft);
  const savedProfileUsable = signedIn && !isProfileEmpty(savedProfile);
  /** Phase 10/11: MP3 files rewrite through the ID3 engine — same editor,
   *  audio-honest labels; GPS controls never claim to write to audio. */
  const isAudio = Boolean(entry && entry.item.detected.mediaKind === "audio");
  const applyDisabledReason = !isImage && !isAudio
    ? "Metadata editing is available for still images and MP3 audio — this file is preview-only."
    : busy
      ? "Wait for the current rewrite to finish."
      : plan.blockedReason ?? null;
  const applyReady = (isImage || isAudio) && plan.canApply && !busy;

  return createPortal(
    <div
      className="fixed inset-0 z-[90] overflow-y-auto bg-slate-950/55"
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        onClose();
      }}
    >
      <div className="mx-auto flex min-h-full w-full max-w-[74rem] items-start justify-center sm:px-6 sm:py-8">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="editor-title"
          aria-describedby="editor-subtitle"
          tabIndex={-1}
          data-testid="editor-modal"
          onKeyDown={focusTrap}
          className="flex h-full w-full flex-col overflow-hidden rounded-none bg-[#f7f9fd] text-[#16244a] shadow-[0_30px_90px_rgba(15,23,42,.4)] outline-none sm:h-auto sm:max-h-[calc(100dvh-4rem)] sm:min-h-0 sm:rounded-[1.4rem] sm:ring-1 sm:ring-slate-900/10"
        >
          {/* Header */}
          <header data-testid="editor-header" className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-[#e6ebf3] bg-white px-4 py-3 sm:px-5">
            <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#e9f2fe] text-[#2d5be9]">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4.5 19.5 15 9l-3-3L4.5 16.5v3h3ZM14.5 7.5l2 2" />
              </svg>
            </span>
            <div className="min-w-0 flex-1 basis-[14rem]">
              <p id="editor-title" data-testid="editor-title" className="text-[16px] font-extrabold tracking-[-0.01em] text-[#16244a]">Edit Metadata</p>
              <p id="editor-subtitle" data-testid="editor-subtitle" className="mt-0.5 text-[11.5px] font-semibold text-[#5a6b85]">
                Update metadata for this image. Changes apply only to this file.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5" data-testid="editor-status-chips">
              {busy ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2 py-0.5 text-[10.5px] font-bold text-blue-700">
                  <span aria-hidden="true" className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />
                  Rewriting…
                </span>
              ) : result ? (
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${result.status === "verified_rewritten" ? "bg-emerald-50 text-emerald-800" : result.status === "partially_rewritten" ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-700"}`}>
                  {result.status.replace(/_/g, " ")}
                </span>
              ) : inspectionState === "completed" ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-bold text-emerald-800">
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m4.5 10.5 3.4 3.4 7.6-8" />
                  </svg>
                  Inspection completed
                </span>
              ) : null}
            </div>
            <button
              type="button"
              data-testid="editor-close"
              aria-label="Close edit metadata"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-slate-500 hover:border-slate-200 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-3 focus-visible:outline-[#2d5be9]"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
            <p className="w-full truncate text-[11px] font-semibold text-[#5a6b85]" data-testid="editor-file-meta">
              <Tooltip label={entry.item.name} zClass="z-[120]">
                <span className="font-extrabold text-[#16244a]">{entry.item.name}</span>
              </Tooltip>
              {" · "}
              <span className="font-bold text-[#43536e]">{entry.item.detected.label}</span>
              {" · "}
              <span className="tabular-nums">{formatBytes(entry.item.sizeBytes)}</span>
              {dimensions ? <span className="tabular-nums"> · {dimensions}</span> : null}
            </p>
          </header>

          {/* Body */}
          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-3 sm:p-5 lg:grid-cols-[minmax(16.5rem,21rem)_minmax(0,1fr)]" data-testid="editor-body">
            {/* Left column: image + detected findings */}
            <aside className="min-w-0" data-testid="editor-left-column">
              <div data-testid="editor-preview" className="rounded-2xl border border-[#e6ebf3] bg-white p-1.5 shadow-[0_1px_2px_rgba(15,23,42,.04)]">
                <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl bg-[#edf2f9]">
                  {previewUrl && previewStatus !== "failed" && entry.item.detected.mediaKind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img data-testid="editor-preview-img" src={previewUrl} alt={`${entry.item.name} preview`} decoding="async" className="h-full w-full object-contain" />
                  ) : entry.item.detected.mediaKind !== "image" ? (
                    <Preview entry={entry} enabled fit="contain" />
                  ) : previewStatus === "failed" ? (
                    <PreviewFallback heicHint={heicHintOf(entry)} spinning={false} />
                  ) : (
                    <PreviewFallback heicHint={heicHintOf(entry)} spinning />
                  )}
                </div>
              </div>

              <div className="mt-3 rounded-2xl border border-[#e6ebf3] bg-white p-3.5" data-testid="editor-file-info">
                <p className="break-all text-[13px] font-extrabold text-[#16244a]">{entry.item.name}</p>
                <p className="mt-0.5 text-[11.5px] font-semibold text-[#5a6b85]">
                  <span className="font-bold text-[#43536e]">{entry.item.detected.label}</span>
                  {" · "}
                  <span className="tabular-nums">{formatBytes(entry.item.sizeBytes)}</span>
                  {dimensions ? <span className="tabular-nums"> · {dimensions}</span> : null}
                  {inspectionResult?.detectedBrand ? ` · brand ${inspectionResult.detectedBrand}` : ""}
                </p>
              </div>

              <div className="mt-3 rounded-2xl border border-[#e6ebf3] bg-white p-3.5" data-testid="editor-counts">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[13px] font-extrabold text-[#16244a]">Detected metadata</p>
                  <span className="text-[10px] font-bold uppercase tracking-[0.04em] text-slate-400">Original inspection</span>
                </div>
                <p className="mt-1 text-[11.5px] leading-4 text-[#5a6b85]">Read-only findings from the byte-level inspector — not editable counts.</p>
                <div className="mt-2 grid grid-cols-3 gap-1.5" aria-label="Metadata counts per family">
                  {detectedChips.map((chip) => (
                    <span key={chip.label} className={`flex items-center justify-between rounded-lg px-2 py-1 text-[10.5px] font-bold ${chip.tone}`}>
                      {chip.label}
                      <span className="tabular-nums">{chip.value}</span>
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-3 grid gap-2">
                <button
                  type="button"
                  data-testid="editor-view-details"
                  onClick={onViewDetails}
                  className="inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[12.5px] font-bold text-[#35435c] hover:bg-slate-50 focus-visible:outline-3 focus-visible:outline-[#2d5be9]"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2.5 12s3.6-6.2 9.5-6.2S21.5 12 21.5 12s-3.6 6.2-9.5 6.2S2.5 12 2.5 12Z" />
                    <circle cx="12" cy="12" r="2.6" />
                  </svg>
                  View full metadata details
                </button>
                <Tooltip label={detectionEligible
                  ? "Reads this file's editable fields from the mapped standard locations. Copying them keeps image-identifying data; replace mode strips it again before writing."
                  : "Reading detected values requires an eligible still image within the 64 MB rewrite budget."}
                  zClass="z-[120]"
                  testId="editor-use-detected-tooltip"
                >
                  <button
                    type="button"
                    data-testid="editor-use-detected"
                    disabled={!detectionEligible || detecting || !isImage}
                    onClick={() => void applyDetectedValues()}
                    title={detecting ? "Reading detected editable values…" : undefined}
                    className="inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[12.5px] font-bold text-[#35435c] hover:bg-slate-50 focus-visible:outline-3 focus-visible:outline-[#2d5be9] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {detecting ? "Reading values…" : "Use detected editable values"}
                  </button>
                </Tooltip>
                {detectedValuesForFile ? (
                  <details className="rounded-xl border border-[#e6ebf3] bg-white px-3 py-2" data-testid="editor-detected-list">
                    <summary className="flex cursor-pointer list-none items-center justify-between text-[11.5px] font-bold text-[#35435c] [&::-webkit-details-marker]:hidden">
                      Detected editable values
                      <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 text-slate-400" />
                    </summary>
                    <dl className="mt-2 grid gap-1 text-[11px]">
                      {PROFILE_FIELDS.map((field) => {
                        const value = detectedValuesForFile[field];
                        return (
                          <div key={field} className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] gap-2 border-t border-slate-100 py-1 first:border-t-0">
                            <dt className="font-semibold text-slate-500">{editorFieldLabel(field)}</dt>
                            <dd className="break-all text-slate-700">{value?.trim() ? value : <span className="text-slate-400">—</span>}</dd>
                          </div>
                        );
                      })}
                    </dl>
                  </details>
                ) : null}
                {detectError ? <p className="text-[11.5px] font-medium text-red-700" role="status">{detectError}</p> : null}
                {detectedNotice ? <p className="text-[11.5px] font-medium text-[#375a37]" role="status">{detectedNotice}</p> : null}
              </div>
            </aside>

            {/* Right column: tabbed editor */}
            <section aria-label="Metadata editor" data-testid="editor-panel" className="min-w-0 rounded-2xl border border-[#e6ebf3] bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,.04)] sm:p-4">
              <div
                id="editor-tablist"
                role="tablist"
                aria-label="Editor sections"
                data-testid="editor-tabs"
                className="flex max-w-full gap-0.5 overflow-x-auto rounded-xl bg-[#eef2f7] p-1"
              >
                {EDITOR_TABS.map((definition) => (
                  <button
                    key={definition.id}
                    type="button"
                    role="tab"
                    id={`editor-tab-${definition.id}`}
                    data-testid={`editor-tab-${definition.id}`}
                    data-tab={definition.id}
                    aria-selected={tab === definition.id}
                    aria-controls={`editor-panel-${definition.id}`}
                    tabIndex={tab === definition.id ? 0 : -1}
                    onClick={() => setTab(definition.id)}
                    className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-[0.65rem] px-2 py-1.5 text-[12.5px] font-bold focus-visible:outline-3 focus-visible:outline-[#2d5be9] ${
                      tab === definition.id
                        ? "bg-white text-[#2d5be9] shadow-[0_1px_3px_rgba(15,23,42,.12)]"
                        : "text-[#43536e] hover:bg-white/70"
                    }`}
                  >
                    {definition.label}
                  </button>
                ))}
              </div>

              <div>
                {/* Basic info */}
                <div
                  role="tabpanel"
                  id="editor-panel-basic"
                  aria-labelledby="editor-tab-basic"
                  data-testid="editor-panel-basic"
                  hidden={tab !== "basic"}
                  className="mt-3"
                >
                  {entry.item.detected.mediaKind !== "image" && entry.item.detected.mediaKind !== "audio" ? (
                    <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-[12px] font-medium text-amber-900" data-testid="editor-unsupported-note">
                      This file type is preview-only in this app. Metadata inspection, cleaning and rewriting are not available for it, so nothing here can be edited. This is an honest limitation, not a lock.
                    </p>
                  ) : null}
                  {isAudio ? (
                    <p className="rounded-xl bg-[#eef2ff] px-3 py-2.5 text-[12px] font-medium text-[#3f4bb8]" data-testid="editor-audio-note">
                      MP3 editing writes real ID3 tags (destinations shown per field) and preserves the encoded
                      audio byte-for-byte — verified by re-reading the output. Rights owner and contact have no
                      verified ID3 frame and are reported unsupported rather than guessed.
                    </p>
                  ) : null}
                  <p className="mt-1 text-[11.5px] text-[#5a6b85]">
                    Supported fields write into this image&apos;s standard metadata locations; other inputs are intentionally absent because no verified writer supports them.
                  </p>
                  <div className="mt-3 grid gap-3">
                    {BASIC_FIELDS.map((field) => (
                      <EditorFieldRow
                        key={field}
                        field={field}
                        draft={draft}
                        plan={plan}
                        keywordsCount={keywordsCount}
                        detectedValue={detectedValuesForFile?.[field] ?? ""}
                        disabled={!isImage && !isAudio}
                        audio={isAudio}
                        onChange={onFieldChange}
                      />
                    ))}
                  </div>
                  {plan && plan.blockedReason && plan.canApply === false ? (
                    <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[12px] font-medium text-amber-900" data-testid="editor-blocked-reason" role="status">
                      {plan.blockedReason}
                    </p>
                  ) : null}
                </div>

                {/* Location (GPS) — Screen 06 fields + Screen 09 GeoTag editor */}
                <div
                  role="tabpanel"
                  id="editor-panel-location"
                  aria-labelledby="editor-tab-location"
                  data-testid="editor-panel-location"
                  hidden={tab !== "location"}
                  className="mt-3"
                >
                  {isAudio ? (
                    <div className="rounded-xl border border-[#e6ebf3] bg-[#f7f9fd] p-3" data-testid="editor-gps-na-audio">
                      <p className="text-[12.5px] font-extrabold text-[#16244a]">GPS — N/A for MP3</p>
                      <p className="mt-0.5 text-[11.5px] leading-4 text-[#5a6b85]">
                        MP3 files have no verified interoperable GPS metadata standard. GPS coordinates are
                        never written to or read from audio here — the Location Name field on the Basic info tab
                        remains a descriptive text tag.
                      </p>
                    </div>
                  ) : (
                  <>
                  <EditorFieldRow
                    field="locationName"
                    draft={draft}
                    plan={plan}
                    keywordsCount={keywordsCount}
                    detectedValue={detectedValuesForFile?.locationName ?? ""}
                    disabled={!isImage}
                    onChange={onFieldChange}
                  />
                  <p className="mt-2 text-[11px] leading-4 text-[#5a6b85]" data-testid="editor-gps-note">
                    Location Name above is descriptive text written into standard metadata — it is never
                    interpreted as coordinates. The editor below writes or removes real GPS coordinates through
                    the verified engine; guests can use it without signing in.
                  </p>
                  <div className="mt-3">
                    <GeoTagEditor
                      fileId={entry.item.id}
                      fileName={entry.item.name}
                      formatLabel={entry.item.detected.label}
                      sizeLabel={formatBytes(entry.item.sizeBytes)}
                      isImage={isImage}
                      gpsSupportedFormat={kind !== "unknown"}
                      inspection={inspectionResult}
                      draft={geoDraft}
                      resultStatus={result?.status}
                      gpsChanges={result?.changes.filter((change) => change.group === "GPS") ?? []}
                      lastOperation={geoLastOperation}
                      busy={busy}
                      selectedCount={selectedImageCount}
                      pendingOp={geoPendingOp}
                      resultAfter={result?.after}
                      sharedApplyAvailable={applyReady}
                      onDraftChange={onGeoDraftChange}
                      onApply={onGeoApply}
                      onApplyBulk={onGeoApplyBulk}
                      onAnnounce={onAnnounce}
                    />
                  </div>
                  </>
                  )}
                </div>

                {/* Advanced */}
                <div
                  role="tabpanel"
                  id="editor-panel-advanced"
                  aria-labelledby="editor-tab-advanced"
                  data-testid="editor-panel-advanced"
                  hidden={tab !== "advanced"}
                  className="mt-3"
                >
                  <fieldset className="grid gap-2" data-testid="editor-mode">
                    <legend className="text-[12.5px] font-extrabold text-[#16244a]">Rewrite mode</legend>
                    <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-[#e6ebf3] bg-white p-3">
                      <input
                        type="radio"
                        name="editor-mode"
                        checked={draft.mode === "replace_editable"}
                        onChange={() => onModeChange("replace_editable")}
                        className="mt-0.5 h-4 w-4 accent-[#0d9474]"
                      />
                      <span className="text-[12px] leading-5 text-[#3b4a66]">
                        <strong className="text-[#16244a]">Replace removable editable metadata, then write</strong> (default, privacy-conscious) — removes existing removable non-technical metadata with the verified cleaner first, then writes the selected supported fields. Technical ICC, orientation and the encoded pixels stay intact. Retained unsupported provenance is disclosed.
                      </span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-[#e6ebf3] bg-white p-3">
                      <input
                        type="radio"
                        name="editor-mode"
                        checked={draft.mode === "update_selected"}
                        onChange={() => onModeChange("update_selected")}
                        className="mt-0.5 h-4 w-4 accent-[#0d9474]"
                      />
                      <span className="text-[12px] leading-5 text-[#3b4a66]">
                        <strong className="text-[#16244a]">Update selected fields</strong> (advanced) — edits only the chosen writable fields, preserves unrelated metadata, and warns that previous GPS, AI and provenance metadata may remain. Retained C2PA is re-validated afterward; the edits may invalidate its signature. Never a silent full clean.
                      </span>
                    </label>
                  </fieldset>
                  <p className="mt-3 text-[11px] leading-4 text-slate-500" data-testid="editor-format-note">
                    Per-format reality: JPEG writes EXIF + XMP + IPTC; PNG/WebP/AVIF/HEIC write EXIF + XMP only (requested IPTC locations there are reported unsupported, never silently dropped). C2PA manifests are never forged. The image payload is byte-compared before/after; anything unverifiable withholds the download.
                  </p>
                </div>

                {/* Preset & Profile */}
                <div
                  role="tabpanel"
                  id="editor-panel-preset"
                  aria-labelledby="editor-tab-preset"
                  data-testid="editor-panel-preset"
                  hidden={tab !== "preset"}
                  className="mt-3"
                >
                  <fieldset className="grid gap-2" data-testid="editor-source">
                    <legend className="text-[12.5px] font-extrabold text-[#16244a]">Metadata source for this image</legend>
                    <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-[#e6ebf3] bg-white p-3">
                      <input
                        type="radio"
                        name="editor-source"
                        checked={draft.source === "custom"}
                        onChange={() => onSourceChange("custom")}
                        className="mt-0.5 h-4 w-4 accent-[#0d9474]"
                      />
                      <span className="text-[12px] leading-5 text-[#3b4a66]">
                        <strong className="text-[#16244a]">Custom values for this image</strong> — image-specific overrides used exactly as entered. No saved-profile values are merged in when a field is left blank.
                      </span>
                    </label>
                    <label className={`flex items-start gap-2 rounded-xl border border-[#e6ebf3] bg-white p-3 ${savedProfileUsable ? "cursor-pointer" : "cursor-not-allowed opacity-70"}`}>
                      <input
                        type="radio"
                        name="editor-source"
                        checked={draft.source === "profile"}
                        onChange={() => savedProfileUsable && onSourceChange("profile")}
                        disabled={!savedProfileUsable}
                        className="mt-0.5 h-4 w-4 accent-[#0d9474]"
                      />
                      <span className="text-[12px] leading-5 text-[#3b4a66]">
                        <strong className="text-[#16244a]">Use my saved profile</strong> — applies your saved profile for this image only
                        {savedProfileUsable ? "." : " (requires sign-in and a non-empty profile)."}
                      </span>
                    </label>
                    {signedIn ? (
                      <label className={`flex items-start gap-2 rounded-xl border border-[#e6ebf3] bg-white p-3 ${projects.length > 0 ? "cursor-pointer" : "cursor-not-allowed opacity-70"}`} data-testid="editor-source-project">
                        <input
                          type="radio"
                          name="editor-source"
                          checked={draft.source === "project"}
                          onChange={() => projects.length > 0 && onSourceChange("project")}
                          disabled={projects.length === 0}
                          className="mt-0.5 h-4 w-4 accent-[#0d9474]"
                        />
                        <span className="min-w-0 flex-1 text-[12px] leading-5 text-[#3b4a66]">
                          <strong className="text-[#16244a]">Use a saved project</strong> — applies one project&apos;s metadata (and GPS, if set)
                          exactly as saved for this image. Premium feature; values are never merged with other sources.
                          {projects.length === 0 ? " (No saved projects yet — create one on the profile page.)" : ""}
                        </span>
                      </label>
                    ) : null}
                  </fieldset>
                  {signedIn && draft.source === "project" ? (
                    <div className="mt-2 grid gap-2" data-testid="editor-project-picker">
                      <label className="grid gap-1 text-xs font-semibold text-slate-700">
                        Saved project
                        <select
                          value={draft.projectId ?? ""}
                          onChange={(event) => onProjectSelect(event.target.value === "" ? null : event.target.value)}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal"
                          data-testid="editor-project-select"
                        >
                          <option value="">Select a project…</option>
                          {projects.map((row) => (
                            <option key={row.projectId} value={row.projectId}>
                              {row.projectTitle}{row.companyPublisher ? ` — ${row.companyPublisher}` : ""}{row.locationName ? ` (${row.locationName})` : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      {selectedProject ? (
                        <div className="rounded-xl border border-[#e6ebf3] bg-[#fbfcfe] p-3" data-testid="editor-project-preview">
                          <p className="text-[12px] font-extrabold text-[#16244a]">Saved project (read-only preview) — {selectedProject.projectTitle}</p>
                          <dl className="mt-1.5 grid gap-1 text-[11px]">
                            {PROFILE_FIELDS.map((field) => {
                              const mapped = projectToProfile(selectedProject);
                              const value = field === "keywords" ? mapped.keywordsList.join(", ") : mapped[field];
                              return (
                                <div key={field} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-2 border-t border-slate-100 py-1 first:border-t-0">
                                  <dt className="font-semibold text-slate-500">{editorFieldLabel(field)}</dt>
                                  <dd className="break-all text-slate-700">{value.trim() ? value : <span className="text-slate-400">— (not written)</span>}</dd>
                                </div>
                              );
                            })}
                            <div className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-2 border-t border-slate-100 py-1">
                              <dt className="font-semibold text-slate-500">GPS coordinates</dt>
                              <dd className="break-all text-slate-700" data-testid="editor-project-gps">
                                {selectedProject.latitude !== null && selectedProject.longitude !== null
                                  ? `${selectedProject.latitude}, ${selectedProject.longitude}${selectedProject.altitudeMeters !== null ? ` · ${selectedProject.altitudeMeters} m` : ""} (verified write)`
                                  : <span className="text-slate-400">none in this project (GPS untouched)</span>}
                              </dd>
                            </div>
                          </dl>
                          <p className="mt-1.5 text-[11px] text-slate-500">
                            Missing values stay absent — nothing is inherited from your profile or the custom form. Switching
                            projects or back to custom restores your independent draft exactly as typed.
                          </p>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {!savedProfileUsable ? (
                    <p className="mt-2 text-[11.5px] text-slate-500" data-testid="editor-profile-locked-note">
                      Guests can always edit custom values for this image — no sign-in is needed for that.{" "}
                      {signedIn ? "Your saved profile is currently empty — add values on the profile page to use it here." : (
                        <Link href="/account/profile" prefetch={false} className="font-bold text-[#2d5be9] underline-offset-2 hover:underline">Sign in on your profile page</Link>
                      )}
                    </p>
                  ) : (
                    <>
                      <div className="mt-3 rounded-xl border border-[#e6ebf3] bg-[#fbfcfe] p-3" data-testid="editor-profile-preview">
                        <p className="text-[12px] font-extrabold text-[#16244a]">Saved profile (read-only preview)</p>
                        <dl className="mt-1.5 grid gap-1 text-[11px]">
                          {PROFILE_FIELDS.map((field) => {
                            const value = field === "keywords" ? savedProfile.keywordsList.join(", ") : savedProfile[field];
                            return (
                              <div key={field} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-2 border-t border-slate-100 py-1 first:border-t-0">
                                <dt className="font-semibold text-slate-500">{editorFieldLabel(field)}</dt>
                                <dd className="break-all text-slate-700">{value.trim() ? value : <span className="text-slate-400">—</span>}</dd>
                              </div>
                            );
                          })}
                        </dl>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Link href="/account/profile" prefetch={false} className="btn-secondary !min-h-8 !px-3 text-[11px]">Edit on profile page</Link>
                          <button
                            type="button"
                            data-testid="editor-copy-profile"
                            onClick={onCopyProfileIntoDraft}
                            className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-[#c7d7f8] bg-[#e9f2fe] px-3 text-[11px] font-bold text-[#2d5be9] hover:bg-[#e2edfd] focus-visible:outline-3 focus-visible:outline-[#2d5be9]"
                          >
                            Copy saved profile into this form
                          </button>
                          {draft.source === "custom" ? (
                            <p className="w-full text-[11px] font-medium text-slate-500">
                              Copied values become an independent image-specific copy — later profile changes never update this image.
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Preview changes (client-side diff; NOT a verified write) */}
              {previewOpen ? (
                <div className="mt-4 grid gap-2 rounded-2xl border border-[#dbe7f8] bg-[#eef4ff] p-3.5" data-testid="editor-preview-panel" role="region" aria-label="Planned changes preview">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[13px] font-extrabold text-[#16244a]">Preview changes</p>
                    <button type="button" data-testid="editor-preview-close" onClick={togglePreview} className="text-[11.5px] font-bold text-[#2d5be9] hover:underline">Hide preview</button>
                  </div>
                  {!editorPreview ? (
                    <p className="text-[12px] text-slate-600">Nothing to preview yet — enter at least one supported value first.</p>
                  ) : (
                    <>
                      <p className="text-[11.5px] leading-4 text-[#5a6b85]">
                        Client-side plan of the requested writes for <strong>{entry.item.name}</strong>. This is not a verified write — the actual output is re-inspected after Apply.
                      </p>
                      <ul className="grid gap-1.5" data-testid="editor-preview-writes">
                        {editorPreview.writes.map((line) => (
                          <li key={line.field} className="rounded-xl border border-[#dbe7f8] bg-white p-2.5 text-[11.5px]">
                            <p className="font-extrabold text-[#16244a]">{line.label}</p>
                            <p className="mt-0.5 break-all text-slate-700">
                              → {line.field === "keywords" && line.keywords?.length ? `${line.keywords.length} keyword(s): ${line.keywords.join(", ")}` : line.value || "(empty)"}
                            </p>
                            <p className="mt-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#5a6b85]">{line.channels.join(" · ")}</p>
                          </li>
                        ))}
                      </ul>
                      {editorPreview.stripSummary ? (
                        <p className="rounded-xl bg-white p-2.5 text-[11.5px] leading-4 text-[#3b4a66]" data-testid="editor-preview-strip">{editorPreview.stripSummary}</p>
                      ) : null}
                      <p className="rounded-xl bg-white p-2.5 text-[11.5px] leading-4 text-[#3b4a66]" data-testid="editor-preview-c2pa">{editorPreview.c2paNote}</p>
                      {editorPreview.unsupported.length > 0 ? (
                        <ul className="grid gap-1 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-[11.5px] text-amber-900" data-testid="editor-preview-unsupported">
                          {editorPreview.unsupported.map((entry) => (
                            <li key={`${entry.field}:${entry.note}`}>{entry.label}: {entry.note}</li>
                          ))}
                        </ul>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}

              {/* Verified outcome */}
              {result ? (
                <div className="mt-4" data-testid="editor-result">
                  <RewriteResultPanel
                    result={result}
                    embedded
                    headingId={`editor-rewrite-heading-${entry.item.id}`}
                    onDownload={(finished) => onDownloadNotice(finished.outputName ?? finished.inputName)}
                  />
                </div>
              ) : null}

              {/* Draft row */}
              <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl bg-[#f7f9fd] px-3 py-2" data-testid="editor-draft-row">
                <p className="text-[11.5px] font-semibold text-[#5a6b85]">
                  {draftHasValues ? "Draft kept for this file in this browser session — Apply writes a verified copy; the original stays untouched." : "No draft values yet for this file."}
                </p>
                {draftHasValues ? (
                  discardConfirm ? (
                    <span className="ml-auto flex items-center gap-1.5">
                      <span className="text-[11.5px] font-bold text-[#16244a]">Discard draft?</span>
                      <button type="button" data-testid="editor-discard-confirm" onClick={() => { onDiscardDraft(); setDiscardConfirm(false); }} className="inline-flex min-h-7 items-center rounded-md border border-red-200 bg-white px-2 text-[11px] font-bold text-[#b42318] hover:bg-red-50 focus-visible:outline-3 focus-visible:outline-[#0d9474]">Discard</button>
                      <button type="button" onClick={() => setDiscardConfirm(false)} className="inline-flex min-h-7 items-center rounded-md border border-slate-200 bg-white px-2 text-[11px] font-bold text-[#35435c] hover:bg-slate-50 focus-visible:outline-3 focus-visible:outline-[#2d5be9]">Keep editing</button>
                    </span>
                  ) : (
                    <button type="button" data-testid="editor-discard" onClick={() => setDiscardConfirm(true)} className="ml-auto inline-flex min-h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-bold text-[#35435c] hover:bg-slate-50 focus-visible:outline-3 focus-visible:outline-[#2d5be9]">
                      Discard draft
                    </button>
                  )
                ) : null}
              </div>
            </section>
          </div>

          {/* Footer */}
          <footer data-testid="editor-footer" className="flex flex-wrap items-center gap-2 border-t border-[#e6ebf3] bg-white px-4 py-3 sm:gap-3 sm:px-5">
            <p className="w-full text-[11.5px] leading-4 text-[#5a6b85] sm:w-auto sm:min-w-0 sm:flex-1" data-testid="editor-footer-note">
              The rewrite runs locally in your browser with postwrite re-inspection. No image bytes or values are uploaded; the original file in the queue stays untouched.
            </p>
            <div className="flex w-full items-center justify-end gap-2 sm:w-auto sm:gap-3">
              <button
                type="button"
                data-testid="editor-cancel"
                onClick={onClose}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="editor-preview-toggle"
                onClick={togglePreview}
                aria-pressed={previewOpen}
                className="inline-flex min-h-[2.55rem] items-center justify-center gap-2 rounded-[0.75rem] border border-[#c7d7f8] bg-white px-3 text-[13px] font-bold text-[#2d5be9] outline-offset-2 hover:bg-[#f2f6ff] focus-visible:outline-3 focus-visible:outline-[#2d5be9] disabled:cursor-not-allowed disabled:opacity-50 sm:px-4"
              >
                {previewOpen ? "Hide preview" : "Preview changes"}
              </button>
              <Tooltip label={applyReady
                ? `Runs the verified rewrite on this image (${draft.mode.replace(/_/g, " ")}). The original stays in the queue untouched.`
                : applyDisabledReason ?? ""}
                zClass="z-[120]"
                testId="editor-apply-tooltip"
              >
                <button
                  type="button"
                  data-testid="editor-apply"
                  disabled={!applyReady}
                  onClick={() => onApply({ profile: plan.profile, selectedFields: plan.selectedFields, mode: plan.mode, projectId: draft.source === "project" ? draft.projectId : null, gps: plan.gps })}
                  className="btn-primary"
                >
                  {busy ? <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" /> : null}
                  {busy ? "Applying…" : "Apply & create clean copy"}
                </button>
              </Tooltip>
            </div>
          </footer>
          {progress ? (
            <p role="status" className="border-t border-[#e6ebf3] bg-white px-4 pb-3 text-[11.5px] font-semibold text-[#2d5be9] sm:px-5" data-testid="editor-progress">
              {progress}
            </p>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** One labeled form row with hint, counter and validation error. */
function EditorFieldRow({
  field,
  draft,
  plan,
  keywordsCount,
  detectedValue,
  disabled,
  audio,
  onChange,
}: {
  field: ProfileField;
  draft: EditorDraft;
  plan: EditorApplyPlan;
  keywordsCount: number;
  detectedValue: string;
  disabled: boolean;
  /** MP3 mode: audio-honest labels with the actual ID3 destination. */
  audio?: boolean;
  onChange: (field: ProfileField, value: string) => void;
}) {
  const value = draft.values[field] ?? "";
  const error = plan.errors[field];
  const limit = PROFILE_LIMITS[field];
  const labelId = `editor-field-${field}-label`;
  const hintId = `editor-field-${field}-hint`;
  const detectedDisplay = detectedValue.trim() !== ""
    ? (detectedValue.length > 96 ? `${detectedValue.slice(0, 96)}…` : detectedValue)
    : "";
  return (
    <div data-testid={`editor-field-${field}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <label htmlFor={`editor-field-${field}`} id={labelId} className="text-[12.5px] font-extrabold text-[#16244a]">
          {audio ? AUDIO_FIELD_LABELS[field] ?? editorFieldLabel(field) : editorFieldLabel(field)}
        </label>
        <span className={`text-[10.5px] font-bold tabular-nums ${field === "keywords" ? (keywordsCount > PROFILE_LIMITS.keywords.max ? "text-red-600" : "text-slate-400") : value.length > limit.max ? "text-red-600" : "text-slate-400"}`} aria-hidden="true">
          {field === "keywords" ? `${keywordsCount}/${limit.max} keywords` : `${value.length}/${limit.max}`}
        </span>
      </div>
      <p id={hintId} className="mt-0.5 text-[10.5px] font-medium text-[#5a6b85]">{FIELD_HINTS[field]}</p>
      {MULTILINE_FIELDS.has(field) ? (
        <textarea
          id={`editor-field-${field}`}
          aria-labelledby={labelId}
          aria-describedby={hintId}
          data-testid={`editor-input-${field}`}
          value={value}
          disabled={disabled}
          rows={3}
          placeholder={FIELD_PLACEHOLDERS[field]}
          onChange={(event) => onChange(field, event.target.value)}
          className={`mt-1 w-full rounded-xl border px-3 py-2 text-[13px] text-[#16244a] outline-offset-2 focus-visible:outline-3 focus-visible:outline-[#2d5be9] ${
            error ? "border-red-300 bg-red-50/40" : "border-[#c9d5e8] bg-white"
          } disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400`}
        />
      ) : field === "keywords" ? (
        <textarea
          id={`editor-field-${field}`}
          aria-labelledby={labelId}
          aria-describedby={hintId}
          data-testid={`editor-input-${field}`}
          value={value}
          disabled={disabled}
          rows={KEYWORD_TEXTAREA_ROWS}
          placeholder={FIELD_PLACEHOLDERS[field]}
          onChange={(event) => onChange(field, event.target.value)}
          className={`mt-1 w-full rounded-xl border px-3 py-2 text-[13px] text-[#16244a] outline-offset-2 focus-visible:outline-3 focus-visible:outline-[#2d5be9] ${
            error ? "border-red-300 bg-red-50/40" : "border-[#c9d5e8] bg-white"
          } disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400`}
        />
      ) : (
        <input
          id={`editor-field-${field}`}
          aria-labelledby={labelId}
          aria-describedby={hintId}
          data-testid={`editor-input-${field}`}
          type="text"
          value={value}
          disabled={disabled}
          placeholder={FIELD_PLACEHOLDERS[field]}
          onChange={(event) => onChange(field, event.target.value)}
          className={`mt-1 w-full rounded-xl border px-3 py-2 text-[13px] text-[#16244a] outline-offset-2 focus-visible:outline-3 focus-visible:outline-[#2d5be9] ${
            error ? "border-red-300 bg-red-50/40" : "border-[#c9d5e8] bg-white"
          } disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400`}
        />
      )}
      {error ? (
        <p className="mt-1 text-[11px] font-semibold text-red-700" data-testid={`editor-error-${field}`} role="status">{error}</p>
      ) : null}
      {detectedDisplay ? (
        <p className="mt-1 text-[10.5px] text-slate-500" title={detectedValue} data-testid={`editor-detected-${field}`}>
          Current: <span className="break-all">{detectedDisplay}</span>
        </p>
      ) : null}
    </div>
  );
}
