import { getFirebaseAuth } from "./config";
import type { SignedInUser } from "./auth";

/**
 * Session + authorization helpers (Phase 6A).
 *
 * Superadmin authorization comes ONLY from the Firebase Auth custom claim
 * `superadmin: true` (set owner-side via the local bootstrap CLI). Client
 * state, emails, and Firestore `role` strings are never trusted — every
 * privileged read/write is re-checked by `firestore.rules`.
 */

export interface SessionUser extends SignedInUser {
  superadmin: boolean;
}

/** Pure: derive superadmin status from a decoded ID-token result. */
export function isSuperadminClaim(tokenResult: { claims?: Record<string, unknown> } | null | undefined): boolean {
  return tokenResult?.claims?.superadmin === true;
}

/** Pure: merge identity + claims into one session view. */
export function toSessionUser(user: SignedInUser, tokenResult: { claims?: Record<string, unknown> } | null | undefined): SessionUser {
  return { ...user, superadmin: isSuperadminClaim(tokenResult) };
}

/**
 * Fetch the current session incl. custom claims. Returns null when signed
 * out or Firebase is unconfigured. Call again (or sign out/in) after a
 * role promotion — ID tokens refresh on re-auth, never by editing client
 * state.
 */
export async function fetchSessionUser(): Promise<SessionUser | null> {
  let auth;
  try {
    auth = await getFirebaseAuth();
  } catch {
    return null;
  }
  const { getIdTokenResult } = await import("firebase/auth");
  const current = auth.currentUser;
  if (!current) return null;
  const base: SignedInUser = {
    uid: current.uid,
    displayName: current.displayName ?? null,
    email: current.email ?? null,
    photoURL: current.photoURL ?? null,
  };
  try {
    const token = await getIdTokenResult(current);
    return toSessionUser(base, token);
  } catch {
    return { ...base, superadmin: false };
  }
}

/** Force an ID-token refresh (use after the owner promotes/revokes a role). */
export async function refreshSessionToken(): Promise<SessionUser | null> {
  let auth;
  try {
    auth = await getFirebaseAuth();
  } catch {
    return null;
  }
  const current = auth.currentUser;
  if (!current) return null;
  try {
    const { getIdTokenResult } = await import("firebase/auth");
    await current.getIdToken(true);
    const token = await getIdTokenResult(current);
    return toSessionUser(
      {
        uid: current.uid,
        displayName: current.displayName ?? null,
        email: current.email ?? null,
        photoURL: current.photoURL ?? null,
      },
      token,
    );
  } catch {
    return null;
  }
}
