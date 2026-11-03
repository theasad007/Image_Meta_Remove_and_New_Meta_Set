import { cn } from "../../lib/cn";
import HeroIllustration from "./HeroIllustration";

// Note: the standalone "Sign in / Sign up with Google" hero button was
// removed on user request (final visual polish). Google authentication
// remains available on the Profile page (/account/profile) — unchanged.

const BENEFITS = [
  {
    title: "No account required for cleaning",
    // Solid emerald tile with white glyph, as in the approved reference.
    tile: "bg-[#0d9e6e] text-white shadow-[0_8px_18px_rgba(13,158,110,.28)]",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
        <rect x="4.5" y="9.4" width="15" height="10.6" rx="2.6" stroke="currentColor" strokeWidth="1.9" />
        <path d="M8.1 9.2V7a3.9 3.9 0 0 1 7.8 0v2.2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        <circle cx="12" cy="14.7" r="1.5" fill="currentColor" />
      </svg>
    ),
  },
  {
    title: "Two focused tools, one queue",
    tile: "bg-[#e9f2fe] text-[#2d5be9]",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="m12 3.6 9 4.4-9 4.4L3 8l9-4.4Z" />
        <path d="m3 12.6 9 4.4 9-4.4" />
        <path d="m3 16.9 9 4.4 9-4.4" opacity=".55" />
      </svg>
    ),
  },
  {
    title: "Original format preserved",
    tile: "bg-[#f3eefe] text-[#8430e0]",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
        <path d="M9.8 3.9c.4-1.1 1.9-1.1 2.2 0l1 3.3a3.9 3.9 0 0 0 2.6 2.6l3.3 1c1.1.4 1.1 1.9 0 2.2l-3.3 1a3.9 3.9 0 0 0-2.6 2.6l-1 3.3c-.4 1.1-1.9 1.1-2.2 0l-1-3.3a3.9 3.9 0 0 0-2.6-2.6l-3.3-1c-1.1-.4-1.1-1.9 0-2.2l3.3-1a3.9 3.9 0 0 0 2.6-2.6l1-3.3Z" />
        <path d="M18.9 2.8c.2-.6 1-.6 1.2 0l.5 1.5c.3.9.9 1.5 1.8 1.8l1.5.5c.6.2.6 1 0 1.2l-1.5.5a2.6 2.6 0 0 0-1.8 1.8l-.5 1.5c-.2.6-1 .6-1.2 0l-.5-1.5a2.6 2.6 0 0 0-1.8-1.8l-1.5-.5c-.6-.2-.6-1 0-1.2l1.5-.5a2.6 2.6 0 0 0 1.8-1.8l.5-1.5Z" />
      </svg>
    ),
    // Honest qualifier: preservation holds for supported cleaning operations.
    note: "within supported operations",
  },
];

/**
 * Hero for the Screen 01 empty homepage. Two-column on desktop: copy on
 * the left, decorative product illustration on the right. No CTA buttons
 * live here anymore — the header "Choose files" pill and the dropzone
 * below are the upload entry points, matching the approved reference.
 */
export default function Hero() {
  return (
    <section id="top" className="mx-auto max-w-7xl overflow-x-clip px-4 pb-6 pt-8 sm:px-6 sm:pt-10 lg:px-8 lg:pb-4 lg:pt-14">
      <div className="grid items-center gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1.06fr)_minmax(0,0.94fr)] lg:gap-x-10 xl:gap-x-14">
        <div>
          <p className="inline-flex items-center gap-2.5 rounded-full border border-[#d9f0e4] bg-[#e4f6ec] py-1.5 pl-1.5 pr-4 text-[13px] font-bold text-[#0a7a58] shadow-[0_2px_10px_rgba(16,140,100,.08)]">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#0da16e] text-white" aria-hidden="true">
              <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none">
                <rect x="4.4" y="8.3" width="11.2" height="8" rx="2" stroke="currentColor" strokeWidth="1.7" />
                <path d="M6.9 8V6.6a3.1 3.1 0 0 1 6.2 0V8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </span>
            Private by design — files never leave this device
          </p>

          <h1 className="mt-5 text-[2.6rem] font-extrabold leading-[1.05] tracking-[-0.042em] text-[#111c3c] sm:text-[3.3rem] lg:mt-6 lg:text-[3.7rem]">
            <span className="block">Remove hidden</span>
            <span className="block">metadata. <span className="text-[#2d5be9]">Keep your</span></span>
            <span className="block">images <span className="text-[#2d5be9]">yours.</span></span>
          </h1>

          <p className="mt-5 max-w-[36rem] text-[16.5px] leading-[1.7] text-[#5a6b85]">
            Choose the AI Metadata or Metadata &amp; GeoTag tool below to inspect the evidence that matters, remove supported metadata, and download a verified copy. Your original files are never changed.
          </p>

          <ul className="mt-7 flex flex-wrap items-stretch gap-2.5" aria-label="Service highlights">
            {BENEFITS.map((benefit) => (
              <li
                key={benefit.title}
                className="flex items-center gap-2.5 rounded-[1.1rem] border border-[#e9eef6] bg-white px-3 py-2.5 shadow-[0_2px_12px_rgba(23,31,53,.05)]"
              >
                <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-[0.85rem]", benefit.tile)} aria-hidden="true">
                  {benefit.icon}
                </span>
                <span className="max-w-[7rem] text-[13.5px] font-bold leading-[1.3] text-[#1c2a4a]">
                  {benefit.title}
                  {benefit.note ? <span className="sr-only"> ({benefit.note})</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <HeroIllustration />
      </div>
    </section>
  );
}
