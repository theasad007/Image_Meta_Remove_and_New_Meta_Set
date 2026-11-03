/**
 * Emulator-only seed for premium-path E2E (SOL-011) — HARD-LOCAL SAFETY.
 *
 * Run INSIDE `firebase emulators:exec --project demo --only auth,firestore`
 * (or with both emulators already listening on 127.0.0.1:9099 / 8080):
 *
 *   node scripts/seed-emulator-premium.mjs              # full seed
 *   node scripts/seed-emulator-premium.mjs grant        # (re)grant active Premium
 *   node scripts/seed-emulator-premium.mjs revoke       # tier free (revoke)
 *   node scripts/seed-emulator-premium.mjs expire       # premium with a past expiry
 *   node scripts/seed-emulator-premium.mjs policy-premium   # shipped defaults
 *   node scripts/seed-emulator-premium.mjs policy-open-batch # batch features free
 *
 * SAFETY (SOL-011): the script HARD-FAILS unless FIREBASE_AUTH_EMULATOR_HOST
 * and FIRESTORE_EMULATOR_HOST point at LOCAL hosts (127.0.0.1 / localhost).
 * Production Firebase is unreachable from here by construction. Uses the
 * SUPPORTED modular firebase-admin imports (firebase-admin/app +
 * firebase-admin/firestore); admin SDK is never bundled into the app.
 */

const AUTH_EMULATOR = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const FIRESTORE_EMULATOR = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const isLocal = (hostPort) => {
  const host = String(hostPort).split(":")[0] ?? "";
  return LOCAL_HOSTS.has(host);
};
if (!isLocal(AUTH_EMULATOR) || !isLocal(FIRESTORE_EMULATOR)) {
  console.error(
    `REFUSING TO RUN: emulator hosts must be local.\n` +
    `  FIREBASE_AUTH_EMULATOR_HOST=${AUTH_EMULATOR}\n` +
    `  FIRESTORE_EMULATOR_HOST=${FIRESTORE_EMULATOR}\n` +
    `This seed intentionally cannot address a non-local (e.g. production) Firebase.`,
  );
  process.exit(1);
}

process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_EMULATOR;
process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_EMULATOR;

let adminApp;
let adminFirestore;
let adminFieldValue;
try {
  // SOL-011: supported MODULAR Admin SDK imports (not the legacy default bundle).
  const { initializeApp } = await import("firebase-admin/app");
  const firestoreAdmin = await import("firebase-admin/firestore");
  adminApp = initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? "demo" });
  adminFirestore = firestoreAdmin.getFirestore(adminApp);
  adminFieldValue = firestoreAdmin.FieldValue;
} catch {
  console.error(
    "firebase-admin is not installed on this machine. Install it locally (it is intentionally NOT in package.json) and re-run:\n" +
    "  npm install --no-save firebase-admin\n" +
    "This script only talks to the local emulators.",
  );
  process.exit(1);
}

const db = adminFirestore;
const serverTimestamp = () => adminFieldValue.serverTimestamp();

const DEMO_UID = "demo-profile-user";

const SHIPPED_DEFAULT_POLICY = {
  schemaVersion: 1,
  updatedAt: serverTimestamp(),
  updatedBy: "emulator-seed",
  features: {
    single_metadata_clean: "free",
    single_ai_metadata_clean: "free",
    bulk_metadata_clean: "free",
    bulk_ai_metadata_clean: "free",
    single_custom_rewrite: "free",
    batch_metadata_rewrite: "premium",
    batch_gps_write: "premium",
    multiple_named_projects: "premium",
    saved_project_apply: "premium",
  },
};

const OPEN_BATCH_POLICY = {
  ...SHIPPED_DEFAULT_POLICY,
  updatedBy: "emulator-seed-policy-open",
  features: {
    ...SHIPPED_DEFAULT_POLICY.features,
    batch_metadata_rewrite: "free",
    batch_gps_write: "free",
    multiple_named_projects: "free",
    saved_project_apply: "free",
  },
};

const DEMO_PROJECT = {
  projectTitle: "Demo Client Campaign",
  clientName: "Demo Client",
  companyPublisher: "Demo Publishing",
  creatorAuthor: "Demo Creator",
  copyrightNotice: "© 2026 Demo",
  rightsOwner: "Demo Studio",
  websiteUrl: "https://demo.example.com",
  contactInformation: "studio@demo.example",
  imageTitle: "Demo Image Title",
  imageDescription: "A demo project preset created by the emulator seed.",
  // SOL-004: keywords are stored as ONE packed string (items joined with
  // \u0001) — same shape the app writes (see lib/firebase/projects.ts).
  keywords: "demo\u0001emulator",
  locationName: "Demo Harbor",
  latitude: 51.5007,
  longitude: -0.1246,
  altitudeMeters: 35,
  schemaVersion: 1,
};

async function grant(expiresAt = null) {
  await db.doc(`users/${DEMO_UID}/entitlement/main`).set({
    tier: "premium",
    status: "active",
    expiresAt,
    assignedBy: "emulator-seed",
    updatedAt: serverTimestamp(),
  });
  console.log(`✓ Premium entitlement ${expiresAt ? "(expires " + expiresAt.toISOString() + ")" : "(active, no expiry)"} for ${DEMO_UID}`);
}

async function revoke() {
  await db.doc(`users/${DEMO_UID}/entitlement/main`).set({
    tier: "free",
    status: "active",
    expiresAt: null,
    assignedBy: "emulator-seed-revoke",
    updatedAt: serverTimestamp(),
  });
  console.log(`✓ Premium revoked (tier free) for ${DEMO_UID}`);
}

async function expire() {
  await grant(new Date(Date.now() - 86_400_000));
}

async function seed() {
  // The local superadmin token used by the E2E suite is also subject to the
  // production rule contract: custom claim + active directory record.
  await db.doc("users/owner").set({
    uid: "owner",
    email: "owner@example.com",
    displayName: "Emulator Owner",
    photoURL: "",
    status: "active",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await grant();
  await db.doc("adminSettings/featurePolicy").set(SHIPPED_DEFAULT_POLICY);
  console.log("✓ Shipped-default feature policy stored");
  await db.doc(`users/${DEMO_UID}`).set({
    uid: DEMO_UID,
    email: "demo@example.com",
    displayName: "Demo Profile User",
    photoURL: "",
    status: "active",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await db.doc(`users/${DEMO_UID}/profile/main`).set({
    company: "Demo Studio",
    creator: "Demo Creator",
    copyright: "© 2026 Demo Studio",
    rightsOwner: "Demo Studio",
    website: "https://demo.example.com",
    contact: "studio@demo.example",
    title: "Demo Profile Title",
    description: "Demo profile description from the emulator seed.",
    keywords: "demo, profile",
    locationName: "Demo Harbor",
    schemaVersion: 1,
    updatedAt: serverTimestamp(),
  });
  await db.doc(`users/${DEMO_UID}/projects/demo-project-1`).set({
    ...DEMO_PROJECT,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  console.log("✓ Demo directory record, saved profile and project stored");
  console.log("\nEmulator seed complete. Premium-path E2E can now run against the emulators.");
}

const command = process.argv[2] ?? "seed";
switch (command) {
  case "seed": await seed(); break;
  case "grant": await grant(); break;
  case "revoke": await revoke(); break;
  case "expire": await expire(); break;
  case "policy-premium": await db.doc("adminSettings/featurePolicy").set(SHIPPED_DEFAULT_POLICY); console.log("✓ policy reset to shipped defaults (batch features premium)"); break;
  case "policy-open-batch": await db.doc("adminSettings/featurePolicy").set(OPEN_BATCH_POLICY); console.log("✓ policy opened: batch/gps/projects/apply free"); break;
  default:
    console.error(`Unknown command: ${command}. Use seed | grant | revoke | expire | policy-premium | policy-open-batch.`);
    process.exit(1);
}
