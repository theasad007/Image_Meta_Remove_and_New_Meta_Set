export default function Footer() {
  return (
    <footer className="mx-auto max-w-7xl px-4 pb-10 pt-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 border-t border-slate-200 pt-7 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#3157d5] text-white" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
              <path d="M12 3 19 5.6v5c0 4.7-2.8 8.2-7 10-4.2-1.8-7-5.3-7-10v-5L12 3Z" stroke="currentColor" strokeWidth="1.8" />
              <path d="m8.6 11.5 2.2 2.2 4.7-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
            </svg>
          </span>
          <span>
            <strong className="block font-bold text-slate-800">Private Metadata Cleaner</strong>
            <span className="text-xs">Free, browser-only image privacy tools</span>
          </span>
        </div>
        <p className="max-w-xl text-xs leading-5 sm:text-right">
          JPEG, PNG, WebP, AVIF and supported HEIC still layouts can be inspected and cleaned locally. Powered by ExifReader and heic-to.
        </p>
      </div>
    </footer>
  );
}
