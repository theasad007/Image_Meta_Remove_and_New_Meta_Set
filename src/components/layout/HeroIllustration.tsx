import Image from "next/image";
import type { SVGProps } from "react";
import { cn } from "../../lib/cn";
// Bundled handwriting font for the two annotations (OFL-licensed, self-hosted
// via @fontsource — no runtime font fetch, static-export safe).
import "@fontsource/caveat/500.css";
import "@fontsource/caveat/600.css";

/**
 * Decorative hero illustration for Screen 01 (before upload).
 *
 * Everything here is a static marketing graphic: the "Removed" chips show
 * conceptual asset states, not live inspection results, and the whole
 * block is aria-hidden so screen readers only meet the real copy in the
 * surrounding hero. The "photo" is an inline SVG scene — no external or
 * hotlinked asset, nothing to license.
 */

function ExifIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M9 6.4V5.6A2.6 2.6 0 0 1 11.6 3h.8A2.6 2.6 0 0 1 15 5.6v.8h3.4A2.6 2.6 0 0 1 21 9v8.4a2.6 2.6 0 0 1-2.6 2.6H5.6A2.6 2.6 0 0 1 3 17.4V9a2.6 2.6 0 0 1 2.6-2.6H9Zm1.6 0h2.8V5.6a1 1 0 0 0-1-1h-.8a1 1 0 0 0-1 1v.8ZM8 10.2a1 1 0 0 0-1 1v.4a1 1 0 0 0 1 1h2.4a1 1 0 0 0 1-1v-.4a1 1 0 0 0-1-1H8Z" />
    </svg>
  );
}

function GpsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 2.6c-4 0-7.2 3.1-7.2 7 0 4.9 5.4 10.6 6.5 11.7a1 1 0 0 0 1.4 0c1.1-1.1 6.5-6.8 6.5-11.7 0-3.9-3.2-7-7.2-7Zm0 9.8a2.9 2.9 0 1 1 0-5.8 2.9 2.9 0 0 1 0 5.8Z" />
    </svg>
  );
}

function XmpIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M6.4 2.8A2.4 2.4 0 0 0 4 5.2v13.6a2.4 2.4 0 0 0 2.4 2.4h11.2a2.4 2.4 0 0 0 2.4-2.4V8.3a2.4 2.4 0 0 0-.9-1.9l-3.6-2.9a2.4 2.4 0 0 0-1.5-.7H6.4Zm1.2 8.4h9v1.9h-9v-1.9Zm0 3.9h6.1v1.9H7.6v-1.9Z" />
    </svg>
  );
}

function IptcIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="m12 2.9 9.3 4.4a.9.9 0 0 1 0 1.6L12 13.3 2.7 8.9a.9.9 0 0 1 0-1.6L12 2.9Z" />
      <path d="m4.4 11.9-1.7.8a.9.9 0 0 0 0 1.6L12 18.7l9.3-4.4a.9.9 0 0 0 0-1.6l-1.7-.8L12 16.1l-7.6-4.2Z" />
      <path d="m4.4 16.4-1.7.9a.9.9 0 0 0 0 1.6L12 23.2l9.3-4.3a.9.9 0 0 0 0-1.6l-1.7-.9L12 20.6l-7.6-4.2Z" />
    </svg>
  );
}

function AiIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M9.6 3.4c.4-1 1.7-1 2 0l1.2 3.8a4.4 4.4 0 0 0 2.9 2.9l3.8 1.2c1 .4 1 1.7 0 2l-3.8 1.2a4.4 4.4 0 0 0-2.9 2.9L11.5 21c-.4 1-1.7 1-2 0l-1.2-3.8a4.4 4.4 0 0 0-2.9-2.9l-3.8-1.1c-1-.4-1-1.7 0-2.1l3.8-1.2A4.4 4.4 0 0 0 8.3 7L9.6 3.4Z" />
      <circle cx="19" cy="4.4" r="1.9" />
      <circle cx="20.6" cy="16.9" r="1.4" />
    </svg>
  );
}

function ImageIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="9" cy="9.6" r="1.45" fill="currentColor" />
      <path d="m6 17.4 3.9-3.9 2.7 2.7a1.8 1.8 0 0 0 2.5 0L20 11.9" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

const ROWS: Array<{ label: string; Icon: typeof ExifIcon }> = [
  { label: "EXIF", Icon: ExifIcon },
  { label: "GPS", Icon: GpsIcon },
  { label: "XMP", Icon: XmpIcon },
  { label: "IPTC", Icon: IptcIcon },
  { label: "AI indicators", Icon: AiIcon },
];

const HAND =
  '"Caveat", "Segoe Script", "Bradley Hand", "Marker Felt", "Comic Sans MS", cursive';

function MountainPhoto() {
  // Real photograph, bundled locally (see public/images/CREDITS.md for the
  // Unsplash source and license). Rendered inside the same white matte
  // card; everything around it stays a live, editable DOM element.
  // Static export ships unoptimized images (next.config), so this is a
  // plain pass-through <img> with fixed dimensions — eager decode for the
  // above-the-fold hero.
  return (
    <Image
      src="/images/hero-lago-di-braies.jpg"
      alt=""
      width={900}
      height={599}
      className="block aspect-[300/260] w-full object-cover"
      priority
    />
  );
}

export default function HeroIllustration({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("@container relative mx-auto w-full max-w-[660px] select-none", className)}>
      {/* soft radial glows behind the composition. The right glow keeps a
          1rem bleed so its box never extends past the viewport (which
          would create horizontal scroll on phones and ≤1408px laptops). */}
      <div className="absolute -right-4 -top-16 h-72 w-72 rounded-full bg-[#dbeafc]/90 blur-3xl" />
      <div className="absolute -top-6 left-1/3 h-44 w-64 rounded-full bg-[#e7f2fe]/80 blur-3xl" />
      <div className="absolute bottom-6 left-0 h-64 w-72 rounded-full bg-[#e0f6ec]/80 blur-3xl" />

      <div className="relative aspect-[660/470] w-full">
        {/* dotted orbit circle around the composition */}
        <div className="absolute left-[9%] top-[3%] aspect-square w-[80%] rounded-full border-[1.5px] border-dashed border-[#c3d5f8]" />

        {/* annotation: "Original stays untouched" + curved arrow */}
        <div className="absolute left-[-2%] top-[1%] flex w-[24%] rotate-[-7deg] flex-col items-start">
          <p
            className="text-[clamp(0.6rem,2.3cqw,0.95rem)] font-bold leading-[1.45] text-[#43507a]"
            style={{ fontFamily: HAND }}
          >
            Original stays
            <br />
            <span className="ml-[0.8em]">untouched</span>
          </p>
          <svg viewBox="0 0 46 40" className="ml-[0.35em] mt-[0.15em] h-[8cqw] w-[9cqw] max-h-11 max-w-12 text-[#43507a]" fill="none">
            <path d="M10 4c2 12 8 24 22 30" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            <path d="M25 36.5l7.4-2-2.4-7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        {/* annotation: "Clean copy with verified metadata" + curved arrow */}
        <div className="absolute right-[-1%] top-[44%] w-[25%] rotate-[2deg] text-right">
          <p
            className="text-[clamp(0.6rem,2.3cqw,0.95rem)] font-bold leading-[1.45] text-[#43507a]"
            style={{ fontFamily: HAND }}
          >
            Clean copy
            <br />
            with verified
            <br />
            metadata
          </p>
          <svg viewBox="0 0 56 44" className="-mt-[0.4em] ml-auto h-[9cqw] w-[10cqw] max-h-12 max-w-14 -scale-x-100 text-[#43507a]" fill="none">
            <path d="M10 4c2 12 8 24 22 30" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            <path d="M25 36.5l7.4-2-2.4-7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        {/* mountain/lake picture card (rotated, white matte border) */}
        <figure className="absolute left-[2.5%] top-[20%] w-[40%] rotate-[-7deg]">
          <div className="rounded-[1.6rem] bg-white p-[4.5%] shadow-[0_30px_60px_-20px_rgba(29,48,99,.4)]">
            <div className="overflow-hidden rounded-[1.1rem]">
              <MountainPhoto />
            </div>
          </div>
        </figure>

        {/* floating metadata card */}
        <div className="absolute left-[41%] top-[8%] w-[42.5%] rounded-[1.7cqw] bg-white p-[3.4cqw] shadow-[0_34px_70px_-24px_rgba(29,48,99,.42)]">
          <div className="mb-[1.2cqw] flex items-center gap-[2.6cqw] px-[1.4cqw]">
            <span className="inline-flex h-[3cqw] w-[3cqw] shrink-0 items-center justify-center rounded-full border-[0.45cqw] border-[#cdd9fb] bg-white">
              <span className="h-[1.05cqw] w-[1.05cqw] rounded-full bg-[#3f66e8]" />
            </span>
            <span className="text-[clamp(0.65rem,2.85cqw,1.1rem)] font-extrabold tracking-[-0.01em] text-[#16244a]">Metadata</span>
          </div>
          <ul>
            {ROWS.map((row) => (
              <li key={row.label} className="flex items-center justify-between gap-[2cqw] py-[2.05cqw]">
                <span className="flex min-w-0 items-center gap-[2.9cqw]">
                  <row.Icon className="h-[2.7cqw] w-[2.7cqw] min-h-3 min-w-3 shrink-0 text-[#27355e]" />
                  <span className="truncate text-[clamp(0.55rem,2.1cqw,0.84rem)] font-semibold text-[#27355e]">{row.label}</span>
                </span>
                <span className="shrink-0 whitespace-nowrap rounded-full bg-[#e2f6ec] px-[3.3cqw] py-[1.35cqw] text-[clamp(0.45rem,1.78cqw,0.72rem)] font-bold leading-none text-[#128a56]">
                  Removed
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* verified-clean shield badge — drawn after the card so it lands
            in front, right of the metadata card as in the reference */}
        <div className="absolute left-[84%] top-[16%] w-[12.5%]">
          <div className="flex aspect-square items-center justify-center rounded-[24%] bg-[#d9f5e7] shadow-[0_20px_44px_-14px_rgba(16,163,111,.5)]">
            <svg viewBox="0 0 24 24" className="h-[60%] w-[60%]">
              <defs>
                <linearGradient id="shield-g" x1="12" y1="2" x2="12" y2="22" gradientUnits="userSpaceOnUse">
                  <stop offset=".25" stopColor="#14b981" />
                  <stop offset="1" stopColor="#0d9163" />
                </linearGradient>
              </defs>
              <path d="M12 2.2 19 4.6v5.2c0 5-2.9 8.7-7 10.6-4.1-1.9-7-5.6-7-10.6V4.6L12 2.2Z" fill="url(#shield-g)" />
              <path d="m8.4 11.9 2.3 2.3 4.9-6.3" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          </div>
        </div>
      </div>

      {/* supported-formats pill below the cluster */}
      <div className="relative mx-auto -mt-[4%] ml-[18%] flex w-[56%] min-w-[210px] items-center justify-center gap-[0.5rem] rounded-full bg-white px-[1.4rem] py-[0.65rem] shadow-[0_18px_44px_-16px_rgba(29,48,99,.35)]">
        <ImageIcon className="h-[1.15rem] w-[1.15rem] shrink-0 text-[#27355e]" />
        <span className="whitespace-nowrap text-[clamp(0.6rem,2.15cqw,0.9rem)] font-bold text-[#27355e]">JPG, PNG, WebP, AVIF, HEIC and more</span>
      </div>
    </div>
  );
}
