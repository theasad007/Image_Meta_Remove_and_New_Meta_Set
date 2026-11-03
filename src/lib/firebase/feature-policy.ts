import { getFirebaseDb, isFirebaseConfigured, readFirebaseConfig } from "./config";

/**
 * Feature access policy (Phase 02) — the single server-stored policy
 * document the Super Admin manages from Screen 08 Settings.
 *
 * Firestore layout (no new collection; sibling of the existing
 * `adminSettings/usagePolicy`):
 * - `adminSettings/featurePolicy` — `{ schemaVersion, updatedAt, updatedBy,
 *   features: { <FeatureKey>: "free" | "premium" } }`.
 *
 * Rules contract (firestore.rules):
 * - Public READ of this one document: it contains only sanitized policy
 *   keys — never user data, media, filenames, or counters.
 * - WRITE: verified `superadmin` Auth custom claim only, validated against
 *   the exact key/value allowlist below.
 *
 * Safe defaults: a missing document, a malformed one, or any network
 * failure resolves to DEFAULT_FEATURE_POLICY. The defaults never turn a
 * free-by-contract operation paid and never disable single-file free
 * behavior; premium-by-default batch/project features stay locked until a
 * superadmin intentionally opens them.
 */

export const FEATURE_POLICY_DOC = "featurePolicy";

/** The nine governed capabilities (keys are stable contract names). */
export type FeatureKey =
  | "single_metadata_clean"
  | "single_ai_metadata_clean"
  | "bulk_metadata_clean"
  | "bulk_ai_metadata_clean"
  | "single_custom_rewrite"
  | "batch_metadata_rewrite"
  | "batch_gps_write"
  | "multiple_named_projects"
  | "saved_project_apply";

export type FeaturePolicyValue = "free" | "premium";

export type FeaturePolicyMap = Record<FeatureKey, FeaturePolicyValue>;

export interface FeaturePolicy {
  schemaVersion: number;
  features: FeaturePolicyMap;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** Keys the admin may re-policy, with their allowed directions. */
export const ADMIN_ADJUSTABLE_FEATURES: readonly FeatureKey[] = [
  "bulk_metadata_clean",
  "bulk_ai_metadata_clean",
  "batch_metadata_rewrite",
  "batch_gps_write",
  "multiple_named_projects",
  "saved_project_apply",
];

/** Free-by-contract features can never be switched to premium. */
export const LOCKED_FREE_FEATURES: readonly FeatureKey[] = [
  "single_metadata_clean",
  "single_ai_metadata_clean",
  "single_custom_rewrite",
];

export const FEATURE_POLICY_SCHEMA_VERSION = 1;

/** Shipped defaults — mirrored by firestore.rules fallback thinking and the
 *  workspace resolver. Bulk cleaning stays FREE; batch/project features
 *  start PREMIUM per the 2026-10-31 product policy. */
export const DEFAULT_FEATURE_POLICY: FeaturePolicy = {
  schemaVersion: FEATURE_POLICY_SCHEMA_VERSION,
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
  updatedAt: null,
  updatedBy: null,
};

const FEATURE_KEYS: readonly FeatureKey[] = [
  ...LOCKED_FREE_FEATURES,
  ...ADMIN_ADJUSTABLE_FEATURES,
];

export function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(value);
}

/** Free-by-contract features can never be gated and never trigger a
 *  network policy read (guests stay fully offline for single-file work). */
export function isContractFree(feature: FeatureKey): boolean {
  return (LOCKED_FREE_FEATURES as readonly string[]).includes(feature);
}

/** Pure: validate a stored candidate policy (mirrors firestore.rules). */
export function validateFeaturePolicy(input: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof input !== "object" || input === null) {
    return { ok: false, errors: ["Feature policy must be an object."] };
  }
  const record = input as Record<string, unknown>;
  const allowed = new Set(["schemaVersion", "updatedAt", "updatedBy", "features"]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) errors.push(`Unexpected field: ${key}.`);
  }
  if (record.schemaVersion !== FEATURE_POLICY_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${FEATURE_POLICY_SCHEMA_VERSION}.`);
  }
  if (typeof record.updatedBy !== "string" || record.updatedBy.length === 0 || record.updatedBy.length > 128) {
    errors.push("updatedBy must be a non-empty string (≤128).");
  }
  const features = record.features;
  if (typeof features !== "object" || features === null) {
    errors.push("features must be an object.");
    return { ok: false, errors };
  }
  const featureRecord = features as Record<string, unknown>;
  for (const key of Object.keys(featureRecord)) {
    if (!isFeatureKey(key)) {
      errors.push(`Unknown feature key: ${key}.`);
      continue;
    }
    const value = featureRecord[key];
    if (value !== "free" && value !== "premium") {
      errors.push(`Feature ${key} must be "free" or "premium".`);
      continue;
    }
    if ((LOCKED_FREE_FEATURES as readonly string[]).includes(key) && value !== "free") {
      errors.push(`Feature ${key} is free by contract and cannot be set to premium.`);
    }
  }
  for (const required of FEATURE_KEYS) {
    if (!(required in featureRecord)) errors.push(`Missing feature key: ${required}.`);
  }
  return { ok: errors.length === 0, errors };
}

/** Pure: sanitize an arbitrary stored document into a usable policy, or
 *  null when it cannot be trusted (the caller then uses the defaults). */
export function sanitizeFeaturePolicy(data: unknown): FeaturePolicy | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  const candidate = {
    schemaVersion: record.schemaVersion,
    updatedBy: typeof record.updatedBy === "string" ? record.updatedBy : "",
    // updatedAt arrives as a Firestore Timestamp; presence/shape is not
    // security-relevant, so any value is tolerated here while the rules
    // still enforce a real timestamp on writes.
    updatedAt: record.updatedAt ?? null,
    features: record.features,
  };
  const { ok } = validateFeaturePolicy(candidate);
  if (!ok) return null;
  return {
    schemaVersion: FEATURE_POLICY_SCHEMA_VERSION,
    features: { ...DEFAULT_FEATURE_POLICY.features, ...(candidate.features as FeaturePolicyMap) },
    updatedAt: typeof record.updatedAt === "object" && record.updatedAt !== null && "toDate" in (record.updatedAt as object)
      ? (record.updatedAt as { toDate: () => Date }).toDate().toISOString()
      : null,
    updatedBy: typeof record.updatedBy === "string" ? record.updatedBy : null,
  };
}

/**
 * Where a fetched policy came from (SOL-014). The workspace must be able
 * to OBSERVE degraded reads instead of mistaking every default for a
 * successful load:
 * - "remote"             — the stored document was read and sanitized.
 * - "missing-default"    — the document does not exist yet.
 * - "malformed-default"  — the document failed validation.
 * - "error-default"      — the read failed (offline/permission).
 * - "unconfigured-default" — no Firebase config (offline demo build).
 * All defaults equal the shipped contract — safe, never premium-enabling.
 */
export type PolicyProvenance =
  | "remote"
  | "missing-default"
  | "malformed-default"
  | "error-default"
  | "unconfigured-default";

export interface FeaturePolicyFetchResult {
  policy: FeaturePolicy;
  provenance: PolicyProvenance;
}

/** Public read WITH provenance (SOL-014): the sanitized policy document, or
 *  the shipped defaults plus the reason defaults were used. Never throws. */
export async function fetchFeaturePolicyWithProvenance(): Promise<FeaturePolicyFetchResult> {
  try {
    if (!isFirebaseConfigured(readFirebaseConfig())) {
      return { policy: structuredCopyDefaults(), provenance: "unconfigured-default" };
    }
    const db = await getFirebaseDb();
    const { doc, getDoc } = await import("firebase/firestore");
    const snap = await getDoc(doc(db, "adminSettings", FEATURE_POLICY_DOC));
    if (!snap.exists()) return { policy: structuredCopyDefaults(), provenance: "missing-default" };
    const sanitized = sanitizeFeaturePolicy(snap.data());
    if (!sanitized) return { policy: structuredCopyDefaults(), provenance: "malformed-default" };
    return { policy: sanitized, provenance: "remote" };
  } catch {
    return { policy: structuredCopyDefaults(), provenance: "error-default" };
  }
}

/** Public read: the sanitized policy document, or the shipped defaults on
 *  any absence/failure (never throws for guests). */
export async function fetchFeaturePolicy(): Promise<FeaturePolicy> {
  return (await fetchFeaturePolicyWithProvenance()).policy;
}

/** Superadmin: persist a new policy (validated client-side; rules re-validate). */
export async function saveFeaturePolicy(actorUid: string, features: FeaturePolicyMap): Promise<void> {
  if (!actorUid || actorUid.length > 128) throw new Error("Invalid actor uid.");
  const { ok, errors } = validateFeaturePolicy({
    schemaVersion: FEATURE_POLICY_SCHEMA_VERSION,
    features,
    updatedBy: actorUid,
  });
  if (!ok) throw new Error(`Feature policy invalid: ${errors.join("; ")}`);
  const db = await getFirebaseDb();
  const { doc, setDoc, serverTimestamp } = await import("firebase/firestore");
  await setDoc(doc(db, "adminSettings", FEATURE_POLICY_DOC), {
    schemaVersion: FEATURE_POLICY_SCHEMA_VERSION,
    features,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });
}

function structuredCopyDefaults(): FeaturePolicy {
  return {
    schemaVersion: DEFAULT_FEATURE_POLICY.schemaVersion,
    features: { ...DEFAULT_FEATURE_POLICY.features },
    updatedAt: null,
    updatedBy: null,
  };
}
