# 10 — Admin Setup, Permission Model & Owner Runbook (Phase 6A)

**Backend:** Firebase Authentication (Google) + Firestore Spark. No Supabase, no Cloud Functions, no billing/Blaze, no paid APIs. All image/video processing stays in the browser — Firebase receives only Google identity and explicitly user-edited profile/directory fields, never media.

## 1. Firebase console setup (owner, free Spark)

1. console.firebase.google.com → create (or select) a project on the **Spark** (free) plan. No billing upgrade is needed or used.
2. Project Overview → Add app → **Web** (`</>`), register a nickname. Copy the **web configuration** (`apiKey`, `authDomain`, `projectId`, `appId`) — these are public project identifiers, not secrets.
3. Copy `.env.local.example` → `.env.local` and fill the four `NEXT_PUBLIC_FIREBASE_*` values. Rebuild (`npm run build`) and redeploy `out/` afterwards — `NEXT_PUBLIC_*` values inline at build time and never update at runtime. `.env.local` is gitignored; never commit it.
4. Authentication → Sign-in method → enable **Google**, set the support email.
5. Authentication → Settings → **Authorized domains** → add `localhost` (local testing) plus the production Hostinger domain. New projects may not include `localhost` automatically — check.
6. Firestore Database → Create database (production mode, nearest region) → Rules tab → paste **exactly** the repo `firestore.rules` (the same file covered by `npm run test:rules`) → Publish. Committing the file does not secure anything; only publishing does.
7. Quotas (Spark): ~50k reads / ~20k writes per day, 1 GiB stored, ~10 GiB/month egress. This app reads the directory/profile once per sign-in and writes only on explicit Save/suspend actions — far below quotas. Guests never touch Firebase at all.

Never share, commit, or bundle: service-account JSON, Admin SDK keys, refresh tokens, or any billing instrument. The admin bootstrap key lives **outside** the repo (e.g. `~/.secrets/`).

## 2. Superadmin bootstrap (one-time, local-only)

Authorization uses the Auth **custom claim** `superadmin: true` — never a client-visible role flag, never an email allowlist, never a public "admin signup". There is no password backdoor.

1. Sign in **once** in the deployed (or local) app with the owner Google account, so the UID exists (find it in Firebase console → Authentication → Users).
2. Download a service-account key (Project settings → Service accounts → Generate new private key) to a path **outside** the repo. `npm install -g firebase-admin` (local tooling only — it must never enter `package.json` or the browser bundle).
3. Run, with an explicit confirmation gate (`--confirm` must equal `--uid`):
   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=~/.secrets/<project>-service-account.json \
     node scripts/bootstrap-superadmin.mjs \
       --project <firebase-project-id> \
       --uid <verified-owner-firebase-uid> \
       --confirm <verified-owner-firebase-uid>
   ```
   The script verifies the user exists (and has provider data — no promotion of empty accounts), sets the claim, and prints the confirmed claims. Revoke later with the same command plus `--revoke`.
4. Sign **out and back in** in the app (or use “Refresh login status”) so a fresh ID token carries the claim. The hero CTA and account panel then show the **Admin Dashboard** link.
5. Never auto-promote the first registrant or anyone matching an email pattern. To add a second admin, repeat steps 1–4 for their verified UID.

## 3. Permission model (enforced by `firestore.rules`, mirrored in UI)

| Actor | `users/{uid}` (own) | `users/*` list / others | `users/{uid}` status | `profile/main` (own) | `adminSettings/*` |
|---|---|---|---|---|---|
| Signed out | none | none | none | none (guest cleaning unaffected) | none |
| Ordinary user | create own (active only) · read own · update identity only | denied (list + reads) | cannot change (stays active) | read/write while active; **denied while suspended** | denied |
| Suspended user | read own only (no writes) | denied | cannot self-restore | **denied** (saved profiles unavailable) | denied |
| Superadmin (claim) | list + read all | allowed | suspend/restore any except **self** (UI guard) | own profile as usual | read/write validated |

Privilege-escalation attempts (`superadmin`/`role`/`isAdmin` fields, cross-user writes, unknown paths, oversize/wrong-type payloads) are denied and covered by emulator tests. There is **no self-demotion lockout**: privileges live in Auth custom claims, not in Firestore, so no document edit can grant or remove them; the UI additionally refuses self-suspension.

## 4. Suspension scope (stated honestly in UI and here)

Suspending flips a Firestore `status` that gates **signed-in cloud features only** (saved-profile read/write, admin reads). It does **not** revoke Google login, **does not** disable the Firebase Auth user, and **does not** affect anonymous browser-only inspection/cleaning/ZIP/reports. Genuine Auth disables (`auth.updateUser({disabled:true})` / `deleteUser`) require privileged Admin SDK operations — run them owner-side (extend the bootstrap script pattern), never from the browser. Do not describe a Firestore suspension as a global ban.

## 5. Usage policy (honest by design)

Admin Settings → Usage Policy shows **Unlimited (default; no caps enabled)**. Optional hourly/daily inspect/clean values may be recorded for future planning but are visibly badged **NOT enforced** — a static client cannot meter local file operations (scripts editable, storage clearable, guest/offline operation). No per-file counters are written to Firebase, no user activity is logged, and no caps activate in this milestone. Enabling real limits needs a separate trusted-metering decision (privacy disclosure, cost, guest-policy impact) — see `02`/`07`.

## 6. Backfill for pre-directory accounts

Accounts that signed in before the directory existed have Auth identities but no `users/{uid}` document. They keep working (rules treat missing directories as active) and self-register on next sign-in automatically. Owner alternative: with the service-account environment above, create the minimal active record for the verified UID (same field ceilings as the rules). Never invent UIDs or copy other users' data.

## 7. Live verification checklist (owner)

- Sign in on the Hostinger URL (popup allowed) → hero shows Account entry; owner additionally sees Admin Dashboard.
- Save a profile (include Unicode/Bangla + a `=cmd` formula test) → reload → values round-trip; CSV shows guarded cells, exact UTF-8 preserved.
- Refresh login status after promotion → claim appears without full re-login; stale (pre-promotion) sessions stay denied on admin paths.
- As owner: suspend a test account → its profile save/load fails with the restriction message while guest cleaning on the same browser keeps working → restore → cloud features work again.
- Unauthorized-domain/popup-blocked/closed paths show truthful errors with the queue intact (see `04` E2E).
- Confirm Firebase console shows only `users/{uid}` directory fields + `users/{uid}/profile/main` profile fields — no media, filenames, scans, or history anywhere.
