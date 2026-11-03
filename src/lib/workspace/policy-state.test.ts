import { describe, expect, it } from "vitest";
import {
  DEFAULT_FEATURE_POLICY,
  validateFeaturePolicy,
  type FeaturePolicy,
} from "../firebase/feature-policy";
import { validateEntitlement } from "../firebase/entitlement";
import {
  effectivePolicyValue,
  isEntitlementActive,
  resolveFeatureAccess,
  type UserEntitlement,
} from "./policy-state";

const premiumEntitlement = (expiresAt: string | null = null): UserEntitlement => ({
  tier: "premium",
  status: "active",
  expiresAt,
});

describe("feature policy validation", () => {
  it("accepts the shipped defaults", () => {
    const { ok, errors } = validateFeaturePolicy({
      schemaVersion: 1,
      updatedBy: "owner",
      updatedAt: new Date(),
      features: DEFAULT_FEATURE_POLICY.features,
    });
    expect(ok).toBe(true);
    expect(errors).toEqual([]);
  });

  it("rejects unknown keys, bad values and free-contract flips", () => {
    expect(validateFeaturePolicy({ schemaVersion: 1, updatedBy: "o", features: { ...DEFAULT_FEATURE_POLICY.features, rogue: "free" } }).ok).toBe(false);
    expect(validateFeaturePolicy({ schemaVersion: 1, updatedBy: "o", features: { ...DEFAULT_FEATURE_POLICY.features, bulk_metadata_clean: "unlimited" } }).ok).toBe(false);
    expect(validateFeaturePolicy({ schemaVersion: 1, updatedBy: "o", features: { ...DEFAULT_FEATURE_POLICY.features, single_metadata_clean: "premium" } }).ok).toBe(false);
    expect(validateFeaturePolicy({ schemaVersion: 2, updatedBy: "o", features: DEFAULT_FEATURE_POLICY.features }).ok).toBe(false);
    const incomplete = { ...DEFAULT_FEATURE_POLICY.features };
    delete (incomplete as Partial<typeof incomplete>).batch_gps_write;
    expect(validateFeaturePolicy({ schemaVersion: 1, updatedBy: "o", features: incomplete }).ok).toBe(false);
  });

  it("entitlement validation rejects privilege-shaped fields", () => {
    expect(validateEntitlement({ tier: "premium", status: "active", expiresAt: null, assignedBy: "owner", updatedAt: new Date() }).ok).toBe(true);
    expect(validateEntitlement({ tier: "premium", status: "active", expiresAt: null, assignedBy: "owner", updatedAt: new Date(), isAdmin: true }).ok).toBe(false);
    expect(validateEntitlement({ tier: "gold", status: "active", expiresAt: null, assignedBy: "owner", updatedAt: new Date() }).ok).toBe(false);
    expect(validateEntitlement({ tier: "premium", status: "active", expiresAt: null }).ok).toBe(false);
  });
});

describe("resolveFeatureAccess", () => {
  it("keeps free-by-contract features available to guests even with no policy", () => {
    for (const feature of ["single_metadata_clean", "single_ai_metadata_clean", "single_custom_rewrite"] as const) {
      const access = resolveFeatureAccess(feature, null, null);
      expect(access.allowed).toBe(true);
      expect(access.source).toBe("default-free");
    }
  });

  it("keeps bulk cleaning free with the shipped defaults (never accidentally paid)", () => {
    expect(effectivePolicyValue("bulk_metadata_clean", null)).toBe("free");
    expect(resolveFeatureAccess("bulk_metadata_clean", null, null).allowed).toBe(true);
    expect(effectivePolicyValue("bulk_ai_metadata_clean", null)).toBe("free");
  });

  it("locks premium-by-default batch/project features for guests and free users", () => {
    for (const feature of ["batch_metadata_rewrite", "batch_gps_write", "multiple_named_projects", "saved_project_apply"] as const) {
      const guest = resolveFeatureAccess(feature, null, null);
      expect(guest.allowed).toBe(false);
      const freeUser = resolveFeatureAccess(feature, { tier: "free", status: "active", expiresAt: null }, null);
      expect(freeUser.allowed).toBe(false);
    }
  });

  it("admits premium entitlements to locked features", () => {
    const access = resolveFeatureAccess("batch_metadata_rewrite", premiumEntitlement(), null);
    expect(access.allowed).toBe(true);
    expect(access.source).toBe("entitlement");
  });

  it("fails closed for premium on expired or revoked entitlements — never for free features", () => {
    const expired = resolveFeatureAccess("batch_metadata_rewrite", premiumEntitlement("2026-01-01T00:00:00Z"), null);
    expect(expired.allowed).toBe(false);
    const revoked = resolveFeatureAccess("batch_metadata_rewrite", { tier: "free", status: "expired", expiresAt: null }, null);
    expect(revoked.allowed).toBe(false);
    const malformed = resolveFeatureAccess("batch_metadata_rewrite", premiumEntitlement("not-a-date"), null);
    expect(malformed.allowed).toBe(false);
    // Free operations are untouched by any of this.
    expect(resolveFeatureAccess("single_metadata_clean", premiumEntitlement("2026-01-01T00:00:00Z"), null).allowed).toBe(true);
  });

  it("follows a superadmin policy flip in both directions", () => {
    const openedPolicy: FeaturePolicy = {
      ...DEFAULT_FEATURE_POLICY,
      features: { ...DEFAULT_FEATURE_POLICY.features, bulk_metadata_clean: "premium" },
    };
    expect(resolveFeatureAccess("bulk_metadata_clean", null, openedPolicy).allowed).toBe(false);
    expect(effectivePolicyValue("bulk_metadata_clean", openedPolicy)).toBe("premium");

    const openedBatch: FeaturePolicy = {
      ...DEFAULT_FEATURE_POLICY,
      features: { ...DEFAULT_FEATURE_POLICY.features, batch_metadata_rewrite: "free" },
    };
    const access = resolveFeatureAccess("batch_metadata_rewrite", null, openedBatch);
    expect(access.allowed).toBe(true);
    expect(access.source).toBe("policy-free");
  });

  it("isEntitlementActive handles no-expiry, future expiry and malformed values", () => {
    expect(isEntitlementActive(premiumEntitlement())).toBe(true);
    expect(isEntitlementActive(premiumEntitlement("2999-01-01T00:00:00Z"))).toBe(true);
    expect(isEntitlementActive(premiumEntitlement("2020-01-01T00:00:00Z"))).toBe(false);
    expect(isEntitlementActive(null)).toBe(false);
  });
});
