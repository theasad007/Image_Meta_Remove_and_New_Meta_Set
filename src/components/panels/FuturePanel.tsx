const PRIVACY_POINTS = [
  {
    title: "No uploads",
    text: "File reads, metadata inspection, cleaning, verification and report creation all happen in your browser.",
  },
  {
    title: "Originals stay untouched",
    text: "The app creates a separate cleaned copy. It never overwrites the file you selected.",
  },
  {
    title: "Verified before download",
    text: "A cleaned image is offered only after format, structure and supported metadata checks complete.",
  },
];

export default function FuturePanel() {
  return (
    <details className="overflow-hidden rounded-2xl bg-[#14213d] px-5 py-4 text-white shadow-[0_16px_45px_rgba(20,33,61,.14)]">
      <summary className="flex cursor-pointer items-center gap-3">
        <span id="privacy-heading" className="font-extrabold">Private, local processing</span>
        <span className="text-xs text-slate-300">No uploads · originals untouched · verified downloads</span>
        <span className="ml-auto text-xs font-bold text-blue-200">Privacy details</span>
      </summary>
      <section aria-labelledby="privacy-heading" className="mt-5">
      <div className="grid gap-6 lg:grid-cols-[.8fr_1.2fr] lg:items-center">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-blue-200">Privacy promise</p>
          <h2 className="mt-2 text-2xl font-extrabold tracking-[-0.035em]">
            Your files remain yours.
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-7 text-slate-300">
            There is no media-processing server behind this tool. After the static app loads, your selected file bytes are handled locally in this tab.
          </p>
          <p className="mt-5 text-xs leading-5 text-slate-400">
            Custom metadata rewriting, geotagging and video metadata tools are not available in this version. The interface does not pretend those operations succeeded.
          </p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
          {PRIVACY_POINTS.map((point, index) => (
            <li key={point.title} className="rounded-2xl border border-white/10 bg-white/[.07] p-4 backdrop-blur">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-xs font-extrabold text-blue-200">0{index + 1}</span>
              <p className="mt-4 font-bold">{point.title}</p>
              <p className="mt-2 text-sm leading-6 text-slate-300">{point.text}</p>
            </li>
          ))}
        </ul>
      </div>
      </section>
    </details>
  );
}
