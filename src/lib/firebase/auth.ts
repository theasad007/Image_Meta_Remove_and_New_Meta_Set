import type { Auth, User } from "firebase/auth";
import { getFirebaseAuth } from "./config";

/**
 * Google sign-in state machine (Phase 6).
 *
 * The Firebase SDK backend is injectable so popup-blocked / cancelled /
 * disabled-provider / offline / race behavior is unit-testable without a
 * live Google OAuth project. Production passes no backend (real SDK).
 */

export interface SignedInUser {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}

export type SignInOutcome =
  | { status: "signed-in"; user: SignedInUser }
  | { status: "cancelled" }
  | { status: "error"; code: string; message: string };

export interface AuthBackend {
  signInWithPopup: (auth: Auth, provider: unknown) => Promise<{ user: User }>;
  googleProvider: () => unknown;
}

function toSignedInUser(user: User): SignedInUser {
  return {
    uid: user.uid,
    displayName: user.displayName ?? null,
    email: user.email ?? null,
    photoURL: user.photoURL ?? null,
  };
}

function friendlyError(code: string, fallback: string): SignInOutcome {
  switch (code) {
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return { status: "cancelled" };
    case "auth/popup-blocked":
      return {
        status: "error",
        code,
        message: "The browser blocked the Google sign-in popup. Allow popups for this site and try again — your files are untouched.",
      };
    case "auth/unauthorized-domain":
      return {
        status: "error",
        code,
        message: "This site's address is not authorized for Google sign-in. The site owner must add it under Firebase Authentication → Authorized domains.",
      };
    case "auth/operation-not-allowed":
      return {
        status: "error",
        code,
        message: "Google sign-in is not enabled for this Firebase project. Enable the Google provider in the Firebase console.",
      };
    case "auth/network-request-failed":
      return {
        status: "error",
        code,
        message: "Google sign-in could not reach the network. Check your connection and try again — guest cleaning still works offline after load.",
      };
    case "auth/too-many-requests":
      return {
        status: "error",
        code,
        message: "Too many sign-in attempts. Please wait a few minutes and try again.",
      };
    case "auth/configuration-not-found":
    case "auth/invalid-api-key":
      return {
        status: "error",
        code,
        message: "Google profile features are not configured on this site. Guest inspection and cleaning are unaffected.",
      };
    default:
      return { status: "error", code, message: fallback };
  }
}

async function realBackend(): Promise<AuthBackend> {
  const { GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
  return {
    signInWithPopup: (auth, provider) => signInWithPopup(auth, provider as never) as Promise<{ user: User }>,
    googleProvider: () => new GoogleAuthProvider(),
  };
}

/**
 * Emulator test backend (NEXT_PUBLIC_FIREBASE_EMULATOR=1). The Auth
 * emulator accepts a strict-JSON fake custom token keyed by its `uid`
 * claim ("Auth Emulator only accepts strict JSON or JWTs as fake custom
 * tokens"), so the same "Continue with Google" button runs headless with
 * a neutral demo identity. Never used in production builds (flag unset).
 */
async function emulatorBackend(): Promise<AuthBackend> {
  const { signInWithCustomToken, updateEmail, updateProfile } = await import("firebase/auth");
  return {
    signInWithPopup: async (auth) => {
      const credential = await signInWithCustomToken(
        auth,
        JSON.stringify({ uid: "demo-profile-user", claims: {} }),
      );
      // Give the emulator-only identity a real email claim before the app's
      // idempotent directory bootstrap runs. Production Google users already
      // receive this from Firebase Auth; without it, the Rules-bound
      // self-registration payload is correctly rejected as an empty email.
      try {
        await updateEmail(credential.user, "demo@example.com");
      } catch {
        // Existing emulator users may already carry the same address.
      }
      // The demo identity presents like a Google account in the profile UI.
      try {
        await updateProfile(credential.user, { displayName: "Demo Profile User" });
      } catch {
        // A missing display name falls back to the honest raw identity.
      }
      return { user: credential.user as User };
    },
    googleProvider: () => ({}),
  };
}

export async function signInWithGoogle(
  backendOverride?: AuthBackend,
  authOverride?: Auth,
): Promise<SignInOutcome> {
  let auth: Auth;
  if (authOverride) {
    auth = authOverride;
  } else {
    try {
      auth = await getFirebaseAuth();
    } catch (error) {
      return {
        status: "error",
        code: "auth/configuration-not-found",
        message: error instanceof Error ? error.message : "Google profile features are not configured.",
      };
    }
  }
  let backend: AuthBackend;
  if (backendOverride) {
    backend = backendOverride;
  } else {
    try {
      const { isEmulatorRequested } = await import("./config");
      backend = isEmulatorRequested()
        ? await emulatorBackend()
        : await realBackend();
    } catch {
      return {
        status: "error",
        code: "auth/configuration-not-found",
        message: "Google profile features are not configured.",
      };
    }
  }
  try {
    const credential = await backend.signInWithPopup(auth, backend.googleProvider());
    return { status: "signed-in", user: toSignedInUser(credential.user) };
  } catch (error) {
    const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "auth/unknown";
    return friendlyError(code, error instanceof Error ? error.message.slice(0, 300) : "Google sign-in failed.");
  }
}

export async function signOutNow(): Promise<void> {
  const auth = await getFirebaseAuth();
  const { signOut } = await import("firebase/auth");
  await signOut(auth);
}

/** Subscribe to auth transitions; returns an unsubscribe function. */
export async function subscribeAuthState(
  onChange: (user: SignedInUser | null) => void,
): Promise<() => void> {
  const auth = await getFirebaseAuth();
  const { onAuthStateChanged } = await import("firebase/auth");
  return onAuthStateChanged(auth, (user) => onChange(user ? toSignedInUser(user) : null));
}
