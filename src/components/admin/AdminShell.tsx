"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

/**
 * Screen 08 shell (admin dashboard): header, sidebar navigation, mobile
 * drawer and the main column. Navigation only exposes destinations that
 * genuinely exist; every other entry is rendered inert with an honest
 * "Not available" tag — the app is a static, browser-only cleaner with
 * no APIs, rate limiting or log ingestion, and nothing pretends otherwise.
 */

export type AdminTab = "overview" | "users" | "settings";

export interface NavEntry {
  id: string;
  label: string;
  real: boolean;
  /** Honest explanation shown as a tooltip/tag for unavailable entries. */
  note?: string;
}

export const MAIN_NAV: NavEntry[] = [
  { id: "overview", label: "Overview", real: true },
  { id: "users", label: "Users", real: true },
  { id: "usage", label: "Usage & Activity", real: false, note: "Not collected — files are processed privately in each user's browser." },
  { id: "reports", label: "Reports", real: false, note: "Platform usage reports are not collected." },
  { id: "feedback", label: "Feedback", real: false, note: "No feedback collection service exists in this app." },
  { id: "settings", label: "Settings", real: true },
];

export const SYSTEM_NAV: NavEntry[] = [
  { id: "api", label: "API & Keys", real: false, note: "This free browser app sends no API calls — nothing to key." },
  { id: "limits", label: "Rate Limits", real: false, note: "Guest cleaning is unlimited; see the honest usage-policy notice under Settings." },
  { id: "maintenance", label: "Maintenance", real: false, note: "Maintenance tooling does not exist." },
  { id: "logs", label: "Logs", real: false, note: "No server-side logging exists in this app." },
];

const NAV_ICONS: Record<string, React.ReactNode> = {
  overview: <path d="M12 4.5 19.5 10a1 1 0 0 1 .4.8v7.2a1.5 1.5 0 0 1-1.5 1.5H15v-5h-3v5H6.6a1.5 1.5 0 0 1-1.5-1.5v-7.2a1 1 0 0 1 .4-.8L12 4.5Z" />,
  users: <path d="M15.5 19.5v-1.2a3.2 3.2 0 0 0-3.2-3.2H7.2A3.2 3.2 0 0 0 4 18.3v1.2M9.7 11.5a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2ZM20 18.3v-1.1a3.2 3.2 0 0 0-2.4-3.1M15.6 4.4a3.6 3.6 0 0 1 0 6.9" />,
  usage: <path d="M12 8v4l2.5 2.5M20 12a8 8 0 1 1-8-8" />,
  reports: <path d="M8.5 3.5h5.5l3.5 3.5v9.5a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Zm.5 6.5h6M9 13.5h6M9 16.5h3.5" />,
  feedback: <path d="M4.5 5.5h15v10h-9l-4 3.5v-3.5H4.5v-10Zm3.5 4h8" />,
  settings: <path d="m14.5 4 .6 1.9 1.9.6 1.9-.6 1 1.8-1.1 1.6.6 1.8 1.6 1.2-1 1.8-1.9-.3-1.5 1.2-.2 2h-2l-.2-2-1.5-1.2-1.9.3-1-1.8L11.8 12l-.5-1.8L9.7 9l1-1.8 1.9.6 1.5-1.2.2-2h2Zm-1 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z" />,
  api: <path d="M13.5 4.5 8.6 11h4l-1.6 7L16.4 11h-4.2l1.3-6.5Z" />,
  limits: <path d="M12 8.5a3.5 3.5 0 1 0 .01 0 3.5 3.5 0 0 0 0 0m.01-5.5.7 2.3M12 20.5l.7-2.3M8.9 5.1 12 10.9l3.1-5.8M6.1 10.6l2.3.7M20.5 12l-2.3-.7" />,
  maintenance: <path d="M18.5 9.5a4.4 4.4 0 0 1-5.9 4.8L7 19.9a1.6 1.6 0 0 1-2.3-2.3l5.6-5.6A4.4 4.4 0 0 1 14 5.9l-2.2 2.2 1.7 1.7 2.2-2.2a4.4 4.4 0 0 1 2.8 1.9Z" />,
  logs: <path d="M6.5 4.5h11a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1Zm2.5 4h6M9 12h6M9 15.5h3.5" />,
  browser: <path d="M12 3 18 5.3v4.6c0 4-2.4 7.2-6 8.7-3.6-1.5-6-4.7-6-8.7V5.3L12 3Zm-2.6 8.6 1.9 1.9 3.5-3.9" />,
};

function navIcon(id: string): React.ReactNode {
  const path = NAV_ICONS[id] ?? NAV_ICONS.overview;
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {path}
    </svg>
  );
}

function NavList({
  label,
  entries,
  activeTab,
  onSelect,
}: {
  label?: string;
  entries: NavEntry[];
  activeTab: AdminTab;
  onSelect: (tab: AdminTab) => void;
}) {
  return (
    <>
      {label ? <p className="mt-4 px-3 text-[10.5px] font-bold uppercase tracking-[0.14em] text-slate-400">{label}</p> : null}
      <ul className="mt-1 grid gap-0.5">
        {entries.map((entry) => {
          if (entry.real) {
            const active = activeTab === entry.id;
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => onSelect(entry.id as AdminTab)}
                  aria-current={active ? "true" : undefined}
                  data-testid={`admin-nav-${entry.id}`}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] font-semibold transition-colors ${
                    active ? "bg-[#e9f2fe] text-[#2d5be9]" : "text-[#43536e] hover:bg-slate-50"
                  }`}
                >
                  <span aria-hidden="true" className={`h-4.5 w-4.5 shrink-0 ${active ? "text-[#2d5be9]" : "text-[#8296b8]"}`}>
                    {navIcon(entry.id)}
                  </span>
                  {entry.label}
                </button>
              </li>
            );
          }
          return (
            <li key={entry.id}>
              <span
                aria-disabled="true"
                data-testid={`admin-nav-unavailable-${entry.id}`}
                title={entry.note}
                className="flex w-full cursor-default flex-col items-start gap-1 rounded-xl px-3 py-2 text-left text-[13px] font-semibold text-slate-400"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span aria-hidden="true" className="h-4.5 w-4.5 shrink-0 text-slate-300">{navIcon(entry.id)}</span>
                  {entry.label}
                </span>
                <span className="ml-6 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-slate-400">
                  Not available
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

const SITE_LOGO = (
  <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#2d5be9] text-white shadow-[0_8px_18px_rgba(45,91,233,.28)]">
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 18 5.3v4.6c0 4-2.4 7.2-6 8.7-3.6-1.5-6-4.7-6-8.7V5.3L12 3Z" />
    </svg>
  </span>
);

const HEADER_NAV_ICONS = {
  external: <path d="M14 4.5h5.5V10M19.2 4.8 11 13M18 13.8v4.2a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 18V8a1.5 1.5 0 0 1 1.5-1.5H11" />,
  account: <path d="M12 12.5a3.2 3.2 0 1 0-3.2-3.2A3.2 3.2 0 0 0 12 12.5Zm6.5 7.5a6.5 6.5 0 0 0-13 0" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  profile: <path d="M12 7.6a2.9 2.9 0 1 1 0 5.8 2.9 2.9 0 0 1 0-5.8ZM6 19c1.1-2.9 3.4-4.4 6-4.4s4.9 1.5 6 4.4" />,
  refresh: <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v3.2h-3.2" />,
  signOut: <path d="M15 4.5H6.5a1.5 1.5 0 0 0-1.5 1.5v12a1.5 1.5 0 0 0 1.5 1.5H15M13.5 12h6.5m0 0-2.5-2.5M19.5 12 17 14.5" />,
  menu: <path d="M4.5 7h15M4.5 12h15M4.5 17h15" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
};

function headerIcon(path: React.ReactNode, className: string): React.ReactNode {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {path}
    </svg>
  );
}

export default function AdminShell({
  tab,
  onSelectTab,
  displayName,
  emailHint,
  photoURL,
  refreshingRole,
  onRefreshRole,
  onSignOut,
  onRefreshData,
  children,
}: {
  tab: AdminTab;
  onSelectTab: (tab: AdminTab) => void;
  displayName: string;
  emailHint: string;
  photoURL: string;
  refreshingRole: boolean;
  onRefreshRole: () => void;
  onSignOut: () => void;
  onRefreshData: () => void;
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  const initials = (displayName.trim().charAt(0) || (emailHint.trim().charAt(0) || "S")).toUpperCase();

  const sidebar = (inDrawer: boolean) => (
    <div data-in-drawer={inDrawer ? "true" : undefined} className="grid content-start gap-4">
      <div>
        <p className="px-1 text-[13.5px] font-bold text-[#16244a]">Admin Dashboard</p>
        <p className="mt-0.5 flex items-center gap-1.5 px-1 text-[11px] font-semibold text-emerald-700">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Super Admin
        </p>
      </div>
      <nav aria-label="Admin sections">
        <NavList entries={MAIN_NAV} activeTab={tab} onSelect={(id) => { onSelectTab(id); setDrawerOpen(false); }} />
        <div className="mt-4 border-t border-[#e6ebf3] pt-1">
          <p className="px-3 pb-1 pt-3 text-[10.5px] font-bold uppercase tracking-[0.14em] text-slate-400">System</p>
          <NavList entries={SYSTEM_NAV} activeTab={tab} onSelect={(id) => { onSelectTab(id as AdminTab); setDrawerOpen(false); }} />
        </div>
      </nav>
      <section aria-label="Browser-only privacy note" className="mt-2 rounded-2xl border border-emerald-200 bg-[#f2fbf8] p-3.5">
        <div className="flex items-start gap-2.5">
          <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#0d9474] text-white">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              {NAV_ICONS.browser}
            </svg>
          </span>
          <p className="text-[11px] leading-4 text-[#3f6a5d]">
            <strong className="font-bold text-[#0b5f4c]">Browser-only app</strong><br />
            No files are uploaded to any server. Everything is processed locally in the user&apos;s browser.
          </p>
        </div>
      </section>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f4f7fd]">
      <div className="mx-auto flex min-h-screen w-full max-w-[1400px]">
        {/* Desktop sidebar */}
        <aside className="hidden w-[232px] shrink-0 border-r border-[#e6ebf3] bg-white/85 px-3 py-4 lg:block">
          <div className="sticky top-4">{sidebar(false)}</div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Header */}
          <header className="flex items-center gap-3 border-b border-[#e6ebf3] bg-white/85 px-4 py-3 sm:px-6">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-expanded={drawerOpen}
              aria-controls="admin-drawer"
              aria-label="Open navigation menu"
              data-testid="admin-menu-button"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#dde5f0] bg-white text-[#43536e] hover:bg-slate-50 lg:hidden"
            >
              {headerIcon(HEADER_NAV_ICONS.menu, "h-5 w-5")}
            </button>
            <div className="flex min-w-0 items-center gap-2.5">
              {SITE_LOGO}
              <div className="min-w-0">
                <p className="truncate text-[14px] font-bold text-[#16244a]">Private Metadata Cleaner</p>
                <p className="truncate text-[11px] text-[#5a6b85]">Local processing. Zero uploads.</p>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              <Link
                href="/"
                data-testid="admin-visit-site"
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#dde5f0] bg-white px-3 py-2 text-[12.5px] font-semibold text-[#35435c] hover:border-[#aebed2] hover:bg-slate-50"
              >
                Visit site
                {headerIcon(HEADER_NAV_ICONS.external, "h-3.5 w-3.5 text-[#8296b8]")}
              </Link>
              <div className="relative hidden sm:block" ref={menuRef}>
                <button
                  type="button"
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                  onClick={() => setMenuOpen((open) => !open)}
                  data-testid="admin-account-menu-button"
                  className="flex items-center gap-2 rounded-xl border border-transparent px-1.5 py-1 hover:border-[#dde5f0] hover:bg-slate-50"
                >
                  <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-[#e9f2fe] text-[12px] font-bold text-[#2d5be9]">
                    {photoURL ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photoURL} alt="" className="h-9 w-9 object-cover" />
                    ) : (
                      initials
                    )}
                  </span>
                  <span className="grid text-left leading-tight">
                    <span className="max-w-[10rem] truncate text-[12.5px] font-bold text-[#16244a]">{displayName}</span>
                    <span className="text-[10.5px] font-semibold text-[#5a6b85]">Super Admin</span>
                  </span>
                  {headerIcon(HEADER_NAV_ICONS.chevron, "h-3.5 w-3.5 text-[#8296b8]")}
                </button>
                {menuOpen ? (
                  <div role="menu" aria-label="Administrator account" data-testid="admin-account-menu" className="absolute right-0 top-[calc(100%+0.4rem)] z-30 w-64 rounded-2xl border border-[#e6ebf3] bg-white p-1.5 shadow-[0_18px_45px_rgba(39,55,91,.16)]">
                    <p className="px-2.5 pb-1.5 pt-1 text-[10.5px] font-semibold text-[#5a6b85]">
                      <span className="block truncate text-[12px] font-bold text-[#16244a]">{displayName}</span>
                      <span className="block truncate">{emailHint || "Google account"}</span>
                    </p>
                    <Link role="menuitem" href="/account/profile/" className="flex items-center gap-2 rounded-xl px-2.5 py-2 text-[12.5px] font-semibold text-[#35435c] hover:bg-slate-50">
                      {headerIcon(HEADER_NAV_ICONS.profile, "h-4 w-4 text-[#8296b8]")}
                      My metadata profile
                    </Link>
                    <button role="menuitem" type="button" onClick={onRefreshData} className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[12.5px] font-semibold text-[#35435c] hover:bg-slate-50">
                      {headerIcon(HEADER_NAV_ICONS.account, "h-4 w-4 text-[#8296b8]")}
                      Refresh dashboard data
                    </button>
                    <button role="menuitem" type="button" onClick={onRefreshRole} disabled={refreshingRole} className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[12.5px] font-semibold text-[#35435c] hover:bg-slate-50 disabled:opacity-50">
                      {headerIcon(HEADER_NAV_ICONS.refresh, "h-4 w-4 text-[#8296b8]")}
                      <span>{refreshingRole ? "Refreshing role…" : "Refresh role status"}</span>
                    </button>
                    <button
                      role="menuitem"
                      type="button"
                      onClick={() => { setMenuOpen(false); onSignOut(); }}
                      data-testid="admin-account-signout"
                      className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[12.5px] font-semibold text-red-700 hover:bg-red-50"
                    >
                      {headerIcon(HEADER_NAV_ICONS.signOut, "h-4 w-4")}
                      Sign out
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </header>

          {/* Main column */}
          <main id="admin-main" className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8">
            {children}
          </main>
        </div>
      </div>

      {/* Mobile drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-[#0f1c3f]/35"
          />
          <div
            id="admin-drawer"
            role="dialog"
            aria-label="Admin navigation"
            data-testid="admin-drawer"
            className="absolute inset-y-0 left-0 w-[280px] max-w-[85vw] overflow-y-auto bg-white px-3 py-4 shadow-[0_0_60px_rgba(15,28,63,.3)]"
          >
            <div className="mb-2 flex items-center justify-between">
              {SITE_LOGO}
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#dde5f0] text-[#43536e]"
              >
                {headerIcon(HEADER_NAV_ICONS.close, "h-4.5 w-4.5")}
              </button>
            </div>
            {sidebar(true)}
          </div>
        </div>
      ) : null}
    </div>
  );
}
