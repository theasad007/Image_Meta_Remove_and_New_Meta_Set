import type { FeatureKey, FeaturePolicy, FeaturePolicyMap } from "../firebase/feature-policy";
import { DEFAULT_FEATURE_POLICY } from "../firebase/feature-policy";

/**
 * Pure feature-access resolution (Phase 02/03) — the ONE place that decides
 * whether a capability is available, so no button or runner invents its own
 * ad-hoc gating logic.
 *
 * Model:
 * 1. The effective policy value comes from the server-stored policy map;
 *    a missing/unloaded document falls back to the shipped defaults
 *    (bulk cleaning stays free; batch/project features stay premium).
 * 2. A `free` effective value is available to everyone — including
 *    guests — and can never be downgraded by a broken policy read.
 * 3. A `premium` effective value requires a verified server-authored
 *    entitlement (tier premium + active + unexpired). Clients without
 *    Firebase (guests) resolve premium features as locked.
 *
 * Honesty boundary: browser-side enforcement is a product-access control,
 * not tamper-proof security. Firestore rules remain authoritative for all
 * privileged CLOUD data (projects, entitlements); this resolver only gates
 * local processing UX.
 */

/** Entitlement shape read from `users/{uid}/entitlement/main` (Phase 03). */
export interface UserEntitlement {
  tier: "free" | "premium";
  status: "active" | "expired";
  /** ISO timestamp or null for no expiry. Client clock is display-only —
   *  Firestore rules re-check expiry against request.time server-side. */
  expiresAt: string | null;
}

export const ENTITLEMENT_SOURCE_MANUAL = "manual_grant" as const;

export type AccessSource = "policy-free" | "entitlement" | "default-free" | "default-locked" | "policy-locked";

export interface FeatureAccess {
  allowed: boolean;
  /** Why — for honest UI messaging and tests. */
  source: AccessSource;
  reason: string;
}

export function isEntitlementActive(entitlement: UserEntitlement | null | undefined, now: number = Date.now()): boolean {
  if (!entitlement || entitlement.tier !== "premium") return false;
  if (entitlement.status !== "active") return false;
  if (entitlement.expiresAt === null) return true;
  const expiry = Date.parse(entitlement.expiresAt);
  if (Number.isNaN(expiry)) return false; // malformed expiry fails closed
  return expiry > now;
}

export function resolveFeatureAccess(
  feature: FeatureKey,
  entitlement: UserEntitlement | null | undefined,
  policy: FeaturePolicy | null | undefined,
): FeatureAccess {
  const map: FeaturePolicyMap = policy?.features ?? DEFAULT_FEATURE_POLICY.features;
  const value = map[feature] ?? DEFAULT_FEATURE_POLICY.features[feature];
  const usingDefaults = policy === null || policy === undefined;
  if (value === "free") {
    return {
      allowed: true,
      source: usingDefaults ? "default-free" : "policy-free",
      reason: "Free for everyone.",
    };
  }
  if (isEntitlementActive(entitlement)) {
    return {
      allowed: true,
      source: "entitlement",
      reason: "Included with Premium.",
    };
  }
  return {
    allowed: false,
    source: usingDefaults ? "default-locked" : "policy-locked",
    reason: "This action is a Premium feature. Premium access is granted manually by the site administrator — contact the administrator to activate it.",
  };
}

/** Convenience for tests/UI: the raw effective value for a feature. */
export function effectivePolicyValue(feature: FeatureKey, policy: FeaturePolicy | null | undefined): "free" | "premium" {
  const map = policy?.features ?? DEFAULT_FEATURE_POLICY.features;
  return map[feature] ?? DEFAULT_FEATURE_POLICY.features[feature];
}
