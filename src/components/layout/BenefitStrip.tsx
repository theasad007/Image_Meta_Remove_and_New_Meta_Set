const ITEMS = [
  {
    title: "Browser-only processing",
    text: "Nothing is uploaded to any server",
    tile: "bg-[#e9f2fe] text-[#2d5be9]",
    icon: (
      <svg viewBox="0 0 24 24" className="h-[1.35rem] w-[1.35rem]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3.2" y="4.4" width="17.6" height="12" rx="2" />
        <path d="M8.6 20.2h6.8M12 16.6v3.4" />
      </svg>
    ),
  },
  {
    title: "Supports modern formats",
    text: "JPEG, PNG, WebP, AVIF, HEIC",
    tile: "bg-[#e9f2fe] text-[#2d5be9]",
    icon: (
      <svg viewBox="0 0 24 24" className="h-[1.35rem] w-[1.35rem]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
        <circle cx="9" cy="9.6" r="1.45" fill="currentColor" stroke="none" />
        <path d="m6 17.4 3.9-3.9 2.7 2.7a1.8 1.8 0 0 0 2.5 0L20 11.9" />
      </svg>
    ),
  },
  {
    title: "Verified clean copies",
    text: "Check results before you download",
    tile: "bg-[#e2f7ef] text-[#0f9a68]",
    icon: (
      <svg viewBox="0 0 24 24" className="h-[1.35rem] w-[1.35rem]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2.8 18.9 5v5.3c0 4.7-2.7 8.3-6.9 10-4.2-1.7-6.9-5.3-6.9-10V5L12 2.8Z" />
        <path d="m9 11.6 2.1 2.1 4-4.7" />
      </svg>
    ),
  },
  {
    title: "Free to use",
    text: "No sign-in needed for cleaning",
    tile: "bg-[#f3eefe] text-[#8430e0]",
    icon: (
      <svg viewBox="0 0 24 24" className="h-[1.35rem] w-[1.35rem]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="8.2" width="16" height="3.6" rx="1.4" />
        <path d="M5.6 11.8v6.8a1.8 1.8 0 0 0 1.8 1.8h9.2a1.8 1.8 0 0 0 1.8-1.8v-6.8M12 3.6c-1.9 0-3.2 1-3.2 2.6 0 1.2 1 2 2.6 2H12V3.6Zm0 0c1.9 0 3.2 1 3.2 2.6 0 1.2-1 2-2.6 2H12V3.6Z" />
        <path d="M12 11.8v8.6" />
      </svg>
    ),
  },
];

/**
 * Compact four-stat strip under the Screen 01 workspace, matching the
 * approved reference ("Browser-only / modern formats / verified copies /
 * free to use").
 */
export default function BenefitStrip() {
  return (
    <section aria-label="Why this tool is safe" className="mx-auto max-w-[84rem] px-4 pb-1 pt-8 sm:px-6 lg:px-8 lg:pt-9">
      <ul className="flex flex-col gap-4 rounded-[1.25rem] border border-[#e9eef6] bg-white px-6 py-5 shadow-[0_1px_2px_rgba(15,23,42,.04),0_16px_40px_-18px_rgba(39,55,91,.12)] sm:grid sm:grid-cols-2 sm:gap-x-6 lg:flex lg:flex-row lg:items-center lg:justify-between lg:py-4">
        {ITEMS.map((item) => (
          <li key={item.title} className="flex items-center gap-3.5">
            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[0.85rem] ${item.tile}`} aria-hidden="true">
              {item.icon}
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] font-extrabold tracking-[-0.01em] text-[#16244a]">{item.title}</span>
              <span className="mt-0.5 block text-[13.5px] leading-5 text-[#61708c]">{item.text}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
