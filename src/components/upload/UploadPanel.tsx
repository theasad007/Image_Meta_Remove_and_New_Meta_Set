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
  ".jpg,.jpeg,.png,.webp,.avif,.heic,.heif,.mp4,.mov,.webm";

interface UploadPanelProps {
  onFiles: (files: File[]) => void;
}

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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="section-kicker">Step 1</p>
          <h2 id="upload-heading" className="mt-2 text-2xl font-extrabold tracking-[-0.025em] text-slate-950">
            Add files to your workspace
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Choose one image or a batch. The files stay on this device and your originals are never changed.
          </p>
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-full bg-[#e7f8f2] px-3 py-1.5 text-xs font-bold text-[#08765d]">
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
            <rect x="4" y="8" width="12" height="9" rx="2" stroke="currentColor" strokeWidth="1.6" />
            <path d="M6.7 8V6.5a3.3 3.3 0 0 1 6.6 0V8" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          Local-only processing
        </span>
      </div>

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
        className={`group relative mt-6 flex min-h-64 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-[1.4rem] border-2 border-dashed px-6 py-10 text-center transition duration-200 ${
          dragOver
            ? "scale-[1.005] border-[#3157d5] bg-[#eef2ff] shadow-[0_16px_38px_rgba(49,87,213,.12)]"
            : "border-slate-300 bg-slate-50/70 hover:border-[#7189e7] hover:bg-[#f5f7ff]"
        }`}
      >
        <span aria-hidden="true" className="absolute -right-14 -top-20 h-52 w-52 rounded-full bg-blue-100/60 blur-3xl" />
        <span className={`relative flex h-16 w-16 items-center justify-center rounded-2xl border bg-white text-[#3157d5] shadow-sm transition group-hover:-translate-y-0.5 ${dragOver ? "border-blue-300" : "border-slate-200"}`} aria-hidden="true">
          <svg viewBox="0 0 32 32" className="h-8 w-8" fill="none">
            <path d="M5 11.5A2.5 2.5 0 0 1 7.5 9h6l2.2 2.5h8.8A2.5 2.5 0 0 1 27 14v9.5a2.5 2.5 0 0 1-2.5 2.5h-17A2.5 2.5 0 0 1 5 23.5v-12Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
            <path d="M16 21v-7m0 0-3 3m3-3 3 3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
          </svg>
        </span>
        <p className="relative mt-5 text-lg font-extrabold text-slate-900">
          {dragOver ? "Release to add your files" : "Drag and drop your files here"}
        </p>
        <p className="relative mt-2 text-sm text-slate-600">
          or <span data-testid="upload-choose" className="font-bold text-[#3157d5] underline decoration-blue-300 underline-offset-4">browse files</span> from your device
        </p>
        <p id="upload-formats" className="relative mt-5 max-w-2xl text-xs leading-5 text-slate-500">
          Images: JPEG, PNG, WebP, AVIF, HEIC and HEIF. MP4, MOV and WebM can be queued for preview, but video metadata tools are not available yet.
        </p>
      </label>
      <p id="upload-feedback" data-testid="upload-feedback" aria-live="polite" className={`mt-3 min-h-5 text-sm font-medium ${feedback ? (feedback.startsWith("No files") ? "text-amber-700" : "text-emerald-700") : "text-slate-500"}`}>
        {feedback ?? "Tip: you can select several files at once."}
      </p>
    </section>
  );
}
