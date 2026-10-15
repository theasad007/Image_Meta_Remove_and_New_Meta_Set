"use client";

import { useEffect, useState } from "react";
import { signInWithGoogle } from "../../lib/firebase/auth";
import { isFirebaseConfigured } from "../../lib/firebase/config";
import { fetchSessionUser, type SessionUser } from "../../lib/firebase/session";

/**
 * Homepage sign-in CTA (Phase 6A). Replaces "See how it works" in the hero,
 * keeping the exact button styling and responsive visibility. One Google
 * OAuth flow serves both sign-in and first-time registration — no password
 * system. Queue and cleaning results are never touched by auth actions.
 */
export default function HeroAuthCta({ onNotice }: { onNotice?: (message: string) => void }) {
  const [session, setSession] = useState<SessionUser | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configured = isFirebaseConfigured();

  useEffect(() => {
    if (!configured) return;
    let active = true;
    void fetchSessionUser().then((next) => {
      if (active) setSession(next);
    }).catch(() => {
      if (active) setSession(null);
    });
    return () => {
      active = false;
    };
  }, [configured]);

  const handleSignIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await signInWithGoogle();
      if (outcome.status === "signed-in") {
        const next = await fetchSessionUser().catch(() => null);
        setSession(next ?? { ...outcome.user, superadmin: false });
        onNotice?.(`Signed in as ${outcome.user.displayName ?? outcome.user.email ?? "Google user"}. Your files are untouched.`);
      } else if (outcome.status === "cancelled") {
        onNotice?.("Sign-in cancelled — your queue and results are unchanged.");
      } else {
        setError(outcome.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message.slice(0, 300) : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!configured) {
    return (
      <span className="inline-flex flex-col gap-1" data-testid="hero-auth-cta">
        <span
          aria-disabled="true"
          title="Google sign-in is not configured on this site yet."
          className="btn-secondary hidden !min-h-12 cursor-not-allowed !px-5 opacity-60 lg:inline-flex"
        >
          Sign in / Sign up with Google
        </span>
        <span className="hidden text-[11px] font-medium text-slate-500 lg:inline">
          Google sign-in is not configured — guest cleaning works fully.
        </span>
      </span>
    );
  }

  if (session === undefined) {
    return (
      <span data-testid="hero-auth-cta" aria-label="Checking sign-in status" className="btn-secondary hidden !min-h-12 !px-5 opacity-60 lg:inline-flex">
        Sign in / Sign up with Google
      </span>
    );
  }

  if (session) {
    return (
      <span className="hidden items-center gap-2 lg:inline-flex" data-testid="hero-auth-cta">
        <a href="#account" className="btn-secondary !min-h-12 !px-5">
          Account / Metadata Profile
        </a>
        {session.superadmin ? (
          <a href="admin" className="btn-secondary !min-h-12 !px-5" data-testid="hero-admin-link">
            Admin Dashboard
          </a>
        ) : null}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col gap-1" data-testid="hero-auth-cta">
      <button
        type="button"
        onClick={() => void handleSignIn()}
        disabled={busy}
        className="btn-secondary hidden !min-h-12 !px-5 lg:inline-flex"
      >
        {busy ? "Opening Google…" : "Sign in / Sign up with Google"}
      </button>
      {error ? (
        <span role="alert" className="hidden max-w-64 text-[11px] font-medium text-red-700 lg:inline">
          {error}
        </span>
      ) : null}
    </span>
  );
}
