import fs from "node:fs";
import path from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc, collection, query, getDocs, serverTimestamp } from "firebase/firestore";

/**
 * Firestore owner-isolation rules tests against the REAL local emulator
 * (never stubs). Run via `npm run test:rules`, which starts the emulator
 * with `firebase emulators:exec`. Under plain `npm test` (no emulator)
 * this suite skips explicitly instead of faking a pass.
 */

const HAS_EMULATOR = typeof process.env.FIRESTORE_EMULATOR_HOST === "string";
const describeEmulator = HAS_EMULATOR ? describe : describe.skip;

function validProfile(): Record<string, unknown> {
  return {
    company: "Acme Studio",
    creator: "A. Photographer",
    copyright: "© 2026 Acme",
    rightsOwner: "Acme Studio",
    website: "https://acme.example.com",
    contact: "hello@acme.example.com",
    title: "Harbor noon",
    description: "Synthetic test photo.",
    keywords: "harbor, noon",
    locationName: "Test Harbor",
    schemaVersion: 1,
  };
}

describeEmulator("firestore owner-only profile rules (emulator)", () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "phase6-rules-test",
      firestore: {
        rules: fs.readFileSync(path.join(__dirname, "..", "..", "..", "firestore.rules"), "utf8"),
      },
    });
  }, 120000);

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it("denies unauthenticated reads and writes", async () => {
    const anon = testEnv.unauthenticatedContext().firestore();
    const ref = doc(anon, "users/alice/profile/main");
    await assertFails(getDoc(ref));
    await assertFails(setDoc(ref, validProfile()));
    await assertFails(deleteDoc(ref));
  });

  it("lets user A create, read, update and delete only users/A/profile/main", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore();
    const ref = doc(alice, "users/alice/profile/main");
    const missing = await assertSucceeds(getDoc(ref));
    expect(missing.exists()).toBe(false);
    await assertSucceeds(setDoc(ref, validProfile()));
    const snap = await assertSucceeds(getDoc(ref));
    expect(snap.exists()).toBe(true);
    await assertSucceeds(setDoc(ref, { ...validProfile(), title: "Edited title" }));
    const edited = await assertSucceeds(getDoc(ref));
    expect(edited.data()?.title).toBe("Edited title");
    await assertSucceeds(deleteDoc(ref));
    const gone = await assertSucceeds(getDoc(ref));
    expect(gone.exists()).toBe(false);
  });

  it("denies cross-user access in both directions", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore();
    const bob = testEnv.authenticatedContext("bob").firestore();
    await assertFails(getDoc(doc(bob, "users/alice/profile/main")));
    await assertFails(setDoc(doc(bob, "users/alice/profile/main"), validProfile()));
    await assertFails(deleteDoc(doc(bob, "users/alice/profile/main")));
    await assertFails(getDoc(doc(alice, "users/bob/profile/main")));
    await assertFails(setDoc(doc(alice, "users/bob/profile/main"), validProfile()));
  });

  it("denies unknown paths and extra/privilege fields", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore();
    await assertFails(setDoc(doc(alice, "users/alice/profile/other"), validProfile()));
    await assertFails(setDoc(doc(alice, "users/alice/scans/s1"), { name: "x" }));
    await assertFails(setDoc(doc(alice, "users/alice/profile/main"), { ...validProfile(), isAdmin: true }));
    await assertFails(setDoc(doc(alice, "users/alice/profile/main"), { ...validProfile(), plan: "premium" }));
    await assertFails(setDoc(doc(alice, "users/alice/profile/main"), { ...validProfile(), nested: { deep: { evil: 1 } } }));
  });

  it("denies oversize payloads and wrong types", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore();
    const ref = doc(alice, "users/alice/profile/main");
    await assertFails(setDoc(ref, { ...validProfile(), title: "x".repeat(201) }));
    await assertFails(setDoc(ref, { ...validProfile(), description: "y".repeat(2001) }));
    await assertFails(setDoc(ref, { ...validProfile(), schemaVersion: "1" }));
    await assertFails(setDoc(ref, { ...validProfile(), schemaVersion: 99 }));
  });

  it("round-trips a saved profile accurately after re-login", async () => {
    const before = testEnv.authenticatedContext("carol").firestore();
    await assertSucceeds(setDoc(doc(before, "users/carol/profile/main"), validProfile()));
    // Simulate a fresh login: new context, same uid.
    const after = testEnv.authenticatedContext("carol", { email: "carol@example.com" }).firestore();
    const snap = await assertSucceeds(getDoc(doc(after, "users/carol/profile/main")));
    expect(snap.data()?.creator).toBe("A. Photographer");
    expect(snap.data()?.keywords).toBe("harbor, noon");
  });
});

function validDirectory(uid: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uid,
    email: `${uid}@example.com`,
    displayName: "Test User",
    photoURL: "",
    status: "active",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

const POLICY_PATH = "adminSettings/usagePolicy";

function validPolicy(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: "unlimited",
    inspectHourly: null,
    inspectDaily: null,
    cleanHourly: null,
    cleanDaily: null,
    updatedAt: serverTimestamp(),
    updatedBy: "owner",
    ...overrides,
  };
}

describeEmulator("firestore account directory + admin rules (emulator)", () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "phase6a-admin-test",
      firestore: {
        rules: fs.readFileSync(path.join(__dirname, "..", "..", "..", "firestore.rules"), "utf8"),
      },
    });
  }, 120000);

  afterAll(async () => {
    await testEnv.cleanup();
  });

  const superadmin = () => testEnv.authenticatedContext("owner", { email: "owner@example.com", superadmin: true }).firestore();
  const user = (uid: string) => testEnv.authenticatedContext(uid).firestore();

  it("denies unauthenticated access to directory and admin paths", async () => {
    const anon = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, "users/dave")));
    await assertFails(setDoc(doc(anon, "users/dave"), validDirectory("dave")));
    await assertFails(getDocs(query(collection(anon, "users"))));
    await assertFails(getDoc(doc(anon, POLICY_PATH)));
    await assertFails(setDoc(doc(anon, POLICY_PATH), validPolicy()));
  });

  it("lets owners register only their own active record (no roles, no bans)", async () => {
    const dave = user("dave");
    await assertSucceeds(setDoc(doc(dave, "users/dave"), validDirectory("dave")));
    await assertFails(setDoc(doc(dave, "users/erin"), validDirectory("erin")));
    await assertFails(setDoc(doc(user("erin2"), "users/erin2"), { ...validDirectory("erin2"), status: "suspended" }));
    await assertFails(setDoc(doc(user("mallory"), "users/mallory"), { ...validDirectory("mallory"), superadmin: true }));
    await assertFails(setDoc(doc(user("mallory2"), "users/mallory2"), { ...validDirectory("mallory2"), role: "admin" }));
    await assertFails(setDoc(doc(user("mallory3"), "users/mallory3"), { ...validDirectory("mallory3"), isAdmin: true }));
    await assertFails(setDoc(doc(user("mallory4"), "users/mallory4"), { ...validDirectory("mallory4"), email: "x".repeat(201) }));
  });

  it("lets owners read only their own record and never list accounts", async () => {
    const dave = user("dave2");
    await assertSucceeds(setDoc(doc(dave, "users/dave2"), validDirectory("dave2")));
    await assertSucceeds(getDoc(doc(dave, "users/dave2")));
    await assertFails(getDoc(doc(dave, "users/erin")));
    await assertFails(getDocs(query(collection(dave, "users"))));
  });

  it("lets owners update identity but never status or privilege fields", async () => {
    const frank = user("frank");
    await assertSucceeds(setDoc(doc(frank, "users/frank"), validDirectory("frank")));
    const current = (await assertSucceeds(getDoc(doc(frank, "users/frank")))).data() as Record<string, unknown>;
    await assertSucceeds(setDoc(doc(frank, "users/frank"), { ...current, displayName: "Frank New" }));
    // Self-suspension through Firestore is denied (UI also blocks it).
    await assertFails(setDoc(doc(frank, "users/frank"), { ...current, status: "suspended" }));
    await assertFails(setDoc(doc(frank, "users/frank"), { ...current, superadmin: true }));
  });

  it("lets superadmin list accounts and suspend/restore (stale-token contexts denied)", async () => {
    const admin = superadmin();
    await assertSucceeds(setDoc(doc(user("gina"), "users/gina"), validDirectory("gina")));
    const listed = await assertSucceeds(getDocs(query(collection(admin, "users"))));
    expect(listed.size).toBeGreaterThan(0);
    await assertSucceeds(getDoc(doc(admin, "users/gina")));
    // Suspend.
    const before = (await assertSucceeds(getDoc(doc(admin, "users/gina")))).data() as Record<string, unknown>;
    await assertSucceeds(setDoc(doc(admin, "users/gina"), { ...before, status: "suspended", statusReason: "spam test" }));
    const suspended = (await assertSucceeds(getDoc(doc(admin, "users/gina")))).data() as Record<string, unknown>;
    expect(suspended.status).toBe("suspended");
    // Ordinary (stale, claim-less) contexts cannot list, read others, or suspend.
    await assertFails(getDocs(query(collection(user("gina"), "users"))));
    await assertFails(getDoc(doc(user("hank"), "users/gina")));
    await assertFails(setDoc(doc(user("gina"), "users/gina"), { ...before, status: "active" }));
    // Restore.
    await assertSucceeds(setDoc(doc(admin, "users/gina"), { ...before, status: "active" }));
  });

  it("denies suspended users profile read/write without affecting others", async () => {
    const admin = superadmin();
    await assertSucceeds(setDoc(doc(user("ivan"), "users/ivan"), validDirectory("ivan")));
    await assertSucceeds(setDoc(doc(user("ivan"), "users/ivan/profile/main"), validProfile()));
    await assertSucceeds(setDoc(doc(user("judy"), "users/judy"), validDirectory("judy")));
    await assertSucceeds(setDoc(doc(user("judy"), "users/judy/profile/main"), validProfile()));
    const dirBefore = (await assertSucceeds(getDoc(doc(admin, "users/ivan")))).data() as Record<string, unknown>;
    await assertSucceeds(setDoc(doc(admin, "users/ivan"), { ...dirBefore, status: "suspended" }));
    // Suspended: profile read + write denied; cannot self-unban.
    await assertFails(getDoc(doc(user("ivan"), "users/ivan/profile/main")));
    await assertFails(setDoc(doc(user("ivan"), "users/ivan/profile/main"), validProfile()));
    await assertFails(setDoc(doc(user("ivan"), "users/ivan"), { ...dirBefore, status: "active" }));
    // Others unaffected.
    await assertSucceeds(getDoc(doc(user("judy"), "users/judy/profile/main")));
    await assertSucceeds(setDoc(doc(user("judy"), "users/judy/profile/main"), validProfile()));
    // Restore re-enables cloud features (Google login itself was never revoked).
    await assertSucceeds(setDoc(doc(admin, "users/ivan"), { ...dirBefore, status: "active" }));
    await assertSucceeds(getDoc(doc(user("ivan"), "users/ivan/profile/main")));
  });

  it("denies privilege escalation and malformed directory writes", async () => {
    const admin = superadmin();
    // Superadmin cannot be impersonated via email-shaped uid tricks: only the
    // claim authorizes admin paths.
    await assertFails(setDoc(doc(user("owner"), "users/owner"), { ...validDirectory("owner"), superadmin: true }));
    await assertFails(getDocs(query(collection(user("owner"), "users"))));
    // Superadmin status flips keep identity intact.
    await assertSucceeds(setDoc(doc(user("karl"), "users/karl"), validDirectory("karl")));
    const karlBefore = (await assertSucceeds(getDoc(doc(admin, "users/karl")))).data() as Record<string, unknown>;
    await assertFails(setDoc(doc(admin, "users/karl"), { ...karlBefore, status: "suspended", email: "changed@example.com" }));
    await assertFails(setDoc(doc(admin, "users/karl"), { ...karlBefore, status: "banned" }));
    await assertFails(setDoc(doc(admin, "users/karl"), { ...karlBefore, status: "suspended", statusReason: "x".repeat(281) }));
  });

  it("gates the usage-policy doc to superadmin with strict validation", async () => {
    const admin = superadmin();
    await assertFails(getDoc(doc(user("leo"), POLICY_PATH)));
    await assertFails(setDoc(doc(user("leo"), POLICY_PATH), validPolicy()));
    await assertSucceeds(setDoc(doc(admin, POLICY_PATH), validPolicy()));
    const read = await assertSucceeds(getDoc(doc(admin, POLICY_PATH)));
    expect(read.data()?.mode).toBe("unlimited");
    await assertSucceeds(setDoc(doc(admin, POLICY_PATH), validPolicy({ cleanDaily: 500 })));
    await assertFails(setDoc(doc(admin, POLICY_PATH), validPolicy({ mode: "capped" })));
    await assertFails(setDoc(doc(admin, POLICY_PATH), validPolicy({ cleanDaily: 1.5 })));
    await assertFails(setDoc(doc(admin, POLICY_PATH), { ...validPolicy(), enforce: true }));
  });

  it("keeps Phase 6 profile rules intact (no-account users unaffected)", async () => {
    // Accounts without a directory entry (pre-directory Auth users) keep working.
    await assertSucceeds(setDoc(doc(user("legacy"), "users/legacy/profile/main"), validProfile()));
    await assertSucceeds(getDoc(doc(user("legacy"), "users/legacy/profile/main")));
  });
});
