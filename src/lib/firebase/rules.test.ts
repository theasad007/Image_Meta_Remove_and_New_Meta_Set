import fs from "node:fs";
import path from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc, collection, query, getDocs, serverTimestamp, runTransaction, writeBatch } from "firebase/firestore";

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
    updatedAt: serverTimestamp(),
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
    const owner = testEnv.authenticatedContext("owner", { email: "owner@example.com" }).firestore();
    const ownerRef = doc(owner, "users/owner");
    if (!(await getDoc(ownerRef)).exists()) await setDoc(ownerRef, validDirectory("owner"));
  }, 120000);

  afterAll(async () => {
    await testEnv.cleanup();
  });

  const superadmin = () => testEnv.authenticatedContext("owner", { email: "owner@example.com", superadmin: true }).firestore();
  const user = (uid: string) => testEnv.authenticatedContext(uid, { email: `${uid}@example.com` }).firestore();

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

  it("keeps Auth-bound identity immutable and never allows status or privilege edits", async () => {
    const frank = user("frank");
    await assertSucceeds(setDoc(doc(frank, "users/frank"), validDirectory("frank")));
    const current = (await assertSucceeds(getDoc(doc(frank, "users/frank")))).data() as Record<string, unknown>;
    await assertFails(setDoc(doc(frank, "users/frank"), { ...current, displayName: "Frank New", updatedAt: serverTimestamp() }));
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
    await assertSucceeds(setDoc(doc(admin, "users/gina"), { ...before, status: "suspended", statusReason: "spam test", updatedAt: serverTimestamp() }));
    const suspended = (await assertSucceeds(getDoc(doc(admin, "users/gina")))).data() as Record<string, unknown>;
    expect(suspended.status).toBe("suspended");
    // Ordinary (stale, claim-less) contexts cannot list, read others, or suspend.
    await assertFails(getDocs(query(collection(user("gina"), "users"))));
    await assertFails(getDoc(doc(user("hank"), "users/gina")));
    await assertFails(setDoc(doc(user("gina"), "users/gina"), { ...before, status: "active" }));
    // Restore.
    await assertSucceeds(setDoc(doc(admin, "users/gina"), { ...before, status: "active", updatedAt: serverTimestamp() }));
  });

  it("denies suspended users profile read/write without affecting others", async () => {
    const admin = superadmin();
    await assertSucceeds(setDoc(doc(user("ivan"), "users/ivan"), validDirectory("ivan")));
    await assertSucceeds(setDoc(doc(user("ivan"), "users/ivan/profile/main"), validProfile()));
    await assertSucceeds(setDoc(doc(user("judy"), "users/judy"), validDirectory("judy")));
    await assertSucceeds(setDoc(doc(user("judy"), "users/judy/profile/main"), validProfile()));
    const dirBefore = (await assertSucceeds(getDoc(doc(admin, "users/ivan")))).data() as Record<string, unknown>;
    await assertSucceeds(setDoc(doc(admin, "users/ivan"), { ...dirBefore, status: "suspended", updatedAt: serverTimestamp() }));
    // Suspended: profile read + write denied; cannot self-unban.
    await assertFails(getDoc(doc(user("ivan"), "users/ivan/profile/main")));
    await assertFails(setDoc(doc(user("ivan"), "users/ivan/profile/main"), validProfile()));
    await assertFails(setDoc(doc(user("ivan"), "users/ivan"), { ...dirBefore, status: "active" }));
    // Others unaffected.
    await assertSucceeds(getDoc(doc(user("judy"), "users/judy/profile/main")));
    await assertSucceeds(setDoc(doc(user("judy"), "users/judy/profile/main"), validProfile()));
    // Restore re-enables cloud features (Google login itself was never revoked).
    await assertSucceeds(setDoc(doc(admin, "users/ivan"), { ...dirBefore, status: "active", updatedAt: serverTimestamp() }));
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

  it("revokes every admin operation when the superadmin directory is suspended", async () => {
    const admin = superadmin();
    await assertSucceeds(setDoc(doc(admin, POLICY_PATH), validPolicy()));
    await assertSucceeds(setDoc(doc(admin, "users/target/entitlement/main"), {
      tier: "premium", status: "active", expiresAt: null, assignedBy: "owner", updatedAt: serverTimestamp(),
    }));

    // A separate active superadmin performs the suspension; the suspended
    // token itself must not be able to restore or continue admin access.
    await assertSucceeds(setDoc(doc(user("root"), "users/root"), validDirectory("root")));
    const rootAdmin = testEnv.authenticatedContext("root", { email: "root@example.com", superadmin: true }).firestore();
    const ownerBefore = (await assertSucceeds(getDoc(doc(rootAdmin, "users/owner")))).data() as Record<string, unknown>;
    await assertSucceeds(setDoc(doc(rootAdmin, "users/owner"), { ...ownerBefore, status: "suspended", updatedAt: serverTimestamp() }));

    const suspendedAdmin = superadmin();
    await assertFails(getDocs(query(collection(suspendedAdmin, "users"))));
    await assertFails(getDoc(doc(suspendedAdmin, POLICY_PATH)));
    await assertFails(setDoc(doc(suspendedAdmin, POLICY_PATH), validPolicy()));
    await assertFails(getDoc(doc(suspendedAdmin, "users/target/entitlement/main")));
    await assertFails(setDoc(doc(suspendedAdmin, "adminSettings/featurePolicy"), {
      schemaVersion: 1, updatedAt: serverTimestamp(), updatedBy: "owner", features: {
        single_metadata_clean: "free", single_ai_metadata_clean: "free", bulk_metadata_clean: "free",
        bulk_ai_metadata_clean: "free", single_custom_rewrite: "free", batch_metadata_rewrite: "premium",
        batch_gps_write: "premium", multiple_named_projects: "premium", saved_project_apply: "premium",
      },
    }));
    // Owner access to the directory document is not admin privilege; status
    // mutation itself is blocked, preventing self-reactivation.
    await assertSucceeds(getDoc(doc(suspendedAdmin, "users/owner")));
    await assertFails(setDoc(doc(suspendedAdmin, "users/owner"), { ...ownerBefore, status: "active", updatedAt: serverTimestamp() }));

    // A custom claim without a required directory is also fail-closed.
    const missingDirectoryAdmin = testEnv.authenticatedContext("missing-admin", { email: "missing-admin@example.com", superadmin: true }).firestore();
    await assertFails(getDocs(query(collection(missingDirectoryAdmin, "users"))));
    await assertFails(getDoc(doc(missingDirectoryAdmin, POLICY_PATH)));

    const suspended = (await assertSucceeds(getDoc(doc(rootAdmin, "users/owner")))).data() as Record<string, unknown>;
    await assertSucceeds(setDoc(doc(rootAdmin, "users/owner"), { ...suspended, status: "active", updatedAt: serverTimestamp() }));
  });

  it("binds directory email to the signed Auth identity and rejects forged audit actors", async () => {
    await assertFails(setDoc(doc(user("identity"), "users/identity"), {
      ...validDirectory("identity"), email: "attacker@example.com",
    }));
    await assertSucceeds(setDoc(doc(user("identity"), "users/identity"), validDirectory("identity")));
    const admin = superadmin();
    await assertFails(setDoc(doc(admin, POLICY_PATH), validPolicy({ updatedBy: "different-admin" })));
    await assertFails(setDoc(doc(admin, POLICY_PATH), validPolicy({ updatedAt: new Date(0) })));
  });

  it("keeps Phase 6 profile rules intact (no-account users unaffected)", async () => {
    // Accounts without a directory entry (pre-directory Auth users) keep working.
    await assertSucceeds(setDoc(doc(user("legacy"), "users/legacy/profile/main"), validProfile()));
    await assertSucceeds(getDoc(doc(user("legacy"), "users/legacy/profile/main")));
  });
});

describeEmulator("feature policy + entitlement rules (emulator, phases 02/03)", () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "phase6-rules-test",
      firestore: {
        rules: fs.readFileSync(path.join(__dirname, "..", "..", "..", "firestore.rules"), "utf8"),
      },
    });
    const owner = testEnv.authenticatedContext("owner", { email: "owner@example.com" }).firestore();
    const ownerRef = doc(owner, "users/owner");
    if (!(await getDoc(ownerRef)).exists()) await setDoc(ownerRef, validDirectory("owner"));
  }, 120000);

  afterAll(async () => {
    await testEnv.cleanup();
  });

  const superadmin = () => testEnv.authenticatedContext("owner", { email: "owner@example.com", superadmin: true }).firestore();
  const plain = (uid: string) => testEnv.authenticatedContext(uid, { email: `${uid}@example.com` }).firestore();
  const anon = () => testEnv.unauthenticatedContext().firestore();

  const defaultFeatures = () => ({
    single_metadata_clean: "free",
    single_ai_metadata_clean: "free",
    bulk_metadata_clean: "free",
    bulk_ai_metadata_clean: "free",
    single_custom_rewrite: "free",
    batch_metadata_rewrite: "premium",
    batch_gps_write: "premium",
    multiple_named_projects: "premium",
    saved_project_apply: "premium",
  });

  const validPolicy = (overrides: Record<string, unknown> = {}) => ({
    schemaVersion: 1,
    updatedAt: serverTimestamp(),
    updatedBy: "owner",
    features: { ...defaultFeatures(), ...overrides },
  });

  const POLICY_PATH = "adminSettings/featurePolicy";

  it("lets ANYONE (even anonymous) read the sanitized policy document", async () => {
    await assertSucceeds(setDoc(doc(superadmin(), POLICY_PATH), validPolicy()));
    const read = await assertSucceeds(getDoc(doc(anon(), POLICY_PATH)));
    expect(read.data()?.features).toMatchObject(defaultFeatures());
    await assertSucceeds(getDoc(doc(plain("leo"), POLICY_PATH)));
  });

  it("denies policy writes to everyone except the superadmin custom claim", async () => {
    await assertFails(setDoc(doc(anon(), POLICY_PATH), validPolicy()));
    await assertFails(setDoc(doc(plain("leo"), POLICY_PATH), validPolicy()));
    await assertSucceeds(setDoc(doc(superadmin(), POLICY_PATH), validPolicy({ bulk_metadata_clean: "premium" })));
  });

  it("rejects malformed policies: unknown keys, bad values, free-contract flips", async () => {
    await assertFails(setDoc(doc(superadmin(), POLICY_PATH), { ...validPolicy(), extra: true }));
    await assertFails(setDoc(doc(superadmin(), POLICY_PATH), validPolicy({ no_such_feature: "free" })));
    await assertFails(setDoc(doc(superadmin(), POLICY_PATH), validPolicy({ bulk_metadata_clean: "unlimited" })));
    // Free-by-contract single-file operations can never become premium.
    await assertFails(setDoc(doc(superadmin(), POLICY_PATH), validPolicy({ single_metadata_clean: "premium" })));
    await assertFails(setDoc(doc(superadmin(), POLICY_PATH), validPolicy({ single_custom_rewrite: "premium" })));
    await assertFails(setDoc(doc(superadmin(), POLICY_PATH), validPolicy({ schemaVersion: 2 })));
    await assertFails(setDoc(doc(superadmin(), POLICY_PATH), { ...validPolicy(), updatedBy: "" }));
    // Missing feature keys are rejected (the map is complete by contract).
    const incomplete = validPolicy();
    delete (incomplete.features as Record<string, unknown>).batch_gps_write;
    await assertFails(setDoc(doc(superadmin(), POLICY_PATH), incomplete));
  });

  it("entitlements: owner can read own tier, others cannot, only superadmin writes", async () => {
    const entitlement = {
      tier: "premium",
      status: "active",
      expiresAt: null,
      assignedBy: "owner",
      updatedAt: serverTimestamp(),
    };
    await assertFails(setDoc(doc(plain("pam"), "users/pam/entitlement/main"), entitlement));
    await assertFails(setDoc(doc(anon(), "users/pam/entitlement/main"), entitlement));
    await assertSucceeds(setDoc(doc(superadmin(), "users/pam/entitlement/main"), entitlement));
    await assertSucceeds(getDoc(doc(plain("pam"), "users/pam/entitlement/main")));
    await assertFails(getDoc(doc(plain("mallory"), "users/pam/entitlement/main")));
    await assertFails(setDoc(doc(plain("pam"), "users/pam/entitlement/main"), { ...entitlement, tier: "free" }));
  });

  it("entitlement validation: unknown fields, bad tiers, missing assignedBy rejected", async () => {
    const admin = superadmin();
    const base = { tier: "premium", status: "active", expiresAt: null, assignedBy: "owner", updatedAt: serverTimestamp() };
    await assertFails(setDoc(doc(admin, "users/pat/entitlement/main"), { ...base, plan: "gold" }));
    await assertFails(setDoc(doc(admin, "users/pat/entitlement/main"), { ...base, tier: "gold" }));
    await assertFails(setDoc(doc(admin, "users/pat/entitlement/main"), { ...base, assignedBy: "" }));
    await assertFails(setDoc(doc(admin, "users/pat/entitlement/main"), { ...base, reason: "x".repeat(281) }));
    await assertFails(setDoc(doc(admin, "users/pat/entitlement/main"), { ...base, expiresAt: "tomorrow" }));
    await assertFails(setDoc(doc(admin, "users/pat/entitlement/main"), { ...base, assignedBy: "different-admin" }));
    await assertFails(setDoc(doc(admin, "users/pat/entitlement/main"), { ...base, updatedAt: new Date(0) }));
    await assertSucceeds(setDoc(doc(admin, "users/pat/entitlement/main"), base));
  });
});

describeEmulator("premium project rules (emulator, phase 04)", () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "phase6-rules-test",
      firestore: {
        rules: fs.readFileSync(path.join(__dirname, "..", "..", "..", "firestore.rules"), "utf8"),
      },
    });
    const owner = testEnv.authenticatedContext("owner", { email: "owner@example.com" }).firestore();
    const ownerRef = doc(owner, "users/owner");
    if (!(await getDoc(ownerRef)).exists()) await setDoc(ownerRef, validDirectory("owner"));
  }, 120000);

  afterAll(async () => {
    await testEnv.cleanup();
  });

  const superadmin = () => testEnv.authenticatedContext("owner", { email: "owner@example.com", superadmin: true }).firestore();
  const plain = (uid: string) => testEnv.authenticatedContext(uid, { email: `${uid}@example.com` }).firestore();
  const anon = () => testEnv.unauthenticatedContext().firestore();

  const grantPremium = async (uid: string, expiresAt: Date | null = null) => {
    await setDoc(doc(superadmin(), `users/${uid}/entitlement/main`), {
      tier: "premium",
      status: "active",
      expiresAt,
      assignedBy: "owner",
      updatedAt: serverTimestamp(),
    });
  };

  const titleKeyOf = (title: string) => Array.from(new TextEncoder().encode(title.trim().replace(/\s+/g, " ").toLowerCase()), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const validProject = (overrides: Record<string, unknown> = {}) => ({
    projectTitle: "Client Spring Campaign",
    clientName: "Acme",
    companyPublisher: "Acme Publishing",
    creatorAuthor: "A. Photographer",
    copyrightNotice: "© 2026 Acme",
    rightsOwner: "Acme Studio",
    websiteUrl: "https://acme.example.com",
    contactInformation: "hello@acme.example.com",
    imageTitle: "Harbor noon",
    imageDescription: "Campaign hero shot.",
    // SOL-004: keywords are stored as ONE packed string (items joined
    // with \u0001) — mirrors the approved profile schema and keeps the
    // rules inside their evaluation budget.
    keywords: "harbor\u0001noon",
    locationName: "Test Harbor",
    latitude: 51.5007,
    longitude: -0.1246,
    altitudeMeters: 35,
    schemaVersion: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  });
  const createProjectAndReservation = async (uid: string, projectId: string, project = validProject()) => {
    const projectData = project as Record<string, unknown>;
    const key = typeof projectData.titleKey === "string" ? projectData.titleKey : titleKeyOf(String(projectData.projectTitle));
    const db = plain(uid);
    await runTransaction(db, async (transaction) => {
      const reservation = doc(db, `users/${uid}/projectTitles/${key}`);
      const existing = await transaction.get(reservation);
      if (existing.exists()) throw new Error("TITLE_TAKEN");
      transaction.set(doc(db, `users/${uid}/projects/${projectId}`), { ...project, titleKey: key });
      transaction.set(reservation, { projectId, schemaVersion: 1 });
    });
  };

  it("denies project access to anonymous users and other users", async () => {
    await assertFails(setDoc(doc(anon(), "users/pam/projects/p1"), validProject()));
    await grantPremium("pam");
    await assertSucceeds(createProjectAndReservation("pam", "p1"));
    await assertFails(getDoc(doc(plain("mallory"), "users/pam/projects/p1")));
    await assertFails(setDoc(doc(plain("mallory"), "users/pam/projects/p1"), validProject()));
  });

  it("requires Premium (or a policy override) for writes; reads survive expiry", async () => {
    // Free user (no entitlement): create denied, read allowed (empty).
    await assertSucceeds(getDoc(doc(plain("carl"), "users/carl/projects/none")));
    await assertFails(setDoc(doc(plain("carl"), "users/carl/projects/p1"), validProject()));
    // Premium user: create succeeds.
    await grantPremium("carl");
    await assertSucceeds(createProjectAndReservation("carl", "p1"));
    // Expired premium: writes denied, existing data still readable.
    await setDoc(doc(superadmin(), "users/carl/entitlement/main"), {
      tier: "premium",
      status: "active",
      expiresAt: new Date(Date.now() - 86_400_000),
      assignedBy: "owner",
      updatedAt: serverTimestamp(),
    });
    await assertFails(setDoc(doc(plain("carl"), "users/carl/projects/p2"), validProject()));
    await assertSucceeds(getDoc(doc(plain("carl"), "users/carl/projects/p1")));
    const carlDb = plain("carl");
    const deleteBatch = writeBatch(carlDb);
    deleteBatch.delete(doc(carlDb, "users/carl/projects/p1"));
    deleteBatch.delete(doc(carlDb, `users/carl/projectTitles/${titleKeyOf("Client Spring Campaign")}`));
    await assertSucceeds(deleteBatch.commit());
  });

  it("policy override multiple_named_projects=free opens writes without entitlement", async () => {
    await setDoc(doc(superadmin(), "adminSettings/featurePolicy"), {
      schemaVersion: 1,
      updatedAt: serverTimestamp(),
      updatedBy: "owner",
      features: {
        single_metadata_clean: "free",
        single_ai_metadata_clean: "free",
        bulk_metadata_clean: "free",
        bulk_ai_metadata_clean: "free",
        single_custom_rewrite: "free",
        batch_metadata_rewrite: "premium",
        batch_gps_write: "premium",
        multiple_named_projects: "free",
        saved_project_apply: "premium",
      },
    });
    await assertSucceeds(createProjectAndReservation("dana", "p1"));
    // Restore premium default.
    await setDoc(doc(superadmin(), "adminSettings/featurePolicy"), {
      schemaVersion: 1,
      updatedAt: serverTimestamp(),
      updatedBy: "owner",
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
    });
    await assertFails(setDoc(doc(plain("dana"), "users/dana/projects/p2"), validProject()));
  });

  it("rejects invalid projects: ranges, oversized keywords, bad schema, privilege fields", async () => {
    await grantPremium("erin");
    const ref = (uid = "erin", id = "p1") => doc(plain(uid), `users/${uid}/projects/${id}`);
    await assertFails(setDoc(ref(), validProject({ latitude: 95 })));
    await assertFails(setDoc(ref(), validProject({ longitude: -181 })));
    await assertFails(setDoc(ref(), validProject({ altitudeMeters: 30000 })));
    await assertFails(setDoc(ref(), validProject({ keywords: Array.from({ length: 31 }, (_, i) => `k${i}`) })));
    await assertFails(setDoc(ref(), validProject({ keywords: ["x".repeat(61)] })));
    await assertFails(setDoc(ref(), validProject({ projectTitle: "" })));
    await assertFails(setDoc(ref(), validProject({ schemaVersion: 2 })));
    await assertFails(setDoc(ref(), validProject({ mediaUrl: "https://cdn.example.com/x.jpg" })));
    await assertFails(setDoc(ref(), validProject({ exif: { GPSLatitude: 1 } })));
  });

  // SOL-004: the approved 30-keyword maximum must WRITE successfully under
  // the complete validProject rules expression (not a simplified predicate),
  // inside the emulator's evaluation budget. Items are packed with \u0001.
  it("SOL-004: accepts exactly 30 keywords and every count from 0 to 30; rejects 31 and malformed items", async () => {
    await grantPremium("frida");
    const ref = (id = "p1") => doc(plain("frida"), `users/frida/projects/${id}`);
    const SEP = "\u0001";
    const packed30 = Array.from({ length: 30 }, (_, i) => `keyword-${i}-${"x".repeat(20)}`).join(SEP);
    // 30 accepted in the full validator.
    await assertSucceeds(createProjectAndReservation("frida", "k30", validProject({ projectTitle: "Keyword k30", keywords: packed30 })));
    // Boundary counts all accepted.
    for (const count of [0, 1, 20, 24, 29]) {
      await assertSucceeds(createProjectAndReservation("frida", `k${count}`, validProject({ projectTitle: `Keyword k${count}`, keywords: Array.from({ length: count }, (_, i) => `kw${i}`).join(SEP) })));
    }
    // 31 rejected.
    await assertFails(setDoc(ref("k31"), validProject({ keywords: `${packed30}${SEP}one-too-many` })));
    // Malformed items at first, middle and last positions.
    await assertFails(setDoc(ref("m1"), validProject({ keywords: `${SEP}a${SEP}b` }))); // empty first item
    await assertFails(setDoc(ref("m2"), validProject({ keywords: `a${SEP}${"x".repeat(61)}${SEP}b` }))); // oversized middle
    await assertFails(setDoc(ref("m3"), validProject({ keywords: `a${SEP}b${SEP}\u0002` }))); // control char in last
    await assertFails(setDoc(ref("m4"), validProject({ keywords: 42 }))); // wrong type entirely
  });

  // SOL-006: websiteUrl accepts only empty or normalized http(s) URLs.
  it("SOL-006: project website scheme — http(s)/empty accepted, other schemes rejected", async () => {
    await grantPremium("gale");
    const ref = (id = "p1") => doc(plain("gale"), `users/gale/projects/${id}`);
    await assertSucceeds(createProjectAndReservation("gale", "u1", validProject({ projectTitle: "Website u1", websiteUrl: "" })));
    await assertSucceeds(createProjectAndReservation("gale", "u2", validProject({ projectTitle: "Website u2", websiteUrl: "https://acme.example.com/campaign" })));
    await assertSucceeds(createProjectAndReservation("gale", "u3", validProject({ projectTitle: "Website u3", websiteUrl: "http://acme.example.com" })));
    await assertFails(setDoc(ref("u4"), validProject({ websiteUrl: "ftp://acme.example.com/file" })));
    await assertFails(setDoc(ref("u5"), validProject({ websiteUrl: "file:///etc/passwd" })));
    await assertFails(setDoc(ref("u6"), validProject({ websiteUrl: "javascript:alert(1)" })));
    await assertFails(setDoc(ref("u7"), validProject({ websiteUrl: "data:text/html;base64,PHNjcmlwdD4=" })));
    await assertFails(setDoc(ref("u8"), validProject({ websiteUrl: "/relative/path" })));
    await assertFails(setDoc(ref("u9"), validProject({ websiteUrl: "acme.example.com" })));
    await assertFails(setDoc(ref("u10"), validProject({ websiteUrl: "https://" })));
    await assertFails(setDoc(ref("u11"), validProject({ websiteUrl: "x".repeat(201) })));
  });

  // SOL-015: latitude/longitude must arrive as a complete pair; zero
  // coordinates are valid; altitude without a pair is rejected.
  it("SOL-015: GPS pair invariants — both-or-neither, altitude-only rejected, (0,0) valid", async () => {
    await grantPremium("hugo");
    const ref = (id = "p1") => doc(plain("hugo"), `users/hugo/projects/${id}`);
    await assertSucceeds(createProjectAndReservation("hugo", "g1", validProject({ projectTitle: "GPS g1", latitude: 0, longitude: 0, altitudeMeters: 0 })));
    await assertSucceeds(createProjectAndReservation("hugo", "g2", validProject({ projectTitle: "GPS g2", latitude: null, longitude: null, altitudeMeters: null })));
    await assertFails(setDoc(ref("g3"), validProject({ latitude: 51.5, longitude: null, altitudeMeters: null })));
    await assertFails(setDoc(ref("g4"), validProject({ latitude: null, longitude: -0.12, altitudeMeters: null })));
    await assertFails(setDoc(ref("g5"), validProject({ latitude: null, longitude: null, altitudeMeters: 35 })));
  });

  // ---- SOL-005: atomic normalized-title uniqueness (transactional) ----
  // Mirrors the exact transaction shape used by src/lib/firebase/projects.ts:
  // read-then-write `users/{uid}/projectTitles/{titleKey}` + the project doc
  // in ONE runTransaction.
  /** Create-with-reservation in one transaction (same shape as projects.ts). */
  type ModularDb = import("@firebase/firestore").Firestore;
  const modularDb = (uid: string): ModularDb => plain(uid) as unknown as ModularDb;
  const createWithReservation = async (db: ModularDb, uid: string, projectId: string, title: string) => {
    const key = titleKeyOf(title);
    await runTransaction(db, async (transaction) => {
      const existing = await transaction.get(doc(db, "users", uid, "projectTitles", key));
      if (existing.exists()) throw new Error("TITLE_TAKEN");
      transaction.set(doc(db, "users", uid, "projects", projectId), validProject({ projectTitle: title, titleKey: key }));
      transaction.set(doc(db, "users", uid, "projectTitles", key), { projectId, schemaVersion: 1 });
    });
  };

  it("SOL-005: two concurrent normalized-equivalent creates yield exactly one success", async () => {
    await grantPremium("ivy");
    const db = modularDb("ivy");
    const attempts = await Promise.allSettled([
      createWithReservation(db, "ivy", "pA", "Harbor Noon"),
      createWithReservation(db, "ivy", "pB", "harbor   noon"),
    ]);
    const succeeded = attempts.filter((attempt) => attempt.status === "fulfilled");
    expect(succeeded).toHaveLength(1);
    // Exactly one project exists and exactly one reservation was claimed.
    const list = await getDocs(collection(db, "users/ivy/projects"));
    expect(list.size).toBe(1);
    const reservations = await getDocs(collection(db, "users/ivy/projectTitles"));
    expect(reservations.size).toBe(1);
  });

  it("SOL-005: rename collision fails, free rename succeeds and releases the old key", async () => {
    await grantPremium("kai");
    const db = modularDb("kai");
    await createWithReservation(db, "kai", "p1", "Original Title");
    await createWithReservation(db, "kai", "p2", "Second Title");
    // Rename p1 onto p2's normalized title → refused, no partial state.
    await expect(createWithReservation(db, "kai", "p1", "second title")).rejects.toThrow();
    // Original data intact, reservations unchanged.
    const p1 = await getDoc(doc(db, "users/kai/projects/p1"));
    expect((p1.data() as Record<string, unknown>).projectTitle).toBe("Original Title");
    // Rename p1 to a free (case/whitespace-normalized-equivalent-free) title.
    await runTransaction(db, async (transaction) => {
      const newKey = titleKeyOf("Renamed Project");
      const existing = await transaction.get(doc(db, "users/kai/projectTitles", newKey));
      if (existing.exists()) throw new Error("TITLE_TAKEN");
      const current = (await transaction.get(doc(db, "users/kai/projects/p1"))).data() as Record<string, unknown>;
      transaction.delete(doc(db, "users/kai/projectTitles", titleKeyOf("Original Title")));
      transaction.set(doc(db, "users/kai/projectTitles", newKey), { projectId: "p1", schemaVersion: 1 });
      transaction.set(doc(db, "users/kai/projects/p1"), {
        ...current,
        projectTitle: "Renamed Project",
        titleKey: newKey,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    });
    // The old key is reusable after the rename.
    await createWithReservation(db, "kai", "p3", "original title");
  });

  it("SOL-005: delete releases the reservation and the title becomes reusable", async () => {
    await grantPremium("lein");
    const db = modularDb("lein");
    await createWithReservation(db, "lein", "p1", "Ephemeral Project");
    const batch = writeBatch(db);
    batch.delete(doc(db, "users/lein/projects/p1"));
    batch.delete(doc(db, "users/lein/projectTitles", titleKeyOf("Ephemeral Project")));
    await batch.commit();
    await createWithReservation(db, "lein", "p2", "ephemeral project");
  });

  it("SOL-005: reservations are owner-scoped and cannot be forged across users", async () => {
    await grantPremium("milo");
    await grantPremium("nora");
    // Same title for two different owners is fine (per-user namespace).
    await createWithReservation(modularDb("milo"), "milo", "p1", "Shared Title");
    await createWithReservation(modularDb("nora"), "nora", "p1", "shared title");
    // Mallory cannot create a reservation pointing at milo's project.
    await assertFails(setDoc(doc(plain("mallory"), "users/mallory/projectTitles", titleKeyOf("Hijack")), { projectId: "../projects/p1", schemaVersion: 1 }));
    await assertFails(setDoc(doc(plain("mallory"), "users/mallory/projectTitles", "notakey"), { projectId: "p1", schemaVersion: 1 }));
    // Reservation updates are impossible (immutable claims).
    await assertFails(setDoc(doc(plain("milo"), "users/milo/projectTitles", titleKeyOf("Shared Title")), { projectId: "p2", schemaVersion: 1 }));
  });

  it("SOL-005: direct project/reservation bypasses are denied", async () => {
    await grantPremium("quinn");
    const db = modularDb("quinn");
    const key = titleKeyOf("Protected Title");
    await assertFails(setDoc(doc(db, "users/quinn/projects/p1"), validProject({ projectTitle: "Protected Title", titleKey: key })));
    await createWithReservation(db, "quinn", "p1", "Protected Title");
    await assertFails(deleteDoc(doc(db, "users/quinn/projectTitles", key)));
    await assertFails(setDoc(doc(db, "users/quinn/projectTitles", titleKeyOf("Forged Title")), { projectId: "p1", schemaVersion: 1 }));
    await assertFails(setDoc(doc(db, "users/quinn/projectTitles", titleKeyOf("Wrong Key")), { projectId: "p1", schemaVersion: 1 }));
  });

  it("SOL-005: rules derive the key from the actual project title", async () => {
    await grantPremium("rhea");
    const db = modularDb("rhea");
    const forgedKey = titleKeyOf("Other Title");
    await assertFails(runTransaction(db, async (transaction) => {
      transaction.set(doc(db, "users/rhea/projects/forged"), validProject({ projectTitle: "Dental SEO", titleKey: forgedKey }));
      transaction.set(doc(db, "users/rhea/projectTitles", forgedKey), { projectId: "forged", schemaVersion: 1 });
    }));
    expect((await getDoc(doc(db, "users/rhea/projects/forged"))).exists()).toBe(false);
    expect((await getDoc(doc(db, "users/rhea/projectTitles", forgedKey))).exists()).toBe(false);
  });

});
