"use client";

import Link from "next/link";
import { useState } from "react";
import { signOutNow, type SignedInUser } from "../../lib/firebase/auth";
import { refreshSessionToken } from "../../lib/firebase/session";
import type { EntitlementView } from "../../lib/firebase/entitlement";

export type ProfileSection = "editor" | "projects" | "preferences" | "account" | "security";

/** State-driven profile navigation (approved reference). Sections are real,
 *  on-page panels of this screen — never separate fake pages. */
const NAV_ITEMS: Array<{ id: ProfileSection; label: string; icon: React.ReactNode }> = [
  {
    id: "editor",
    label: "Metadata Profile",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="3.4" />
        <path d="M5 20c1.3-3.4 3.9-5 7-5s5.7 1.6 7 5" />
      </svg>
    ),
  },
  {
    id: "projects",
    label: "My Projects",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3.5 7.2c0-1 .8-1.7 1.7-1.7h4l2 2.3h7.6c1 0 1.7.8 1.7 1.7v8.3c0 1-.8 1.7-1.7 1.7H5.2c-1 0-1.7-.8-1.7-1.7V7.2Z" />
      </svg>
    ),
  },
  {
    id: "preferences",
    label: "Rewrite Preferences",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2.8v2.4m0 13.6v2.4M4 12H1.6m20.8 0H20m-2.5-5.5-1.7 1.7M8.2 15.8l-1.7 1.7m0-11L8.2 8.2m7.6 7.6 1.7 1.7" />
      </svg>
    ),
  },
  {
    id: "account",
    label: "Connected Account",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.5 13.5l3-3M9 15l-2.6 2.6a3.2 3.2 0 0 1-4.5-4.5L4.5 10.5M15 9l2.6-2.6a3.2 3.2 0 0 1 4.5 4.5L19.5 13.5" />
      </svg>
    ),
  },
  {
    id: "security",
    label: "Security & Privacy",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2.8 18.9 5v5.3c0 4.7-2.7 8.3-6.9 10-4.2-1.7-6.9-5.3-6.9-10V5L12 2.8Z" />
        <path d="m9 11.6 2.1 2.1 4-4.7" />
      </svg>
    ),
  },
];

function initialsOf(user: { displayName: string | null; email: string | null }): string {
  const source = (user.displayName ?? user.email ?? "").trim();
  if (!source) return "?";
  const parts = source.split(/[\s@._-]+/).filter((part) => /^[a-z0-9]/i.test(part));
  if (parts.length === 0) return source[0]?.toUpperCase() ?? "?";
  return parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : parts[0].slice(0, 2).toUpperCase();
}

/**
 * Screen 07 left column: real Firebase Auth identity (photo, display name,
 * email) with a working sign-out, honest suspension copy, the superadmin
 * dashboard shortcut when the custom claim is present, and the section
 * navigation that switches the visible panel without leaving this page.
 */
export default function AccountSidebar({
  user,
  superadmin,
  suspended,
  entitlement,
  active,
  onActive,
  onNotice,
  onRefreshed,
}: {
  user: SignedInUser;
  superadmin: boolean;
  suspended: boolean;
  /** Verified server-authored entitlement (null = free/unknown). */
  entitlement: EntitlementView | null;
  active: ProfileSection;
  onActive: (section: ProfileSection) => void;
  onNotice: (message: string) => void;
  onRefreshed: (sessionSuperadmin: boolean | null) => void;
}) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const [busy, setBusy] = useState<"idle" | "signout" | "refresh">("idle");
  const [actionError, setActionError] = useState<string | null>(null);

  const handleSignOut = async () => {
    setBusy("signout");
    setActionError(null);
    try {
      await signOutNow();
      onNotice("Signed out. In-memory profile cleared; downloaded files and queue entries are unaffected.");
    } catch (err) {
      setActionError(err instanceof Error ? err.message.slice(0, 200) : "Sign-out failed.");
    } finally {
      setBusy("idle");
    }
  };

  const handleRefresh = async () => {
    setBusy("refresh");
    setActionError(null);
    try {
      const next = await refreshSessionToken();
      if (next) {
        onRefreshed(next.superadmin);
        onNotice(next.superadmin
          ? "Login status refreshed — superadmin claim present. The Admin Dashboard link is below your account details."
          : "Login status refreshed — no superadmin claim on this account.");
      } else {
        onNotice("No active session — please sign in again.");
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message.slice(0, 200) : "Refresh failed.");
    } finally {
      setBusy("idle");
    }
  };

  const showPhoto = Boolean(user.photoURL) && !photoFailed;

  return (
    <div className="grid content-start gap-4">
      <section id="connected-account" aria-labelledby="account-heading" className="surface-card rounded-[1.4rem] p-4 sm:p-5">
        <div data-testid="auth-account" className="flex items-center gap-3">
          <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#e9f2fe] text-sm font-extrabold text-[#2d5be9]">
            {showPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.photoURL as string}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={() => setPhotoFailed(true)}
                className="h-12 w-12 rounded-full object-cover"
              />
            ) : (
              initialsOf(user)
            )}
          </span>
          <span className="min-w-0">
            <span id="account-heading" className="block truncate text-sm font-bold text-[#16244a]">
              {user.displayName?.trim() || "Google account"}
            </span>
            <span className="block truncate text-xs font-normal text-[#5a6b85]">{user.email ?? user.uid}</span>
          </span>
        </div>
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800" data-testid="auth-account-connected">
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="m4 10.5 4 4 8-9" />
          </svg>
          Google account connected
        </p>

        {/* Phase 03: tier badge reflects the verified server entitlement
            only — never localStorage or client state. */}
        {entitlement && entitlement.tier === "premium" && entitlement.status === "active" ? (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#eef2ff] px-2.5 py-1 text-[11px] font-bold text-[#3f4bb8]" data-testid="premium-badge">
            Premium access
            {entitlement.expiresAt && !Number.isNaN(Date.parse(entitlement.expiresAt))
              ? ` · expires ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(entitlement.expiresAt))}`
              : " · no expiry"}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" data-testid="auth-signout" onClick={() => void handleSignOut()} disabled={busy !== "idle"} className="btn-secondary !min-h-9 !px-3 text-xs">
            {busy === "signout" ? "Signing out…" : "Sign out"}
          </button>
          <button
            type="button"
            data-testid="auth-refresh-status"
            onClick={() => void handleRefresh()}
            disabled={busy !== "idle"}
            title="Re-read your login role (use after the owner promotes this account)."
            className="inline-flex min-h-9 items-center rounded-lg border border-transparent px-2 text-xs font-semibold text-[#2d5be9] hover:bg-[#eef3fe] focus-visible:outline-3 focus-visible:outline-[#2d5be9]"
          >
            {busy === "refresh" ? "Refreshing…" : "Refresh status"}
          </button>
          {superadmin ? (
            <a href="/admin/" data-testid="auth-admin-link" className="rounded-full bg-[#16244a] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#0f1830]">
              Admin Dashboard
            </a>
          ) : null}
        </div>
        {actionError ? <p role="alert" className="mt-2 text-xs font-semibold text-red-700">✖ {actionError}</p> : null}
        {suspended ? (
          <p role="alert" data-testid="auth-suspended" className="mt-3 rounded-xl bg-amber-50 p-2.5 text-xs font-medium leading-5 text-amber-900">
            This account is suspended from signed-in cloud features, so saving or deleting a profile is unavailable here.
            Google sign-in itself still works, and anonymous browser cleaning on the workspace is unaffected.
          </p>
        ) : null}
      </section>

      <nav aria-label="Profile sections" className="surface-card rounded-[1.4rem] p-2.5">
        <ul className="grid gap-1">
          {NAV_ITEMS.map((item) => {
            const isActive = item.id === active;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  id={`profile-nav-${item.id}`}
                  onClick={() => onActive(item.id)}
                  aria-controls={`profile-panel-${item.id}`}
                  aria-current={isActive ? "true" : undefined}
                  data-testid={`profile-nav-${item.id}`}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold focus-visible:outline-3 focus-visible:outline-[#2d5be9] ${
                    isActive
                      ? "bg-[#e9f2fe] text-[#2d5be9]"
                      : "text-[#43536e] hover:bg-slate-100"
                  }`}
                >
                  <span aria-hidden="true" className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${isActive ? "bg-white text-[#2d5be9]" : "bg-[#f2f5fa] text-[#5a6b85]"}`}>
                    {item.icon}
                  </span>
                  {item.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <section aria-label="Need help" className="rounded-[1.4rem] border border-[#dbe7f8] bg-[#eef4ff] p-4 sm:p-5">
        <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#2d5be9] shadow-sm">
          <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M9.6 9.2a2.4 2.4 0 1 1 3.4 3.1c-.8.6-1.3 1-1.3 2m.3 2.6v.2" />
          </svg>
        </span>
        <p className="mt-2.5 text-sm font-bold text-[#16244a]">Need help?</p>
        <p className="mt-1 text-xs leading-5 text-[#5a6b85]">
          Profiles apply in the image workspace: open a file&apos;s editor, choose
          &ldquo;Use my saved profile&rdquo;, preview, then apply. Cleaning and reports never need an account.
        </p>
        <Link href="/#privacy" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#2d5be9] hover:underline">
          View guide
          <span aria-hidden="true">→</span>
        </Link>
      </section>
    </div>
  );
}
