/**
 * Firebase static-client configuration (Phase 6).
 *
 * Browser-only: `firebase/app`, `firebase/auth` and `firebase/firestore`
 * are loaded lazily on first use so guests never pay for them. No Admin
 * SDK, no Cloud Functions, no Storage, no API routes. `NEXT_PUBLIC_*`
 * values are inlined at `next build` time — set `.env.local` (see
 * `.env.local.example`) and rebuild. Missing config disables only the
 * signed-in profile/rewrite surfaces; every guest flow keeps working.
 */

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

const REQUIRED_KEYS = ["apiKey", "authDomain", "projectId", "appId"] as const;

export function readFirebaseConfig(): Partial<FirebaseWebConfig> {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
  };
}

/** True only when every required public identifier is present. */
export function isFirebaseConfigured(config: Partial<FirebaseWebConfig> = readFirebaseConfig()): boolean {
  // The Auth/Firestore EMULATOR is an explicitly requested test seam
  // (NEXT_PUBLIC_FIREBASE_EMULATOR=1); it makes the signed-in surfaces
  // usable against local emulators without any production credentials.
  if (isEmulatorRequested()) return true;
  return REQUIRED_KEYS.every((key) => typeof config[key] === "string" && (config[key] as string).length > 0);
}

/**
 * Set NEXT_PUBLIC_FIREBASE_EMULATOR=1 to test profiles against local
 * Auth (9099) and Firestore (8080) emulators. Never set in production.
 *
 * Isolation is layered so the production site can NEVER reach an
 * emulator: (1) the build flag must be inlined as "1", (2) the browser
 * env shim therefore lacks the key on production builds, and (3) even a
 * misbuilt/flagged artifact is refused on any non-local hostname —
 * "demo" would equally fail Firebase config and rules, but this closes
 * the loop structurally.
 */
const EMULATOR_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
export function isEmulatorRequested(): boolean {
  return process.env.NEXT_PUBLIC_FIREBASE_EMULATOR === "1"
    && typeof location !== "undefined"
    && EMULATOR_HOSTS.has(location.hostname);
}

/** Demo web config used only in emulator test mode. */
export function emulatorDemoConfig(): FirebaseWebConfig {
  return {
    apiKey: "demo",
    authDomain: "demo.firebaseapp.com",
    projectId: "demo",
    appId: "1:000000000000:web:demodemo",
  };
}

type FirebaseApp = import("firebase/app").FirebaseApp;
type Auth = import("firebase/auth").Auth;
type Firestore = import("firebase/firestore").Firestore;

let appPromise: Promise<FirebaseApp> | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;

function loadApp(): Promise<FirebaseApp> {
  if (!appPromise) {
    appPromise = (async () => {
      // Emulator mode always uses the demo web config so every SDK call
      // stays on the local emulators (project "demo") and never touches
      // the configured production project, even when credentials exist.
      const config = isEmulatorRequested()
        ? { ...emulatorDemoConfig(), ...readFirebaseConfig(), projectId: "demo" }
        : readFirebaseConfig();
      if (!isFirebaseConfigured(config)) {
        throw new Error(
          "Google profile features are not configured. Add your Firebase web settings to .env.local (see .env.local.example) and rebuild.",
        );
      }
      const { initializeApp, getApps } = await import("firebase/app");
      const existing = getApps();
      if (existing.length > 0 && existing[0]) return existing[0];
      return initializeApp(config as FirebaseWebConfig);
    })();
  }
  return appPromise;
}

async function connectEmulatorsOnce(): Promise<void> {
  if (!isEmulatorRequested()) return;
  // Instantiating auth/db now performs the emulator connection itself.
  await Promise.all([getFirebaseAuth(), getFirebaseDb()]);
}

/** Test hook: forget cached instances (sign-out races, account switching). */
export function resetFirebaseInstancesForTests(): void {
  appPromise = null;
  authInstance = null;
  dbInstance = null;
}

export async function getFirebaseAuth(): Promise<Auth> {
  if (authInstance) return authInstance;
  const app = await loadApp();
  const { getAuth } = await import("firebase/auth");
  authInstance = getAuth(app);
  if (isEmulatorRequested()) {
    // Test seam only: route the Auth SDK to the local emulator so the
    // real Google endpoint is never contacted during automated checks.
    const { connectAuthEmulator } = await import("firebase/auth");
    connectAuthEmulator(authInstance, "http://127.0.0.1:9099", { disableWarnings: true });
  }
  return authInstance;
}

export async function getFirebaseDb(): Promise<Firestore> {
  if (dbInstance) return dbInstance;
  const app = await loadApp();
  const { getFirestore } = await import("firebase/firestore");
  dbInstance = getFirestore(app);
  if (isEmulatorRequested()) {
    // Test seam only: Firestore SDK talks to the local emulator (which
    // still enforces firestore.rules), never to the real project.
    const { connectFirestoreEmulator } = await import("firebase/firestore");
    connectFirestoreEmulator(dbInstance, "127.0.0.1", 8080);
  }
  return dbInstance;
}

export async function getFirebaseInstancesForEmulator(): Promise<{ auth: Auth; db: Firestore }> {
  const auth = await getFirebaseAuth();
  const db = await getFirebaseDb();
  await connectEmulatorsOnce();
  return { auth, db };
}
