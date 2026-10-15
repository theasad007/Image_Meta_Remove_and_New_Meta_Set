#!/usr/bin/env node
/**
 * One-time owner bootstrap: grant the `superadmin: true` custom claim.
 *
 * LOCAL-ONLY privileged tooling. Run on the owner's machine AFTER signing
 * in once with the owner Google account in the app (so the UID exists).
 * Never commit service-account keys, never bundle firebase-admin in the
 * browser app, never auto-promote first registrants or email patterns.
 *
 * Prerequisites (free, no billing):
 *   1. `npm install -g firebase-admin` (or run with `npx -y firebase-admin`
 *      available) — the script imports it dynamically; it is NOT an app
 *      dependency and MUST NOT be added to package.json dependencies.
 *   2. A Firebase service-account key downloaded from
 *      Firebase console → Project settings → Service accounts →
 *      "Generate new private key". Save it OUTSIDE the repo, e.g.
 *      ~/.secrets/<project>-service-account.json, and NEVER commit it
 *      (see .gitignore: *service-account*.json).
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=~/.secrets/<project>-service-account.json \
 *     node scripts/bootstrap-superadmin.mjs \
 *       --project <firebase-project-id> \
 *       --uid <verified-owner-firebase-uid> \
 *       --confirm <verified-owner-firebase-uid>
 *
 * After success: the owner signs OUT and back IN (or uses "Refresh login
 * status") so the new custom claim lands in a fresh ID token. Verify the
 * Admin Dashboard link appears in the hero section. To revoke later, run
 * with --revoke (same confirmation gate).
 */

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, token, index, list) => {
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = list[index + 1];
      pairs.push([key, next && !next.startsWith("--") ? next : "true"]);
    }
    return pairs;
  }, []),
);

function fail(message) {
  console.error(`bootstrap-superadmin: ${message}`);
  process.exit(1);
}

const project = args.project ?? process.env.FIREBASE_PROJECT_ID ?? "";
const uid = args.uid ?? "";
const confirm = args.confirm ?? "";
const revoke = args.revoke === "true";
const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "";

if (!project) fail("missing --project <firebase-project-id> (or FIREBASE_PROJECT_ID).");
if (!uid) fail("missing --uid <verified-owner-firebase-uid>.");
if (!credentials) fail("GOOGLE_APPLICATION_CREDENTIALS is not set — point it at your service-account key file (kept outside the repo).");
if (uid.length > 128) fail("refusing suspicious uid (over 128 chars).");
if (confirm !== uid) {
  fail("owner confirmation mismatch: --confirm must exactly equal --uid. Re-check the UID in Firebase console → Authentication → Users, then retry deliberately.");
}

let admin;
try {
  admin = (await import("firebase-admin")).default ?? (await import("firebase-admin"));
} catch {
  fail("firebase-admin is not installed. Run `npm install -g firebase-admin` first (local tooling only — do not add it to the app).");
}

try {
  if (admin.apps.length === 0) {
    admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: project });
  }
  const auth = admin.auth();
  const user = await auth.getUser(uid);
  console.log(`Verified user: uid=${user.uid} email=${user.email ?? "(no email)"} providers=${(user.providerData ?? []).map((p) => p.providerId).join(",") || "none"}`);
  if (!user.emailVerified && (user.providerData ?? []).length === 0) {
    fail("refusing to promote an account with no provider data — sign in with Google in the app first.");
  }
  const existing = (user.customClaims ?? {}).superadmin === true;
  if (revoke) {
    await auth.setCustomUserClaims(uid, { ...(user.customClaims ?? {}), superadmin: false });
    console.log("Revoked: superadmin claim set to false.");
  } else {
    if (existing) {
      console.log("No change: this UID already carries superadmin: true.");
    } else {
      await auth.setCustomUserClaims(uid, { ...(user.customClaims ?? {}), superadmin: true });
      console.log("Granted: superadmin: true custom claim set.");
    }
  }
  const check = await auth.getUser(uid);
  console.log(`Confirmed claims now: ${JSON.stringify(check.customClaims ?? {})}`);
  console.log("Next: sign OUT and back IN in the app (or Refresh login status) so a fresh ID token carries the claim.");
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
