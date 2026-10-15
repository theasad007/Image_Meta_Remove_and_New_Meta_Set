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
  return REQUIRED_KEYS.every((key) => typeof config[key] === "string" && (config[key] as string).length > 0);
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
      const config = readFirebaseConfig();
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
  return authInstance;
}

export async function getFirebaseDb(): Promise<Firestore> {
  if (dbInstance) return dbInstance;
  const app = await loadApp();
  const { getFirestore } = await import("firebase/firestore");
  dbInstance = getFirestore(app);
  return dbInstance;
}
