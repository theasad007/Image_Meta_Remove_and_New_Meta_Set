import { getFirebaseDb, isFirebaseConfigured, readFirebaseConfig } from "./config";

/**
 * Manual Premium entitlements (Phase 03) — superadmin-managed, never
 * client-writable, no payment gateway.
 *
 * Firestore layout (no new top-level collection):
 * - `users/{uid}/entitlement/main` — admin-owned entitlement record:
 *   `{ tier: "free"|"premium", status: "active"|"expired", expiresAt:
 *   Timestamp|null, assignedBy, reason?, updatedAt }`.
 *
 * Rules contract:
 * - READ: the owner (to display their own tier) and superadmins.
 * - WRITE: verified `superadmin` Auth custom claim ONLY. Ordinary users,
 *   anonymous clients and localStorage can never create or change an
 *   entitlement — the allowlist rejects any other field combination.
 *
 * Expiry: `expiresAt` is a real Firestore timestamp; cloud rules compare
 * it against `request.time` (server clock). The client mirror in
 * `policy-state.ts` is display-only.
 *
 * Suspension stays a separate concept: `users/{uid}.status == "suspended"`
 * blocks signed-in cloud features; entitlements never override suspension,
 * and suspension never deletes stored projects.
 */

export const ENTITLEMENT_SCHEMA_VERSION = 1;

export type EntitlementTier = "free" | "premium";
export type EntitlementStatus = "active" | "expired";

export interface StoredEntitlement {
  tier: EntitlementTier;
  status: EntitlementStatus;
  /** Firestore Timestamp | null when stored; ISO string when read back. */
  expiresAt: unknown;
  assignedBy: string | null;
  reason: string | null;
  updatedAt: unknown;
}

/** The view the workspace resolver consumes (client-side, display-only). */
export interface EntitlementView {
  tier: EntitlementTier;
  status: EntitlementStatus;
  expiresAt: string | null;
}

const MAX_REASON = 280;

/** Pure: validate an entitlement write payload (mirrors firestore.rules). */
export function validateEntitlement(input: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof input !== "object" || input === null) {
    return { ok: false, errors: ["Entitlement must be an object."] };
  }
  const record = input as Record<string, unknown>;
  const allowed = new Set(["tier", "status", "expiresAt", "assignedBy", "reason", "updatedAt"]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) errors.push(`Unexpected field: ${key}.`);
  }
  if (record.tier !== "free" && record.tier !== "premium") errors.push("tier must be 'free' or 'premium'.");
  if (record.status !== "active" && record.status !== "expired") errors.push("status must be 'active' or 'expired'.");
  if (record.expiresAt !== null && record.expiresAt === undefined) errors.push("expiresAt is required (timestamp or null).");
  if (typeof record.assignedBy !== "string" || record.assignedBy.length === 0 || record.assignedBy.length > 128) {
    errors.push("assignedBy must be a non-empty string (≤128).");
  }
  if (record.reason !== undefined && record.reason !== null && (typeof record.reason !== "string" || (record.reason as string).length > MAX_REASON)) {
    errors.push(`reason must be a string (≤${MAX_REASON}) when present.`);
  }
  if (record.status === "expired" && record.tier === "premium") {
    // An explicitly expired premium record is allowed only without a live
    // expiry timestamp — an admin marking expiry uses tier 'free'/'expired'
    // status; keep the model unambiguous.
    errors.push("Use status 'active' for premium grants; revoke via tier 'free'.");
  }
  return { ok: errors.length === 0, errors };
}

function assertFirebaseReady(): void {
  if (!isFirebaseConfigured(readFirebaseConfig())) {
    throw new Error("Firebase is not configured.");
  }
}

function toView(data: Record<string, unknown>): EntitlementView | null {
  if (data.tier !== "free" && data.tier !== "premium") return null;
  if (data.status !== "active" && data.status !== "expired") return null;
  const expires = data.expiresAt;
  let expiresAt: string | null = null;
  if (expires !== null && expires !== undefined) {
    if (typeof expires === "object" && expires !== null && "toDate" in expires) {
      expiresAt = (expires as { toDate: () => Date }).toDate().toISOString();
    } else {
      return null;
    }
  }
  return { tier: data.tier, status: data.status, expiresAt };
}

/** Owner read of the caller's own entitlement (null when missing/unreadable —
 *  the resolver then fails closed for premium, never for free features). */
export async function fetchOwnEntitlement(uid: string): Promise<EntitlementView | null> {
  try {
    assertFirebaseReady();
    const db = await getFirebaseDb();
    const { doc, getDoc } = await import("firebase/firestore");
    const snap = await getDoc(doc(db, "users", uid, "entitlement", "main"));
    if (!snap.exists()) return null;
    return toView(snap.data() as Record<string, unknown>);
  } catch {
    return null;
  }
}

/** Superadmin read for the admin Users panel (null when absent). */
export async function fetchEntitlementForAdmin(targetUid: string): Promise<EntitlementView | null> {
  assertFirebaseReady();
  const db = await getFirebaseDb();
  const { doc, getDoc } = await import("firebase/firestore");
  const snap = await getDoc(doc(db, "users", targetUid, "entitlement", "main"));
  if (!snap.exists()) return null;
  return toView(snap.data() as Record<string, unknown>);
}

function assertNotSelfLockout(actorUid: string, targetUid: string): void {
  if (actorUid === targetUid) {
    throw new Error("Use the documented owner CLI for changes to your own superadmin account.");
  }
}

/** Superadmin: grant (or extend/renew) manual Premium for a signed-in user. */
export async function grantPremium(
  actorUid: string,
  targetUid: string,
  options: { expiresAt: Date | null; reason?: string },
): Promise<void> {
  assertFirebaseReady();
  assertNotSelfLockout(actorUid, targetUid);
  const db = await getFirebaseDb();
  const { doc, setDoc, serverTimestamp, Timestamp } = await import("firebase/firestore");
  const payload: Record<string, unknown> = {
    tier: "premium",
    status: "active",
    expiresAt: options.expiresAt ? Timestamp.fromDate(options.expiresAt) : null,
    assignedBy: actorUid,
    ...(options.reason ? { reason: options.reason.slice(0, MAX_REASON) } : {}),
    updatedAt: serverTimestamp(),
  };
  const { ok, errors } = validateEntitlement({ ...payload, updatedAt: new Date() });
  if (!ok) throw new Error(`Entitlement invalid: ${errors.join("; ")}`);
  await setDoc(doc(db, "users", targetUid, "entitlement", "main"), payload);
}

/** Superadmin: revoke Premium (records stay; premium cloud access ends). */
export async function revokePremium(actorUid: string, targetUid: string, reason?: string): Promise<void> {
  assertFirebaseReady();
  assertNotSelfLockout(actorUid, targetUid);
  const db = await getFirebaseDb();
  const { doc, setDoc, serverTimestamp } = await import("firebase/firestore");
  const payload = {
    tier: "free",
    status: "expired",
    expiresAt: null,
    assignedBy: actorUid,
    ...(reason ? { reason: reason.slice(0, MAX_REASON) } : {}),
    updatedAt: serverTimestamp(),
  };
  await setDoc(doc(db, "users", targetUid, "entitlement", "main"), payload);
}
