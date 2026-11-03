"use client";

import type { ImageInspectionResult } from "../../types/inspection";
import type { QueueEntry } from "../../types/media";
import { ObjectUrlAudio } from "../queue/queue-previews";

/**
 * Phase 07 — audio-centric details body for MP3 rows. Rendered instead of
 * the image inspection panels: no EXIF/GPS/IPTC "0 detected" claims (those
 * systems are not checked for audio — the honest label is N/A), ID3 frames
 * with exact frame IDs, MPEG stream facts (estimated duration marked as
 * such), trailing structures, and local playback only.
 */

const ID3_STATUS_LABELS: Record<string, string> = {
  detected: "Detected",
  not_detected: "Not detected",
  uncertain: "Uncertain",
  not_inspected: "Not inspected",
  unsupported: "Unsupported",
  failed: "Parse error",
};

export default function AudioInspectionBody({
  entry,
  result,
}: {
  entry: QueueEntry;
  result: ImageInspectionResult | undefined;
}) {
  const categories = result?.categories ?? [];
  const id3Category = categories.find((category) => category.category.startsWith("ID3v2"));
  const streamCategory = categories.find((category) => category.category === "MPEG audio stream");
  const trailingCategory = categories.find((category) => category.category === "Trailing structures");
  const c2paCategory = categories.find((category) => category.category.startsWith("C2PA"));
  const aiCategory = categories.find((category) => category.category.startsWith("AI metadata evidence"));
  const aiStatus = result && result.aiIndicators.length > 0
    ? "Qualified AI-related metadata indicators found (metadata disclosures — not an acoustic or visual AI-detection verdict)."
    : "No AI-related indicators in the scanned supported ID3 fields — this is NOT proof the audio is non-AI.";

  return (
    <div className="mt-4 grid gap-3" data-testid="audio-details-body">
      <div className="rounded-2xl border border-[#e6ebf3] bg-[#fbfcfe] p-3">
        <p className="text-[12.5px] font-extrabold text-[#16244a]">Audio preview (local playback only)</p>
        <p className="mt-0.5 text-[11px] leading-4 text-[#5a6b85]">
          Playback uses a local object URL from the queued file — audio never leaves your browser and is
          never transcoded.
        </p>
        <div className="mt-2 min-h-16">
          <ObjectUrlAudio blob={entry.source} label={`${entry.item.name} audio preview`} />
        </div>
      </div>

      <div className="rounded-2xl border border-[#e6ebf3] bg-white p-3" data-testid="audio-stream-facts">
        <p className="text-[12.5px] font-extrabold text-[#16244a]">MPEG audio stream</p>
        {streamCategory && streamCategory.status === "detected" ? (
          <dl className="mt-1.5 grid gap-1 text-[11.5px] sm:grid-cols-2">
            {streamCategory.tags.map((tag) => (
              <div key={tag.key} className="flex justify-between gap-2 border-t border-slate-100 py-1 first:border-t-0">
                <dt className="text-slate-500">{tag.label}</dt>
                <dd className="font-semibold tabular-nums text-[#16244a]">{tag.displayedValue}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-1.5 text-[11.5px] text-amber-800">
            No valid MPEG Layer III frames were found — this file may be corrupt or misnamed. Nothing is claimed playable.
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-[#e6ebf3] bg-white p-3" data-testid="audio-id3-section">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[12.5px] font-extrabold text-[#16244a]">{id3Category?.category ?? "ID3 tags"}</p>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-bold text-slate-500">
            {ID3_STATUS_LABELS[id3Category?.status ?? "not_inspected"]}
          </span>
        </div>
        {id3Category && id3Category.tags.length > 0 ? (
          <ul className="mt-1.5 grid gap-1 text-[11px]">
            {id3Category.tags.map((tag, index) => (
              <li key={`${tag.key}:${index}`} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-2 border-t border-slate-100 py-1 first:border-t-0">
                <span className="font-mono font-semibold text-slate-500">{tag.label}</span>
                <span className="break-all text-[#3b4a66]">
                  {tag.displayedValue}
                  {tag.technical ? <em className="ml-1 text-amber-800">(frame parse warning — disclosed, not guessed)</em> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 text-[11.5px] text-slate-500">
            {id3Category?.warnings[0] ?? "No ID3 frames listed for this file."}
          </p>
        )}
      </div>

      {trailingCategory && trailingCategory.tags.length > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3" data-testid="audio-trailing">
          <p className="text-[12.5px] font-extrabold text-amber-900">Trailing structures (read-only/unsupported)</p>
          <ul className="mt-1 grid gap-1 text-[11.5px] text-amber-900">
            {trailingCategory.tags.map((tag) => <li key={tag.key}>{tag.displayedValue}</li>)}
          </ul>
        </div>
      ) : null}

      {/* Honest N/A row: EXIF/GPS/IPTC are image systems, never checked here. */}
      <div className="rounded-2xl border border-[#e6ebf3] bg-[#f7f9fd] p-3" data-testid="audio-na-note">
        <p className="text-[12.5px] font-extrabold text-[#16244a]">Image metadata systems</p>
        <p className="mt-0.5 text-[11.5px] leading-4 text-[#5a6b85]">
          EXIF, GPS and IPTC are image-container systems and are <strong>not checked for MP3</strong> — they
          are shown as N/A rather than zero-detected. Tags like embedded artwork are covered by the ID3 list above.
        </p>
      </div>

      {/* Phase 08: metadata-only AI evidence, source-attributed. */}
      <div className="rounded-2xl border border-[#e6ebf3] bg-white p-3" data-testid="audio-ai-evidence">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[12.5px] font-extrabold text-[#16244a]">AI metadata evidence</p>
          <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${result && result.aiIndicators.length > 0 ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-500"}`}>
            {result && result.aiIndicators.length > 0 ? `${result.aiIndicators.length} qualified indicator${result.aiIndicators.length === 1 ? "" : "s"}` : "Not detected in supported fields"}
          </span>
        </div>
        <p className="mt-1 text-[11.5px] leading-4 text-[#3b4a66]" data-testid="audio-ai-summary">
          {aiCategory?.warnings[0] ?? aiStatus}
        </p>
        {result && result.aiIndicators.length > 0 ? (
          <ul className="mt-1.5 grid gap-1 text-[11px]">
            {result.aiIndicators.map((indicator) => (
              <li key={`${indicator.evidenceKey}:${indicator.label}`} className="rounded-lg bg-[#f7f9fd] px-2.5 py-1.5">
                <strong className="text-[#16244a]">{indicator.label}</strong> — {indicator.evidenceGroup}/{indicator.evidenceKey}: <span className="break-all">{indicator.matchedValue}</span>
                <em className="block text-[10.5px] text-slate-500">{indicator.explanation}</em>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-1.5 text-[10.5px] leading-4 text-slate-500">
          Metadata indicators are not proof of AI creation and cannot detect AI-generated audio by sound.
        </p>
      </div>

      {c2paCategory ? (
        <div className="rounded-2xl border border-[#e6ebf3] bg-white p-3" data-testid="audio-c2pa">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[12.5px] font-extrabold text-[#16244a]">C2PA / Content Credentials</p>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-bold text-slate-500">
              {ID3_STATUS_LABELS[c2paCategory.status] ?? c2paCategory.status}
            </span>
          </div>
          <p className="mt-1 text-[11.5px] leading-4 text-[#3b4a66]">
            {c2paCategory.status === "detected"
              ? "A C2PA-like GEOB carrier was detected in the ID3 tags. Manifest presence is NOT signature validity — cryptographic validation has not been performed for this file."
              : c2paCategory.warnings[0] ?? "No C2PA carrier scan result beyond the GEOB marker check."}
          </p>
        </div>
      ) : null}

      {result && result.warnings.length > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3" data-testid="audio-warnings">
          <p className="text-[12px] font-extrabold text-amber-900">Parse warnings</p>
          <ul className="mt-1 grid gap-0.5 text-[11.5px] text-amber-900">
            {result.warnings.map((warning) => <li key={warning}>• {warning}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
