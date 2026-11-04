"use client";

import { useRef, useState } from "react";

/**
 * Accepted types are an explicit list (never `image/*`: on some Android
 * browsers a wildcard accept strips GPS data, and here it is only a picker
 * hint — never proof of support).
 */
export const PICKER_ACCEPT =
  "image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif," +
  "video/mp4,video/quicktime,video/webm," +
  "audio/mpeg," +
  ".jpg,.jpeg,.png,.webp,.avif,.heic,.heif,.mp4,.mov,.webm,.mp3";

interface UploadPanelProps {
  onFiles: (files: File[]) => void;
}

/**
 * Screen 01 dropzone. Full-width dashed upload surface with the
 * "Local-only processing" badge inside its top-right corner, as in the
 * approved reference. Validation, drag/drop, keyboard activation and the
 * picker wiring are unchanged from the implemented queue path.
 */
export default function UploadPanel({ onFiles }: UploadPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragOver, setDragOver] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const emit = (list: FileList | null | undefined) => {
    if (!list || list.length === 0) {
      setFeedback("No files were detected. Try choosing the files instead of a folder.");
      return;
    }
    const files = Array.from(list);
    setFeedback(`${files.length} file${files.length === 1 ? "" : "s"} added to your private queue.`);
    onFiles(files);
  };

  const openPicker = () => inputRef.current?.click();

  return (
    <section aria-labelledby="upload-heading">
      <h2 id="upload-heading" className="sr-only">Add files to your private workspace</h2>

      <input
        id="private-media-picker"
        ref={inputRef}
        type="file"
        multiple
        accept={PICKER_ACCEPT}
        data-testid="file-input"
        className="sr-only"
        tabIndex={-1}
        aria-describedby="upload-formats upload-feedback"
        onChange={(event) => {
          emit(event.target.files);
          event.target.value = "";
        }}
      />
      <label
        htmlFor="private-media-picker"
        role="button"
        tabIndex={0}
        aria-label="Drop files here, or press Enter to choose files"
        data-testid="upload-dropzone"
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openPicker();
          }
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          dragDepth.current += 1;
          setDragOver(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
          setDragOver(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragOver(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragDepth.current = 0;
          setDragOver(false);
          emit(event.dataTransfer.files);
        }}
        className={`group relative mt-6 flex min-h-[13rem] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-[1.25rem] border-[1.5px] border-dashed bg-gradient-to-b from-[#f7f9ff] to-[#eef4fd] px-6 py-12 text-center lg:py-14 motion-safe:transition-colors ${
          dragOver
            ? "border-[#2d5be9]/80 bg-[#eef3ff]"
            : "border-[#a9c4f2] hover:border-[#7fa1f0] hover:from-[#f4f8ff] hover:to-[#e9f1fd]"
        }`}
      >
        <span className="absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-[#e4f6ec] px-3 py-1.5 text-xs font-bold text-[#0a7a58] shadow-[0_2px_8px_rgba(16,140,100,.08)]">
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none">
            <rect x="4" y="8.3" width="12" height="8.7" rx="2" stroke="currentColor" strokeWidth="1.7" />
            <path d="M6.7 8V6.5a3.3 3.3 0 0 1 6.6 0V8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          Local-only processing
        </span>

        <span
          className="relative flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-[1.15rem] bg-white text-[#2d5be9] shadow-[0_10px_30px_rgba(29,48,99,.14)] ring-1 ring-[#eef2fa] transition-transform motion-safe:group-hover:-translate-y-0.5"
          aria-hidden="true"
        >
          <svg viewBox="0 0 32 32" className="h-8 w-8" fill="none">
            <path d="M5 11.5A2.5 2.5 0 0 1 7.5 9h6l2.2 2.5h8.8A2.5 2.5 0 0 1 27 14v9.5a2.5 2.5 0 0 1-2.5 2.5h-17A2.5 2.5 0 0 1 5 23.5v-12Z" stroke="currentColor" strokeWidth="1.8" strokeDasharray="0" strokeLinecap="round" />
            <path d="M16 21.6v-7.2m0 0-3.1 3.1M16 14.4l3.1 3.1" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" />
          </svg>
        </span>
        <p className="relative mt-5 text-[1.25rem] font-extrabold tracking-[-0.02em] text-[#16244a]">
          {dragOver ? "Release to add your files" : "Drag and drop your files here"}
        </p>
        <p className="relative mt-1.5 text-[15px] text-[#64748b]">
          or <span data-testid="upload-choose" className="font-bold text-[#2d5be9] underline decoration-blue-300 underline-offset-4 group-hover:decoration-[#2d5be9]">browse files</span> from your device
        </p>
        <p id="upload-formats" className="relative mt-4 max-w-2xl text-[13px] leading-[1.55] text-[#8393ad]">
          Images: JPEG, PNG, WebP, AVIF, HEIC and HEIF. MP3 supports metadata inspection, cleaning and rewriting. MP4, MOV and WebM can be queued for preview, but video metadata tools are not available yet.
        </p>
      </label>
      <p
        id="upload-feedback"
        data-testid="upload-feedback"
        aria-live="polite"
        className={feedback
          ? `mt-3 text-sm font-medium ${feedback.startsWith("No files") ? "text-amber-700" : "text-emerald-700"}`
          : "sr-only"}
      >
        {feedback ?? ""}
      </p>
    </section>
  );
}
