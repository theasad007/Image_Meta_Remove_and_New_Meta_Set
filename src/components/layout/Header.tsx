"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

const NAV_LINKS: Array<{ href: string; label: string; icon: ReactNode }> = [
  {
    href: "/#tools",
    label: "Workspace",
    icon: (
      <svg viewBox="0 0 24 24" className="h-[1.15rem] w-[1.15rem]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="m3.2 10.6 8.8-6.7 8.8 6.7V19a1.7 1.7 0 0 1-1.7 1.7H4.9A1.7 1.7 0 0 1 3.2 19v-8.4Z" />
        <path d="M9.5 20.7v-6.2h5v6.2" />
      </svg>
    ),
  },
  {
    href: "/#formats",
    label: "File support",
    icon: (
      <svg viewBox="0 0 24 24" className="h-[1.15rem] w-[1.15rem]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13.3 3H7.1A1.8 1.8 0 0 0 5.3 4.8v14.4a1.8 1.8 0 0 0 1.8 1.8h9.8a1.8 1.8 0 0 0 1.8-1.8V8.3L13.3 3Z" />
        <path d="M13.3 3v5.3h5.4" />
      </svg>
    ),
  },
  {
    href: "/docs/",
    label: "Docs",
    icon: (
      <svg viewBox="0 0 24 24" className="h-[1.15rem] w-[1.15rem]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 4.8A1.8 1.8 0 0 1 6.8 3H19v16H6.8A1.8 1.8 0 0 0 5 20.8V4.8Z" />
        <path d="M5 20.8A1.8 1.8 0 0 1 6.8 19H19M9 7h6m-6 3h6m-6 3h4" />
      </svg>
    ),
  },
  {
    href: "/#privacy",
    label: "Privacy",
    icon: (
      <svg viewBox="0 0 24 24" className="h-[1.15rem] w-[1.15rem]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2.8 18.9 5v5.3c0 4.7-2.7 8.3-6.9 10-4.2-1.7-6.9-5.3-6.9-10V5L12 2.8Z" />
        <path d="m9 11.6 2.1 2.1 4-4.7" />
      </svg>
    ),
  },
  {
    href: "/account/profile",
    label: "Profile",
    icon: (
      <svg viewBox="0 0 24 24" className="h-[1.15rem] w-[1.15rem]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="3.6" />
        <path d="M5 20.2c1.2-3.5 3.9-5.2 7-5.2s5.8 1.7 7 5.2" />
      </svg>
    ),
  },
];

/**
 * Screen 01 header. The "Choose files" pill opens the existing private
 * media picker (`#private-media-picker` lives in UploadPanel on this
 * page) inside the browser user-activation; if the input is not present
 * it falls back to scrolling to `#upload`.
 *
 * Screen 04 (after-upload workspace) passes `uploadLabel="Add more files"`
 * to relabel the same pill; the default render is byte-identical to the
 * approved, locked Screen 01 header.
 *
 * Profile and documentation pages pass an active state so their nav link
 * is highlighted. Workspace remains the default for existing screens.
 */
export default function Header({ uploadLabel, active = "workspace" }: { uploadLabel?: string; active?: "workspace" | "profile" | "docs" }) {
  const activeLabel = active === "profile" ? "Profile" : active === "docs" ? "Docs" : "Workspace";
  const router = useRouter();
  const openPicker = () => {
    const input = document.getElementById("private-media-picker");
    if (input instanceof HTMLInputElement) {
      input.click();
      return;
    }
    // Screens without the workspace picker (e.g. the profile page) keep the
    // original behavior: navigate to the homepage uploader.
    router.push("/#upload");
  };

  return (
    <header className="sticky top-0 z-50 border-b border-[#e8edf4] bg-white">
      <div className="mx-auto flex min-h-[4.6rem] max-w-7xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" prefetch={false} className="flex min-w-0 items-center gap-3" aria-label="Private Metadata Cleaner home">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[0.85rem] bg-[#2d5be9] text-white shadow-[0_8px_18px_rgba(45,91,233,.32)]">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none">
              <path d="M12 3 19 5.6v5c0 4.7-2.8 8.2-7 10-4.2-1.8-7-5.3-7-10v-5L12 3Z" stroke="currentColor" strokeWidth="1.8" />
              <path d="m8.6 11.5 2.2 2.2 4.7-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
            </svg>
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[16px] font-extrabold tracking-[-0.02em] text-[#131f3d]">
              Private Metadata Cleaner
            </span>
            <span className="block truncate text-[11.5px] font-medium text-slate-500">
              Local processing. Zero uploads.
            </span>
          </span>
        </Link>

        <nav aria-label="Primary" className="ml-auto hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => {
            const isActive = link.label === activeLabel;
            return (
              <Link
                key={link.label}
                prefetch={false}
                href={link.href}
                aria-current={isActive ? "page" : undefined}
                className={`relative flex items-center gap-2 rounded-xl px-3 py-2 text-[14.5px] font-bold transition-colors ${
                  isActive ? "text-[#2d5be9] hover:bg-[#eef3fe]" : "text-[#394661] hover:bg-slate-100 hover:text-[#131f3d]"
                }`}
              >
                <span aria-hidden="true" className="[&>svg]:stroke-[1.9]">{link.icon}</span>
                {link.label}
                {isActive ? (
                  <span aria-hidden="true" className="absolute -bottom-0.5 left-3 right-3 h-[2.5px] rounded-full bg-[#2d5be9]" />
                ) : null}
              </Link>
            );
          })}
        </nav>

        <details className="relative ml-auto lg:hidden">
          <summary
            aria-label="Open navigation"
            className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm [&::-webkit-details-marker]:hidden"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-none" stroke="currentColor" strokeWidth="1.8">
              <path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13" strokeLinecap="round" />
            </svg>
            Menu
          </summary>
          <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 grid min-w-44 gap-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_18px_45px_rgba(15,23,42,.16)]">
            {NAV_LINKS.map((link) => (
              <Link key={link.label} prefetch={false} href={link.href} className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
                {link.label}
              </Link>
            ))}
          </div>
        </details>

        <button
          type="button"
          onClick={openPicker}
          data-testid="header-choose-files"
          className="ml-2 inline-flex min-h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[0.85rem] bg-[#2d5be9] px-3 text-[13px] font-bold text-white shadow-[0_10px_22px_rgba(45,91,233,.32)] hover:bg-[#1f4ad6] focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#2d5be9] motion-safe:transition-colors sm:px-4 sm:text-sm lg:ml-3"
        >
          <span aria-hidden="true" className="[&>svg]:stroke-[1.9]">
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 15.5V4.5m0 0L7.8 8.7M12 4.5l4.2 4.2M4.5 14.5v3.2a2.3 2.3 0 0 0 2.3 2.3h10.4a2.3 2.3 0 0 0 2.3-2.3v-3.2" />
            </svg>
          </span>
          {uploadLabel ?? "Choose files"}
        </button>
      </div>
    </header>
  );
}
