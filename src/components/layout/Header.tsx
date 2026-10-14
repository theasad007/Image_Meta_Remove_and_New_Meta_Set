export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/85 backdrop-blur-xl">
      <div className="mx-auto flex min-h-18 max-w-7xl items-center gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <a href="#top" className="flex min-w-0 items-center gap-3" aria-label="Private Metadata Cleaner home">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] bg-[#3157d5] text-white shadow-[0_8px_20px_rgba(49,87,213,.24)]">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6 fill-none" fill="none">
              <path d="M12 3 19 5.6v5c0 4.7-2.8 8.2-7 10-4.2-1.8-7-5.3-7-10v-5L12 3Z" stroke="currentColor" strokeWidth="1.8" />
              <path d="m8.6 11.5 2.2 2.2 4.7-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
            </svg>
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-extrabold tracking-[-0.02em] text-[#17223b] sm:text-base">
              Private Metadata Cleaner
            </span>
            <span className="block truncate text-[11px] font-medium text-slate-500">
              Local processing. Zero uploads.
            </span>
          </span>
        </a>
        <nav aria-label="Primary" className="ml-auto hidden items-center gap-1 md:flex">
          <a
            href="#upload"
            className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-950"
          >
            Workspace
          </a>
          <a
            href="#formats"
            className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-950"
          >
            File support
          </a>
          <a
            href="#privacy"
            className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-950"
          >
            Privacy
          </a>
        </nav>
        <a href="#upload" className="btn-primary ml-auto !min-h-9 !rounded-full !px-4 !py-1.5 md:ml-3">
          Choose files
        </a>
      </div>
    </header>
  );
}
