import { FileImage, MapPin, Tags, ScanEye } from "lucide-react";
import type { ComponentType } from "react";

/**
 * Minimal SEO/education section requested for Screen 01. Claims stay
 * precise: supported evidence is inspected, supported metadata is
 * removed, and outputs are re-read for verification — nothing here
 * promises universal removal or visual AI detection.
 */

const CARDS: Array<{
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  square: string;
  title: string;
  children: string;
}> = [
  {
    icon: FileImage,
    square: "bg-[#eef2ff] text-[#3157d5]",
    title: "EXIF — camera details at home",
    children:
      "Many cameras and phones write technical fields next to the picture: device model, capture time and comments. Sharing those fields can describe exactly how — and with what — a photo was made.",
  },
  {
    icon: MapPin,
    square: "bg-[#e7f8f2] text-[#0d9474]",
    title: "GPS — location coordinates",
    children:
      "Geotagged photos can carry latitude and longitude, so the file itself may reveal where the shot was taken. Removing those coordinates removes that trail from the copy you share.",
  },
  {
    icon: Tags,
    square: "bg-[#f3ecff] text-[#8b5cf6]",
    title: "Descriptive fields — XMP and IPTC",
    children:
      "Captions, titles, keywords, ratings and copyright notes live in XMP and IPTC records. They are read by apps and searchable — helpful for libraries, but they may also say more than intended.",
  },
  {
    icon: ScanEye,
    square: "bg-[#fff4e5] text-[#b45309]",
    title: "AI-related metadata and Content Credentials",
    children:
      "Declarative provenance markers — such as Content Credentials (C2PA) — and declared AI-related fields can state that software or a generative model took part. This tool inspects supported markers and removes supported evidence; it is not a visual AI detector.",
  },
];

export default function WhyCleanSection() {
  return (
    <section id="why-metadata" aria-labelledby="why-metadata-heading" className="py-8">
      <div className="max-w-2xl">
        <p className="section-kicker">Image privacy basics</p>
        <h2 id="why-metadata-heading" className="mt-2 text-2xl font-extrabold tracking-[-0.03em] text-slate-950 sm:text-3xl">
          Why clean image metadata?
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-600 sm:text-[15px] sm:leading-7">
          Metadata is the text a file carries beside its pixels. Camera data, coordinates, descriptive fields and provenance markers all travel with the image when you share it. Cleaning keeps what the viewer should see — the picture — and drops the fields you did not mean to publish.
        </p>
      </div>
      <ul className="mt-7 grid gap-4 sm:grid-cols-2">
        {CARDS.map((card) => (
          <li key={card.title} className="rounded-3xl border border-[#dce4ee]/90 bg-white/90 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_34px_rgba(39,55,91,0.05)] backdrop-blur-sm sm:p-6">
            <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${card.square}`} aria-hidden="true">
              <card.icon className="h-5 w-5" strokeWidth={2} />
            </span>
            <h3 className="mt-3.5 text-[15px] font-extrabold tracking-[-0.01em] text-slate-900">{card.title}</h3>
            <p className="mt-1.5 text-[13px] leading-6 text-slate-600">{card.children}</p>
          </li>
        ))}
      </ul>
      <p className="mt-5 max-w-2xl text-xs leading-5 text-slate-500">
        Every supported claim above is matched by an honest inspection result: what the tool finds, what it removes and what stays are all reported per file, and a cleaned output is only offered after its metadata is re-read and verified.
      </p>
    </section>
  );
}
