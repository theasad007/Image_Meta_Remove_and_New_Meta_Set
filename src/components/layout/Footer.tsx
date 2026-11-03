import Link from "next/link";

const LINKS = [
  { href: "/#tools", label: "Workspace" },
  { href: "/#formats", label: "File support" },
  { href: "/#privacy", label: "Privacy" },
  { href: "/account/profile", label: "Profile" },
];

/**
 * Compact dark-navy footer for Screen 01: brand + privacy statement, the
 * same real routes used by the header (no dummy pages), and an accurate
 * supported-formats / limitations note.
 */
export default function Footer() {
  return (
    <footer className="mt-10 bg-[#101a33] pb-8 pt-9 text-slate-300">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between sm:gap-10">
          <div className="flex items-start gap-3.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[0.85rem] bg-white/10 text-white" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="h-5.5 w-5.5" fill="none">
                <path d="M12 3 19 5.6v5c0 4.7-2.8 8.2-7 10-4.2-1.8-7-5.3-7-10v-5L12 3Z" stroke="currentColor" strokeWidth="1.8" />
                <path d="m8.6 11.5 2.2 2.2 4.7-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
              </svg>
            </span>
            <span className="min-w-0">
              <strong className="block text-[16px] font-extrabold tracking-[-0.02em] text-white">Private Metadata Cleaner</strong>
              <span className="mt-1 block max-w-sm text-[13px] leading-6 text-slate-400">
                Inspection, cleaning and reports run entirely in your browser — your image files never leave this device.
              </span>
            </span>
          </div>

          <nav aria-label="Footer">
            <ul className="flex flex-wrap items-center gap-x-6 gap-y-2.5 text-sm font-semibold">
              {LINKS.map((link) => (
                <li key={link.label}>
                  <Link prefetch={false} href={link.href} className="text-slate-300 hover:text-white motion-safe:transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="mt-7 flex flex-col gap-3 border-t border-white/10 pt-5 text-xs leading-6 text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl">
            Supported formats: JPEG, PNG, WebP, AVIF and supported HEIC still layouts can be inspected and cleaned locally. MP3 files can be inspected, cleaned and rewritten locally. MP4, MOV and WebM open as previews only; video metadata tools, GPS coordinate editing and visual AI detection are not available.
          </p>
          <p className="shrink-0 sm:text-right">
            © 2026 Private Metadata Cleaner by{" "}
            <a
              href="https://techpeakssolutions.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-slate-300 underline-offset-2 hover:text-white hover:underline focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-300"
            >
              TechPeaks Solutions
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
