"use client";

import { useState } from "react";
import { isFirebaseConfigured } from "../../lib/firebase/config";
import { signInWithGoogle } from "../../lib/firebase/auth";

/**
 * Screen 07 signed-out gate (approved reference card).
 *
 * Guests never need an account for ANY image work — this panel gates only
 * saving and reusing a metadata profile. Closing, cancelling, blocking or
 * failing sign-in never touches the local queue, inspections or outputs.
 * When signed in, the account card + sections take over and this renders
 * nothing.
 */
export default function AuthPanel({ onNotice }: { onNotice: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configured = isFirebaseConfigured();

  const handleSignIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await signInWithGoogle();
      if (outcome.status === "signed-in") {
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

  if (!configured) {
    return (
      <section aria-label="Sign in" data-testid="auth-panel" className="surface-card rounded-[1.4rem] p-5 sm:p-7">
        <h2 className="text-xl font-bold tracking-[-0.01em] text-[#16244a]">Save your metadata profile</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#5a6b85]">
          Google profile features are not configured on this site, so saved profiles are unavailable right now.
          The site owner must add the Firebase web settings (see <code>.env.local.example</code>) and rebuild.
        </p>
        <ul className="mt-4 grid gap-2 text-sm text-[#3b4a66]">
          <li className="flex gap-2"><Check /> Image cleaning is free without an account.</li>
          <li className="flex gap-2"><Check /> Single-image custom metadata rewriting works without signing in.</li>
          <li className="flex gap-2"><Check /> Original image files are never uploaded.</li>
        </ul>
      </section>
    );
  }

  return (
    <section aria-label="Sign in" data-testid="auth-panel" className="surface-card rounded-[1.4rem] p-5 sm:p-7">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold tracking-[-0.01em] text-[#16244a]">Save your metadata profile</h2>
          <p className="mt-2 text-sm leading-6 text-[#5a6b85]">
            Sign in with Google to securely save and reuse your metadata settings.
          </p>
          <button
            type="button"
            data-testid="auth-signin"
            onClick={() => void handleSignIn()}
            disabled={busy}
            className="btn-secondary mt-4 min-h-11 w-full justify-center px-5 text-sm font-semibold sm:w-auto"
          >
            {busy ? (
              <>
                <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />
                Opening Google sign-in…
              </>
            ) : (
              <>
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4.5 w-4.5">
                  <path fill="#4285F4" d="M23 12.2c0-.8-.1-1.6-.2-2.3H12v4.5h6.1a5.3 5.3 0 0 1-2.3 3.4v2.8h3.7c2.2-2 3.5-5 3.5-8.4Z" />
                  <path fill="#34A853" d="M12 24c3.1 0 5.7-1 7.5-2.8l-3.7-2.8a7.2 7.2 0 0 1-10.7-3.8H1.3v2.9A12 12 0 0 0 12 24Z" />
                  <path fill="#FBBC05" d="M5.1 14.6a7.2 7.2 0 0 1 0-4.6V7.1H1.3a12 12 0 0 0 0 10.8l3.8-3.3Z" />
                  <path fill="#EA4335" d="M12 4.8a6.5 6.5 0 0 1 4.6 1.8l3.3-3.3A12 12 0 0 0 1.3 7.1l3.8 2.9A7.2 7.2 0 0 1 12 4.8Z" />
                </svg>
                Continue with Google
              </>
            )}
          </button>
          {error ? <p role="alert" data-testid="auth-error" className="mt-3 text-xs font-semibold text-red-700">✖ {error}</p> : null}
        </div>

        <ul className="grid shrink-0 content-start gap-2.5 rounded-2xl border border-[#e6ebf3] bg-[#f7fafe] p-4 text-[13px] leading-5 text-[#3b4a66] sm:max-w-xs">
          <li className="flex gap-2"><Check /> Image cleaning is free without an account.</li>
          <li className="flex gap-2"><Check /> Single-image custom metadata rewriting works without signing in.</li>
          <li className="flex gap-2"><Check /> Signing in is needed to save and reuse a metadata profile.</li>
          <li className="flex gap-2"><Check /> Original image files are never uploaded.</li>
        </ul>
      </div>
    </section>
  );
}

function Check() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-[#0d9474]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m4.5 10.5 3.4 3.4 7.6-8.4" />
    </svg>
  );
}
