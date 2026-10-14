export default function Hero() {
  return (
    <section id="top" className="mx-auto max-w-7xl px-4 pb-8 pt-10 sm:px-6 sm:pt-14 lg:px-8 lg:pb-12 lg:pt-18">
      <div className="grid items-center gap-9 lg:grid-cols-[minmax(0,1.15fr)_minmax(22rem,.85fr)] lg:gap-16">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-emerald-200/80 bg-emerald-50/90 px-3 py-1.5 text-xs font-bold text-emerald-800 shadow-sm">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white" aria-hidden="true">
              <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none">
                <path d="m5.5 10.2 2.8 2.8 6.2-6.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
              </svg>
            </span>
            Private by design — files never leave this device
          </p>
          <h1 className="mt-6 max-w-3xl text-[2.6rem] font-extrabold leading-[1.04] tracking-[-0.045em] text-[#14213d] sm:text-6xl lg:text-[4rem]">
            Remove hidden metadata. Keep your images yours.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">
            Inspect and clean sensitive EXIF, GPS, XMP, IPTC and text metadata directly in your browser. Your original stays untouched, and every cleaned copy is checked before download.
          </p>
          <div className="mt-7 flex flex-col gap-3 min-[430px]:flex-row">
            <a href="#upload" className="btn-primary !min-h-12 !px-5">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none">
                <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
              </svg>
              Select images to clean
            </a>
            <a href="#how-it-works" className="btn-secondary hidden !min-h-12 !px-5 lg:inline-flex">
              See how it works
            </a>
          </div>
          <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium text-slate-600" aria-label="Service highlights">
            {["No account required", "No file-count paywall", "Format preserved"].map((item) => (
              <li key={item} className="flex items-center gap-2">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#0d9474]" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div id="how-it-works" className="surface-card relative hidden overflow-hidden rounded-[1.75rem] p-5 sm:p-7 lg:block">
          <div aria-hidden="true" className="absolute -right-14 -top-16 h-44 w-44 rounded-full bg-blue-100/80 blur-2xl" />
          <div className="relative">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="section-kicker">Simple workflow</p>
                <h2 className="mt-2 text-xl font-extrabold tracking-[-0.02em]">Private from start to finish</h2>
              </div>
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#e9edff] text-[#3157d5]">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none">
                  <path d="M12 3 19 5.6v5c0 4.7-2.8 8.2-7 10-4.2-1.8-7-5.3-7-10v-5L12 3Z" stroke="currentColor" strokeWidth="1.8" />
                  <path d="M9 12h6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
                </svg>
              </span>
            </div>
            <ol className="mt-6 space-y-3">
              {[
                ["01", "Add your files", "Choose one image or a whole batch. Nothing is sent to a server."],
                ["02", "Inspect or remove", "Review found metadata, then create a format-preserving cleaned copy."],
                ["03", "Verify and download", "The copy is re-read before single-file, ZIP, CSV or PDF download."],
              ].map(([step, title, text]) => (
                <li key={step} className="flex gap-4 rounded-2xl border border-slate-200/80 bg-white/80 p-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#f0f3ff] text-xs font-extrabold text-[#3157d5]">{step}</span>
                  <span>
                    <span className="block text-sm font-bold text-slate-900">{title}</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-600">{text}</span>
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-5 flex items-center gap-2 text-xs font-semibold text-slate-500">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:animate-none" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              Processing happens locally in this tab
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
