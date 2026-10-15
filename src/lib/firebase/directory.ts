import { getFirebaseDb } from "./config";

/**
 * Registered-account directory + usage-policy settings (Phase 6A).
 *
 * Firestore layout:
 * - `users/{uid}` — minimal directory record (uid, verified Google
 *   email/display name, photoURL, status `active`/`suspended`, createdAt,
 *   updatedAt, optional superadmin-only statusReason). NEVER media,
 *   filenames, scans, GPS, downloads, or history.
 * - `users/{uid}/profile/main` — existing Phase 6 custom-metadata profile
 *   (unchanged schema).
 * - `adminSettings/usagePolicy` — superadmin-only future policy values,
 *   explicitly NOT enforced (static unlimited guest processing continues).
 *
 * Suspension gates signed-in CLOUD features only (profile + admin reads).
 * It never revokes Google login, never disables the Firebase Auth user,
 * and never touches anonymous browser-only cleaning. The UI and docs must
 * say exactly that.
 */

export type AccountStatus = "active" | "suspended";

export interface DirectoryRecord {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  status: AccountStatus;
}

export interface UsagePolicy {
  /** Always 'unlimited' in this milestone — caps are NOT enforced. */
  mode: "unlimited";
  inspectHourly: number | null;
  inspectDaily: number | null;
  cleanHourly: number | null;
  cleanDaily: number | null;
}

const MAX_EMAIL = 200;
const MAX_NAME = 120;
const MAX_URL = 300;
const MAX_REASON = 280;
const MAX_LIMIT = 1000000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Pure: validate an owner self-registration payload (must stay active). */
export function validateDirectoryCreate(input: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ["Directory record must be an object."] };
  const keys = Object.keys(input);
  const allowed = new Set(["uid", "email", "displayName", "photoURL", "status", "createdAt", "updatedAt"]);
  for (const key of keys) {
    if (!allowed.has(key)) errors.push(`Unexpected field: ${key}.`);
  }
  if (typeof input.uid !== "string" || input.uid === "" || input.uid.length > 128) {
    errors.push("uid must be a non-empty string (≤128).");
  }
  if (typeof input.email !== "string" || input.email.length > MAX_EMAIL) {
    errors.push(`email must be a string (≤${MAX_EMAIL}).`);
  }
  if (typeof input.displayName !== "string" || input.displayName.length > MAX_NAME) {
    errors.push(`displayName must be a string (≤${MAX_NAME}).`);
  }
  if (typeof input.photoURL !== "string" || input.photoURL.length > MAX_URL) {
    errors.push(`photoURL must be a string (≤${MAX_URL}).`);
  }
  if (input.status !== "active") errors.push("Self-registration status must be 'active'.");
  return { ok: errors.length === 0, errors };
}

/** Pure: owner self-update may touch identity fields only (never status). */
export function validateDirectoryOwnerUpdate(input: unknown, currentUid: string): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ["Directory record must be an object."] };
  if (input.uid !== currentUid) errors.push("uid is immutable.");
  if (input.status !== "active") errors.push("Only a superadmin can change status.");
  if (typeof input.email !== "string" || (input.email as string).length > MAX_EMAIL) {
    errors.push(`email must be a string (≤${MAX_EMAIL}).`);
  }
  if (typeof input.displayName !== "string" || (input.displayName as string).length > MAX_NAME) {
    errors.push(`displayName must be a string (≤${MAX_NAME}).`);
  }
  if (typeof input.photoURL !== "string" || (input.photoURL as string).length > MAX_URL) {
    errors.push(`photoURL must be a string (≤${MAX_URL}).`);
  }
  return { ok: errors.length === 0, errors };
}

/** Pure: superadmin status change keeps identity/bookkeeping intact. */
export function validateStatusChange(
  current: Record<string, unknown>,
  next: Record<string, unknown>,
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (next.uid !== current.uid) errors.push("uid is immutable.");
  if (next.status !== "active" && next.status !== "suspended") {
    errors.push("status must be 'active' or 'suspended'.");
  }
  for (const field of ["email", "displayName", "photoURL", "createdAt"] as const) {
    if (!Object.is(next[field], current[field])) errors.push(`${field} must stay unchanged on a status change.`);
  }
  if (next.statusReason !== undefined) {
    if (typeof next.statusReason !== "string" || (next.statusReason as string).length > MAX_REASON) {
      errors.push(`statusReason must be a string (≤${MAX_REASON}).`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Pure: usage-policy doc validation (stored values, never enforced). */
export function validateUsagePolicy(input: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ["Usage policy must be an object."] };
  const allowed = new Set([
    "mode", "inspectHourly", "inspectDaily", "cleanHourly", "cleanDaily", "updatedAt", "updatedBy",
  ]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) errors.push(`Unexpected field: ${key}.`);
  }
  if (input.mode !== "unlimited") errors.push("mode must stay 'unlimited' in this milestone (caps are not enforced).");
  for (const field of ["inspectHourly", "inspectDaily", "cleanHourly", "cleanDaily"] as const) {
    const value = input[field];
    if (value !== null && value !== undefined) {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_LIMIT) {
        errors.push(`${field} must be null or an integer 0–${MAX_LIMIT}.`);
      }
    }
  }
  if (typeof input.updatedBy !== "string" || (input.updatedBy as string).length > 128) {
    errors.push("updatedBy must be a string (≤128).");
  }
  return { ok: errors.length === 0, errors };
}

/** Pure: UI self-suspend guard — the owner account cannot suspend itself here. */
export function canSuspendTarget(actorUid: string, targetUid: string): { allowed: boolean; reason: string } {
  if (actorUid === targetUid) {
    return { allowed: false, reason: "You cannot suspend your own owner account here (prevents accidental lockout)." };
  }
  return { allowed: true, reason: "" };
}

/** Slice Google-provided strings to directory ceilings (documented, media-free bookkeeping only). */
export function sanitizeDirectoryIdentity(identity: { email: string; displayName: string; photoURL: string }): {
  email: string;
  displayName: string;
  photoURL: string;
} {
  return {
    email: identity.email.slice(0, MAX_EMAIL),
    displayName: identity.displayName.slice(0, MAX_NAME),
    photoURL: identity.photoURL.slice(0, MAX_URL),
  };
}

function assertUid(uid: string): void {
  if (!uid || uid.length > 128) throw new Error("Invalid user id.");
}

/** Create the caller's own directory record (idempotent read-first). */
export async function ensureAccountRecord(
  uid: string,
  identity: { email: string; displayName: string; photoURL: string },
): Promise<"created" | "exists"> {
  assertUid(uid);
  const db = await getFirebaseDb();
  const { doc, getDoc, setDoc, serverTimestamp } = await import("firebase/firestore");
  const ref = doc(db, "users", uid);
  const existing = await getDoc(ref);
  if (existing.exists()) return "exists";
  const clean = sanitizeDirectoryIdentity(identity);
  const { ok, errors } = validateDirectoryCreate({
    uid, email: clean.email, displayName: clean.displayName, photoURL: clean.photoURL, status: "active",
  });
  if (!ok) throw new Error(`Directory record invalid: ${errors.join("; ")}`);
  await setDoc(ref, {
    uid,
    email: clean.email,
    displayName: clean.displayName,
    photoURL: clean.photoURL,
    status: "active",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return "created";
}

/** Read the caller's own directory status (null when absent/offline). */
export async function fetchOwnStatus(uid: string): Promise<AccountStatus | null> {
  assertUid(uid);
  try {
    const db = await getFirebaseDb();
    const { doc, getDoc } = await import("firebase/firestore");
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) return null;
    const status = (snap.data() as Record<string, unknown>).status;
    return status === "suspended" ? "suspended" : status === "active" ? "active" : null;
  } catch {
    return null;
  }
}

export interface AdminAccountRow {
  uid: string;
  email: string;
  displayName: string;
  status: AccountStatus;
  createdAt: unknown;
  statusReason?: string;
}

/** Superadmin: first page of the directory (Firestore dir only — never Auth listUsers). */
export async function listAccountPage(pageSize: number, cursorUid: string | null): Promise<{ rows: AdminAccountRow[]; nextCursor: string | null }> {
  const db = await getFirebaseDb();
  const { collection, query, orderBy, limit, startAfter, getDocs } = await import("firebase/firestore");
  const base = collection(db, "users");
  const constraints = cursorUid
    ? [orderBy("__name__"), startAfter(cursorUid), limit(Math.max(1, Math.min(pageSize, 100)))]
    : [orderBy("__name__"), limit(Math.max(1, Math.min(pageSize, 100)))];
  const snap = await getDocs(query(base, ...constraints));
  const rows: AdminAccountRow[] = [];
  snap.forEach((docSnap) => {
    const data = docSnap.data() as Record<string, unknown>;
    if (typeof data.uid !== "string") return;
    rows.push({
      uid: data.uid,
      email: typeof data.email === "string" ? data.email : "",
      displayName: typeof data.displayName === "string" ? data.displayName : "",
      status: data.status === "suspended" ? "suspended" : "active",
      createdAt: data.createdAt ?? null,
      ...(typeof data.statusReason === "string" ? { statusReason: data.statusReason } : {}),
    });
  });
  return { rows, nextCursor: rows.length > 0 ? (rows[rows.length - 1]?.uid ?? null) : null };
}

/** Superadmin: suspend or restore cloud-feature access (Firestore status only). */
export async function setAccountStatus(
  actorUid: string,
  target: AdminAccountRow,
  next: AccountStatus,
  reason: string,
): Promise<void> {
  const gate = canSuspendTarget(actorUid, target.uid);
  if (!gate.allowed) throw new Error(gate.reason);
  assertUid(target.uid);
  if (reason.length > MAX_REASON) throw new Error(`Reason must be ${MAX_REASON} characters or fewer.`);
  const db = await getFirebaseDb();
  const { doc, getDoc, setDoc, serverTimestamp } = await import("firebase/firestore");
  const ref = doc(db, "users", target.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Account directory entry not found (Auth-only accounts need the backfill step in docs/10-admin-setup.md).");
  const current = snap.data() as Record<string, unknown>;
  const candidate = { ...current, status: next, ...(reason ? { statusReason: reason } : {}) };
  const { ok, errors } = validateStatusChange(current, candidate);
  if (!ok) throw new Error(`Status change invalid: ${errors.join("; ")}`);
  await setDoc(ref, { ...candidate, updatedAt: serverTimestamp() }, { merge: true });
}

export const DEFAULT_USAGE_POLICY: UsagePolicy = {
  mode: "unlimited",
  inspectHourly: null,
  inspectDaily: null,
  cleanHourly: null,
  cleanDaily: null,
};

/** Superadmin: read the (non-enforced) usage-policy doc. */
export async function fetchUsagePolicy(): Promise<UsagePolicy> {
  const db = await getFirebaseDb();
  const { doc, getDoc } = await import("firebase/firestore");
  const snap = await getDoc(doc(db, "adminSettings", "usagePolicy"));
  if (!snap.exists()) return { ...DEFAULT_USAGE_POLICY };
  const data = snap.data() as Record<string, unknown>;
  const { ok } = validateUsagePolicy({ ...data, updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : "" });
  if (!ok) return { ...DEFAULT_USAGE_POLICY };
  return {
    mode: "unlimited",
    inspectHourly: typeof data.inspectHourly === "number" ? data.inspectHourly : null,
    inspectDaily: typeof data.inspectDaily === "number" ? data.inspectDaily : null,
    cleanHourly: typeof data.cleanHourly === "number" ? data.cleanHourly : null,
    cleanDaily: typeof data.cleanDaily === "number" ? data.cleanDaily : null,
  };
}

/** Superadmin: store future policy values (recorded only — nothing enforces them). */
export async function saveUsagePolicy(actorUid: string, policy: UsagePolicy): Promise<void> {
  assertUid(actorUid);
  const { ok, errors } = validateUsagePolicy({ ...policy, updatedBy: actorUid });
  if (!ok) throw new Error(`Usage policy invalid: ${errors.join("; ")}`);
  const db = await getFirebaseDb();
  const { doc, setDoc, serverTimestamp } = await import("firebase/firestore");
  await setDoc(doc(db, "adminSettings", "usagePolicy"), {
    ...policy,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });
}
