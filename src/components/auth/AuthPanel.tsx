"use client";

import { useState } from "react";
import { isFirebaseConfigured } from "../../lib/firebase/config";
import { signInWithGoogle, signOutNow, type SignedInUser } from "../../lib/firebase/auth";
import { refreshSessionToken } from "../../lib/firebase/session";

/**
 * Google sign-in entry (Phase 6, extended 6A). Guest flows are never
 * blocked: this panel only gates profile/rewrite actions. Closing or
 * cancelling never touches the queue, inspections, or cleaned outputs.
 * The refresh control re-reads the ID token after an owner-side role
 * promotion without requiring a full sign-out cycle.
 */
export default function AuthPanel({
  user,
  superadmin,
  suspended,
  onUser,
  onNotice,
}: {
  user: SignedInUser | null;
  superadmin: boolean;
  suspended: boolean;
  onUser: (user: SignedInUser | null) => void;
  onNotice: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configured = isFirebaseConfigured();

  const handleSignIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await signInWithGoogle();
      if (outcome.status === "signed-in") {
        onUser(outcome.user);
        onNotice(`Signed in as ${outcome.user.displayName ?? outcome.user.email ?? "Google user"}. Your queue and outputs are unchanged.`);
      } else if (outcome.status === "cancelled") {
        onNotice("Sign-in cancelled — your queue, inspections and cleaned outputs are unchanged.");
      } else {
        setError(outcome.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message.slice(0, 300) : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    setBusy(true);
    try {
      await signOutNow();
      onUser(null);
      onNotice("Signed out. In-memory profile cleared; downloaded files and queue entries are unaffected.");
    } catch (err) {
      setError(err instanceof Error ? err.message.slice(0, 300) : "Sign-out failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleRefresh = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await refreshSessionToken();
      if (next) {
        onUser({ uid: next.uid, displayName: next.displayName, email: next.email, photoURL: next.photoURL });
        onNotice(next.superadmin
          ? "Login status refreshed — superadmin claim present. The Admin Dashboard link is in the hero section."
          : "Login status refreshed — no superadmin claim on this account.");
      } else {
        onNotice("No active session — please sign in again.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message.slice(0, 300) : "Refresh failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!configured) {
    return (
      <section aria-label="Sign in" data-testid="auth-panel" className="surface-card mt-6 rounded-[1.5rem] p-4 sm:p-6">
        <h2 className="text-base font-semibold">My Metadata Profile — Google sign-in</h2>
        <p className="mt-2 text-xs text-slate-600">
          Google profile features are not configured on this site. Guest inspection, cleaning, ZIP and reports
          work fully without sign-in. The site owner must add Firebase web settings (see .env.local.example) and rebuild.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Sign in" data-testid="auth-panel" className="surface-card mt-6 rounded-[1.5rem] p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-base font-semibold">My Metadata Profile — Google sign-in</h2>
        {user ? (
          <span className="ml-auto flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-700">
            <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-800" data-testid="auth-user">
              {user.displayName ?? user.email ?? user.uid}
            </span>
            {superadmin ? (
              <a href="admin" data-testid="auth-admin-link" className="rounded-full bg-slate-900 px-2 py-1 text-white">
                Admin Dashboard
              </a>
            ) : null}
            <button type="button" onClick={() => void handleRefresh()} disabled={busy} title="Re-read your login role (use after the owner promotes this account)." className="btn-secondary !min-h-9 !px-3 !py-1.5 text-xs">
              Refresh status
            </button>
            <button type="button" onClick={() => void handleSignOut()} disabled={busy} className="btn-secondary !min-h-9 !px-3 !py-1.5 text-xs">
              {busy ? "Working…" : "Sign out"}
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => void handleSignIn()} disabled={busy} data-testid="auth-signin" className="btn-success ml-auto !min-h-10 text-xs">
            {busy ? "Opening Google…" : "Sign in with Google (only for saving/applying profiles)"}
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-slate-600">
        Sign-in is required only to save or apply your own custom metadata. Guests keep full inspect, clean,
        bulk ZIP and CSV/PDF access with no login and no file-count cap. Cancelling sign-in never clears your queue.
        Google display names are never embedded as image authorship.
      </p>
      {error ? <p role="alert" data-testid="auth-error" className="mt-2 text-xs text-red-700">✖ {error}</p> : null}
      {user && suspended ? (
        <p role="alert" data-testid="auth-suspended" className="mt-2 rounded-lg bg-amber-50 p-2 text-xs font-medium text-amber-800">
          This account is suspended from signed-in cloud features (saved profiles are unavailable).
          Google sign-in itself still works, and anonymous browser cleaning on this page is unaffected.
        </p>
      ) : null}
    </section>
  );
}
