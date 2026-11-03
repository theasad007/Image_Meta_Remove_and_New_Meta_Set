# Emulator E2E for premium flows (Phases 03–06, SOL-011)

These specs verify the premium paths against the REAL local Firebase
emulators — never stubs, never production.

## One documented command (SOL-011)

Prerequisite: Java 21+ and the seed-only admin dependency:

```bash
npm install --no-save firebase-admin   # seed script only; never bundled
```

Then run everything (starts the emulators, seeds, runs the suite, exits 0
on success):

```bash
npm run test:e2e:premium

The command checks Java, builds the static export with the emulator flag,
starts the local emulators, seeds them, and runs the suite. It exits nonzero
if setup or tests fail.
```

Equivalent to:

```bash
firebase emulators:exec --project demo --only auth,firestore \
  "node scripts/seed-emulator-premium.mjs && RUN_EMULATOR_E2E=1 npx playwright test e2e/premium-emulator.spec.ts --project=desktop"
```

The seed script (scripts/seed-emulator-premium.mjs) HARD-FAILS unless
`FIREBASE_AUTH_EMULATOR_HOST` / `FIRESTORE_EMULATOR_HOST` point at local
hosts (127.0.0.1 / localhost). It uses the supported MODULAR Admin SDK
imports. Beyond the full seed it exposes deterministic test mutations:

```bash
node scripts/seed-emulator-premium.mjs grant    # active Premium
node scripts/seed-emulator-premium.mjs revoke   # tier free
node scripts/seed-emulator-premium.mjs expire   # premium with past expiry
node scripts/seed-emulator-premium.mjs policy-premium      # shipped defaults
node scripts/seed-emulator-premium.mjs policy-open-batch   # batch features free
```

## What the suite covers (9 tests, ZERO Premium skips)

1. Sign-in happens on `/account/profile` (the homepage has no login
   control); the suite waits for the REAL authenticated badge.
2. Premium image batch with a saved project (fields + GPS) — verified
   rows, plus byte-level verification of the DOWNLOADED outputs.
3. Single-file project apply writes project GPS, verified from bytes.
4. SOL-003: MP3-only batch (2 files) — the downloaded MP3 is re-probed
   with the production parser; the encoded MPEG payload is byte-identical
   to the original.
5. SOL-003: mixed image + 2×MP3 batch — every eligible file processed,
   none skipped.
6. SOL-009: custom batch source — the one-off draft is written and
   verified from output bytes; profile/projects untouched.
7. SOL-002: revocation while the dialog is open blocks execution (fresh
   check denies); free removal keeps working.
8. SOL-002: expired entitlement shows the honest denial; re-grant
   restores access in the same page session.
9. SOL-011: policy flip (batch features → free) opens the batch WITHOUT
   any entitlement; project CRUD with atomic title uniqueness.

Mid-suite entitlement/policy mutations use the LOCAL Firestore emulator
REST API with a superadmin ID token minted from the LOCAL Auth emulator
(fake custom token). The same firestore.rules still evaluate — the
mutations satisfy the rules rather than bypassing them.

Without `RUN_EMULATOR_E2E=1` the premium specs skip explicitly — they
never fake a signed-in or premium state, and the skip is reported as a
skip (never a pass).

## Firestore rules tests

```bash
# requires JDK >= 21 (installed: Temurin 25)
JAVA_HOME=$(/usr/libexec/java_home) npm run test:rules
```

31 rules tests run against the real emulator: owner isolation, policy and
entitlement validation, project schema boundaries (SOL-004 30-keyword
proof, SOL-006 URL scheme, SOL-015 GPS pairs), and SOL-005 atomic title
uniqueness (concurrent creates, rename collisions, delete/reuse,
owner-scoped reservations).
