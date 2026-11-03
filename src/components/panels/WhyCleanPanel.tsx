const POINTS = [
  {
    title: "Camera records can reveal places",
    body: "Photographs often embed EXIF records — timestamps, camera details, sometimes precise GPS coordinates. Shared as-is, they can tell strangers where and when a picture was taken. The Metadata & GeoTag tool inspects those records and removes supported metadata, then re-reads the cleaned copy.",
    tile: "bg-[#e2f7ef] text-[#0f9a68]",
    icon: (
      <svg viewBox="0 0 24 24" className="h-[1.3rem] w-[1.3rem]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 21s-6.7-5.4-6.7-10.2a6.7 6.7 0 0 1 13.4 0C18.7 15.6 12 21 12 21Z" />
        <path d="M12 14.2a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8Z" />
        <path d="M3.4 3.4 20.6 20.6" />
      </svg>
    ),
  },
  {
    title: "Descriptive metadata follows software",
    body: "Titles, captions, keywords and creator details written by editing tools live in XMP and IPTC blocks. You can inspect them, remove them, or — when you sign in — rewrite them with your saved metadata profile. Nothing here invents unsupported capabilities.",
    tile: "bg-[#e9f2fe] text-[#2d5be9]",
    icon: (
      <svg viewBox="0 0 24 24" className="h-[1.3rem] w-[1.3rem]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5.6 4.2h12.8M5.6 8.8h12.8M5.6 13.4h8" />
        <path d="M18.2 15.6v5.4m0 0h-2.6m2.6 0h2.6" />
      </svg>
    ),
  },
  {
    title: "AI-related evidence, honestly handled",
    body: "Generative tools may record maker and model strings, plus Content Credentials. The AI Metadata tool inspects qualified metadata evidence and removes supported evidence with verification — it is metadata evidence, not a visual AI detector, and it does not promise every marker is removed.",
    tile: "bg-[#f3eefe] text-[#8430e0]",
    icon: (
      <svg viewBox="0 0 24 24" className="h-[1.3rem] w-[1.3rem]" fill="currentColor">
        <path d="M9.4 4c.4-1.15 2-1.15 2.4 0l1.1 3.6a4.2 4.2 0 0 0 2.8 2.8l3.6 1.1c1.15.4 1.15 2 0 2.4l-3.6 1.1a4.2 4.2 0 0 0-2.8 2.8l-1.1 3.6c-.4 1.15-2 1.15-2.4 0l-1.1-3.6a4.2 4.2 0 0 0-2.8-2.8l-3.6-1.1c-1.15-.4-1.15-2 0-2.4l3.6-1.1a4.2 4.2 0 0 0 2.8-2.8L9.4 4Z" />
        <circle cx="19.4" cy="4.9" r="1.8" />
      </svg>
    ),
  },
  {
    title: "Private by architecture, not by promise",
    body: "File reads, inspection, cleaning, verification and reports all run in this browser tab — the files never leave your device. Your originals are never modified: cleaning writes a separate copy in the original format and offers it only after verification.",
    tile: "bg-[#e2f7ef] text-[#0f9a68]",
    icon: (
      <svg viewBox="0 0 24 24" className="h-[1.3rem] w-[1.3rem]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2.8 18.9 5v5.3c0 4.7-2.7 8.3-6.9 10-4.2-1.7-6.9-5.3-6.9-10V5L12 2.8Z" />
        <path d="m9 11.6 2.1 2.1 4-4.7" />
      </svg>
    ),
  },
];

/**
 * Short SEO/educational section below the Screen 01 workspace ("Why
 * clean image metadata?"). Plain-English, precise claims only: supported
 * evidence, verification, originals untouched — no keyword stuffing, no
 * "fully clean" promises.
 */
export default function WhyCleanPanel() {
  return (
    <section id="why-metadata" aria-labelledby="why-metadata-heading" className="mx-auto max-w-7xl px-4 pt-8 sm:px-6 lg:px-8 lg:pt-10">
      <div className="rounded-[1.35rem] border border-[#e9eef6] bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,.04),0_16px_40px_-18px_rgba(39,55,91,.12)] sm:p-8 lg:p-10">
        <p className="section-kicker">Learn more</p>
        <h2 id="why-metadata-heading" className="mt-2 text-[1.65rem] font-extrabold tracking-[-0.03em] text-[#111c3c] sm:text-[1.9rem]">
          Why clean image metadata?
        </h2>
        <p className="mt-3 max-w-[46rem] text-[15.5px] leading-[1.75] text-[#5a6b85]">
          Every picture carries invisible records alongside its pixels. Some are technical, some are descriptive, and every so often they say more about you than the photo itself. Cleaning them is a small step with a real privacy payoff — and this tool does it locally, with verification.
        </p>
        <ul className="mt-7 grid gap-4 md:grid-cols-2">
          {POINTS.map((point) => (
            <li key={point.title} className="flex items-start gap-4 rounded-[1.05rem] border border-[#edf1f8] bg-[#fbfcff] p-5 sm:p-6">
              <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[0.8rem] ${point.tile}`} aria-hidden="true">
                {point.icon}
              </span>
              <span className="min-w-0">
                <h3 className="text-[16px] font-extrabold tracking-[-0.01em] text-[#16244a]">{point.title}</h3>
                <p className="mt-2 text-[14.5px] leading-[1.75] text-[#5a6b85]">{point.body}</p>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
