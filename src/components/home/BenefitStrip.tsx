import { FileImage, Gift, ShieldCheck, MonitorSmartphone } from "lucide-react";
import type { ComponentType } from "react";

const ITEMS: Array<{
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  square: string;
  title: string;
  text: string;
}> = [
  {
    icon: MonitorSmartphone,
    square: "bg-[#eef2ff] text-[#3157d5]",
    title: "Browser-only processing",
    text: "Nothing is uploaded to any server",
  },
  {
    icon: FileImage,
    square: "bg-[#eef2ff] text-[#3157d5]",
    title: "Supports modern formats",
    text: "JPEG, PNG, WebP, AVIF, HEIC",
  },
  {
    icon: ShieldCheck,
    square: "bg-[#e7f8f2] text-[#0d9474]",
    title: "Verified clean copies",
    text: "Check results before you download",
  },
  {
    icon: Gift,
    square: "bg-[#f3ecff] text-[#8b5cf6]",
    title: "Free to use",
    text: "No sign-in needed for cleaning",
  },
];

/** Four lightweight benefit items under the workspace panel. */
export default function BenefitStrip() {
  return (
    <ul className="grid gap-4 rounded-3xl border border-[#dce4ee]/90 bg-white/90 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_55px_rgba(39,55,91,0.07)] backdrop-blur-sm sm:grid-cols-2 lg:grid-cols-4 lg:gap-6 lg:p-6">
      {ITEMS.map((item) => (
        <li key={item.title} className="flex items-center gap-3.5">
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${item.square}`} aria-hidden="true">
            <item.icon className="h-5.5 w-5.5" strokeWidth={2} />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-extrabold tracking-[-0.01em] text-slate-900">{item.title}</span>
            <span className="mt-0.5 block text-xs leading-5 text-slate-500">{item.text}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
