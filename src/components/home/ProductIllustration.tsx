import {
  Image as ImageIcon,
  Layers,
  MapPin,
  ShieldCheck,
  Sparkles,
  FileImage,
  Tags,
} from "lucide-react";
import type { ComponentType } from "react";

/**
 * Static marketing illustration for the empty homepage. It depicts a
 * conceptual "metadata removed" state — it is NOT a real inspection
 * result, and it never renders file data from this device.
 */

const ROWS: Array<{ label: string; icon: ComponentType<{ className?: string; strokeWidth?: number }> }> = [
  { label: "EXIF", icon: FileImage },
  { label: "GPS", icon: MapPin },
  { label: "XMP", icon: Tags },
  { label: "IPTC", icon: Layers },
  { label: "AI indicators", icon: Sparkles },
];

/** License-free bundled vector landscape (no external asset/hotlink). */
function LakeScene() {
  return (
    <svg
      viewBox="0 0 400 300"
      className="h-full w-full"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="lake-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#bfe0f7" />
          <stop offset="0.65" stopColor="#e8f4fc" />
          <stop offset="1" stopColor="#f6fbfe" />
        </linearGradient>
        <linearGradient id="lake-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9fd8d8" />
          <stop offset="0.5" stopColor="#63b3ad" />
          <stop offset="1" stopColor="#3d8f96" />
        </linearGradient>
        <linearGradient id="lake-peak-far" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9db6d6" />
          <stop offset="1" stopColor="#c3d5e9" />
        </linearGradient>
        <linearGradient id="lake-peak-near" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6f8fba" />
          <stop offset="1" stopColor="#9db4d2" />
        </linearGradient>
      </defs>
      {/* sky */}
      <rect width="400" height="300" fill="url(#lake-sky)" />
      {/* clouds */}
      <g fill="#ffffff" opacity="0.85">
        <ellipse cx="90" cy="46" rx="46" ry="12" />
        <ellipse cx="128" cy="38" rx="30" ry="9" />
        <ellipse cx="292" cy="60" rx="52" ry="11" />
        <ellipse cx="330" cy="52" rx="30" ry="8" />
        <ellipse cx="210" cy="24" rx="36" ry="8" />
      </g>
      {/* far range */}
      <polygon points="0,168 70,84 128,168 128,168 70,120 30,168" fill="url(#lake-peak-far)" />
      <polygon points="40,168 110,74 190,168" fill="url(#lake-peak-far)" />
      <polygon points="150,168 226,90 300,168" fill="url(#lake-peak-far)" />
      <polygon points="260,168 330,96 400,168" fill="url(#lake-peak-far)" />
      {/* snow caps */}
      <polygon points="110,74 132,110 118,106 110,116 100,104 88,110" fill="#ffffff" opacity="0.96" />
      <polygon points="226,90 246,122 234,118 226,128 216,116 206,122" fill="#ffffff" opacity="0.96" />
      <polygon points="330,96 348,124 338,120 330,130 320,118 312,124" fill="#ffffff" opacity="0.94" />
      {/* near dark foothills */}
      <polygon points="0,196 60,132 128,196" fill="url(#lake-peak-near)" opacity="0.9" />
      <polygon points="80,196 170,118 258,196" fill="url(#lake-peak-near)" opacity="0.9" />
      <polygon points="210,196 300,132 388,196" fill="url(#lake-peak-near)" opacity="0.9" />
      {/* forest line */}
      <g fill="#2e6350">
        <path d="M0 196 q60 -14 200 -8 q120 6 200 4 L400 214 L0 214 Z" />
        {[16, 40, 66, 92, 116, 140, 164, 190, 214, 240, 266, 292, 318, 344, 370].map((x, i) => (
          <polygon key={x} points={`${x},${196} ${x - 7},214 ${x + 7},214`} opacity={i % 3 ? 0.9 : 1} />
        ))}
      </g>
      {/* lake */}
      <rect y="208" width="400" height="92" fill="url(#lake-water)" />
      {/* mirrored mountains */}
      <g opacity="0.22" fill="#e9f6fb">
        <polygon points="80,208 170,270 258,208" />
        <polygon points="210,208 300,272 388,208" />
      </g>
      {/* reflections shimmering */}
      <g stroke="#eafffb" strokeWidth="3" strokeLinecap="round" opacity="0.7">
        <line x1="70" y1="236" x2="120" y2="236" />
        <line x1="150" y1="252" x2="212" y2="252" />
        <line x1="256" y1="240" x2="316" y2="240" />
        <line x1="330" y1="266" x2="376" y2="266" />
        <line x1="40" y1="276" x2="96" y2="276" />
      </g>
    </svg>
  );
}

export default function ProductIllustration() {
  return (
    <figure
      role="img"
      aria-label="Conceptual illustration: a mountain lake photo next to a floating Metadata card listing EXIF, GPS, XMP, IPTC and AI indicators with verified-removed status chips. This is a marketing illustration, not a scan result."
      className="relative mx-auto h-[420px] w-full max-w-[560px] sm:h-[440px]"
    >
      {/* soft glows */}
      <div aria-hidden="true" className="absolute -right-10 -top-12 h-64 w-64 rounded-full bg-[#bcd3f9]/45 blur-3xl" />
      <div aria-hidden="true" className="absolute -left-16 bottom-0 h-72 w-72 rounded-full bg-[#c9f3e4]/50 blur-3xl" />
      {/* dotted orbit */}
      <div aria-hidden="true" className="absolute right-2 top-4 h-64 w-64 rounded-full border-2 border-dashed border-[#a9c2f0]/50 sm:h-80 sm:w-80" />

      {/* photo card, rotated */}
      <div className="absolute left-0 top-14 w-60 -rotate-6 rounded-2xl bg-white p-2 shadow-[0_24px_60px_rgba(31,51,102,0.16)] sm:left-2 sm:w-72" aria-hidden="true">
        <div className="h-40 overflow-hidden rounded-xl sm:h-48">
          <LakeScene />
        </div>
        <div className="flex items-center justify-between px-1.5 pb-0.5 pt-2">
          <span className="font-hand text-[15px] leading-4 text-slate-500">Original stays untouched</span>
        </div>
      </div>

      {/* metadata card */}
      <div className="absolute right-0 top-2 w-64 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_28px_70px_rgba(31,51,102,0.18)] sm:right-4 sm:w-72" aria-hidden="true">
        <p className="flex items-center gap-2 text-[15px] font-extrabold tracking-[-0.01em] text-slate-900">
          <span className="h-2.5 w-2.5 rounded-full bg-[#3157d5]" />
          Metadata
        </p>
        <ul className="mt-3 divide-y divide-slate-100">
          {ROWS.map((row) => (
            <li key={row.label} className="flex items-center gap-2.5 py-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#eef2ff] text-slate-800">
                <row.icon className="h-4 w-4" strokeWidth={2} />
              </span>
              <span className="text-[13px] font-bold text-slate-700">{row.label}</span>
              <span className="ml-auto inline-flex shrink-0 items-center rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-extrabold text-emerald-700">
                Removed
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* verified shield */}
      <div
        aria-hidden="true"
        className="absolute right-40 top-24 rounded-2xl bg-gradient-to-br from-white/85 to-emerald-100/90 p-3 shadow-[0_16px_38px_rgba(16,132,92,0.22)] ring-1 ring-emerald-200/70 sm:right-48 sm:top-28"
      >
        <ShieldCheck className="h-7 w-7 text-emerald-600" strokeWidth={2.2} aria-hidden="true" />
      </div>

      {/* annotations in handwriting font */}
      <span
        aria-hidden="true"
        className="font-hand absolute -left-1 top-2 inline-block -rotate-6 text-[17px] leading-5 text-slate-500 sm:left-10"
      >
        Original stays
        <br />
        untouched
        <svg viewBox="0 0 60 44" className="mt-0.5 ml-2 h-8 w-10 fill-none stroke-slate-400" strokeWidth="2" strokeLinecap="round">
          <path d="M6 4 C 10 22, 22 34, 44 38" />
          <path d="M38 34 L45 38.4 L39 42" />
        </svg>
      </span>
      <span
        aria-hidden="true"
        className="font-hand absolute -right-2 bottom-24 inline-block rotate-6 text-right text-[17px] leading-5 text-slate-500 sm:right-6"
      >
        Clean copy
        <br />
        with verified
        <br />
        metadata
        <svg viewBox="0 0 60 44" className="ml-auto mr-1 h-8 w-10 -scale-x-100 fill-none stroke-slate-400" strokeWidth="2" strokeLinecap="round">
          <path d="M6 4 C 10 22, 22 34, 44 38" />
          <path d="M38 34 L45 38.4 L39 42" />
        </svg>
      </span>

      {/* formats chip */}
      <p
        aria-hidden="true"
        className="absolute bottom-0 right-0 inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white px-4 py-2.5 shadow-[0_14px_34px_rgba(31,51,102,0.12)] sm:right-16"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#eef2ff] text-[#3157d5]">
          <ImageIcon className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="text-[13px] font-bold text-slate-700">JPG, PNG, WebP, AVIF, HEIC and more</span>
      </p>
    </figure>
  );
}
