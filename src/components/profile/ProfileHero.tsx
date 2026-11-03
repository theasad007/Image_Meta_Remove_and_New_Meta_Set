"use client";

/**
 * Screen 07 hero (approved reference). Left: "MY ACCOUNT" kicker, heading
 * with the blue accent, spec description. Right: a purely decorative
 * HTML/CSS illustration — tilted preview card, "Your metadata / Your
 * brand" sticker, floating field chips and a handwritten note. It renders
 * NO real profile values (aria-hidden, decorative only).
 */
export default function ProfileHero() {
  return (
    <section aria-labelledby="profile-hero-heading" className="relative overflow-hidden rounded-[1.4rem] surface-card px-5 py-8 sm:px-8 lg:px-10">
      <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="max-w-2xl">
          <p className="section-kicker">My account</p>
          <h1 id="profile-hero-heading" className="mt-3 text-[2.5rem] font-extrabold leading-[1.05] tracking-[-0.03em] text-[#131f3d] sm:text-[3.2rem]">
            Your <span className="text-[#2d5be9]">metadata profile</span>
          </h1>
          <p className="mt-4 text-[15px] leading-7 text-slate-600">
            Save your reusable publisher, creator, copyright, and image metadata. Apply your saved details when rewriting images without entering them every time. Your original files stay on your device.
          </p>
        </div>

        {/* Decorative reference illustration — no real data */}
        <div className="relative mx-auto h-56 w-full max-w-md sm:h-60" aria-hidden="true">
          <div className="absolute left-6 top-10 h-36 w-52 -rotate-6 rounded-2xl border border-white/70 bg-gradient-to-br from-[#8fd8f2] via-[#e6f6ff] to-[#cdddfc] p-2 shadow-[0_22px_45px_rgba(37,55,91,.22)]">
            {/* Decorative "photo" card: mountain lake scene (pure SVG). */}
            <div className="h-full w-full overflow-hidden rounded-xl">
              <svg viewBox="0 0 208 144" preserveAspectRatio="xMidYMid slice" className="h-full w-full" aria-hidden="true">
                <defs>
                  <linearGradient id="pm-sky" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#bfe9fb" />
                    <stop offset="1" stopColor="#eef8ff" />
                  </linearGradient>
                  <linearGradient id="pm-lake" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#a9cdf1" />
                    <stop offset="1" stopColor="#84abdf" />
                  </linearGradient>
                </defs>
                <rect width="208" height="144" fill="url(#pm-sky)" />
                <circle cx="152" cy="36" r="14" fill="#fff8dd" opacity="0.92" />
                <path d="M0 98 46 40 88 98Z" fill="#62809c" />
                <path d="M64 98 118 30 176 98Z" fill="#43628b" />
                <path d="M118 30 132 47m-14-17L108 49" stroke="#f4fbff" strokeOpacity="0.6" strokeWidth="2.4" fill="none" strokeLinecap="round" />
                <path d="M110 98 156 50 208 98Z" fill="#54719b" />
                <rect y="98" width="208" height="46" fill="url(#pm-lake)" />
                <path d="M92 106h58M104 118h76M72 112h28M122 130h40" stroke="#ffffff" strokeOpacity="0.32" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
          </div>
          <div className="absolute -top-3 left-[-0.4rem] flex rotate-[-8deg] items-center gap-1.5 rounded-xl border border-emerald-200 bg-[#12a25e] px-3 py-2 text-white shadow-[0_12px_28px_rgba(18,162,94,.35)]">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3 15 5.6v5c0 3.8-2.6 6.8-3 7-.4-.2-3-3.2-3-7v-5L12 3Z" />
              <path d="m9.5 10.5 1.8 1.8 3.4-3.6" />
            </svg>
            <span className="text-[11px] font-bold leading-3">Your metadata<br />Your brand</span>
          </div>
          <div className="absolute right-2 top-3 flex w-44 -rotate-2 flex-col gap-1.5 rounded-2xl border border-[#e8edf4] bg-white p-2.5 shadow-[0_20px_40px_rgba(37,55,91,.18)]">
            {([
              { label: "Author", tone: "text-[#2d5be9]", d: <circle cx="12" cy="8" r="3.4" /> },
              { label: "Copyright", tone: "text-emerald-600", d: <path d="M12 3 19 5.5v5c0 4.6-2.8 8-7 9.9-4.2-1.9-7-5.3-7-9.9v-5L12 3Z" /> },
              { label: "Keywords", tone: "text-violet-600", d: <path d="M5 7h14M5 12h14M5 17h14" /> },
              { label: "Location", tone: "text-amber-600", d: <path d="M12 21s-6.6-5.6-6.6-11A6.6 6.6 0 0 1 12 3.4 6.6 6.6 0 0 1 18.6 10c0 5.4-6.6 11-6.6 11Z" /> },
            ] as const).map((chip) => (
              <span key={chip.label} className="flex items-center gap-2 rounded-lg bg-white px-1.5 py-1 text-[11px] font-bold text-[#2f3c55]">
                <svg viewBox="0 0 24 24" className={`h-4 w-4 ${chip.tone}`} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  {chip.d}
                </svg>
                {chip.label}
              </span>
            ))}
          </div>
          <div className="absolute -right-1 bottom-0">
            <p className="font-hand -rotate-6 text-[17px] leading-4 text-[#3157a6]">
              Apply to any image
              <br />
              <span className="ml-4">with one click</span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
