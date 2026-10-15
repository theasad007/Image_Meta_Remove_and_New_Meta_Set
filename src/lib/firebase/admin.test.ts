import { describe, expect, it } from "vitest";
import { isSuperadminClaim, toSessionUser } from "./session";
import {
  canSuspendTarget,
  sanitizeDirectoryIdentity,
  validateDirectoryCreate,
  validateDirectoryOwnerUpdate,
  validateStatusChange,
  validateUsagePolicy,
} from "./directory";

describe("superadmin claim derivation (never trusts client role flags)", () => {
  it("requires an explicit true custom claim", () => {
    expect(isSuperadminClaim(null)).toBe(false);
    expect(isSuperadminClaim({})).toBe(false);
    expect(isSuperadminClaim({ claims: { superadmin: false } })).toBe(false);
    expect(isSuperadminClaim({ claims: { superadmin: "true" } })).toBe(false);
    expect(isSuperadminClaim({ claims: { role: "admin" } })).toBe(false);
    expect(isSuperadminClaim({ claims: { superadmin: true } })).toBe(true);
  });
  it("merges identity with claim state", () => {
    const session = toSessionUser(
      { uid: "u1", displayName: "Owner", email: "o@example.com", photoURL: null },
      { claims: { superadmin: true } },
    );
    expect(session).toEqual({ uid: "u1", displayName: "Owner", email: "o@example.com", photoURL: null, superadmin: true });
  });
});

describe("directory validators (mirror firestore.rules ceilings)", () => {
  const base = { uid: "u1", email: "u@example.com", displayName: "User", photoURL: "", status: "active" };
  it("accepts a minimal active self-registration, rejects extras and roles", () => {
    expect(validateDirectoryCreate(base).ok).toBe(true);
    expect(validateDirectoryCreate({ ...base, status: "suspended" }).errors.join(" ")).toMatch(/active/);
    expect(validateDirectoryCreate({ ...base, superadmin: true }).ok).toBe(false);
    expect(validateDirectoryCreate({ ...base, role: "admin" }).ok).toBe(false);
    expect(validateDirectoryCreate({ ...base, email: "x".repeat(201) }).ok).toBe(false);
  });
  it("lets owners update identity only, never status or uid", () => {
    expect(validateDirectoryOwnerUpdate({ ...base, displayName: "New" }, "u1").ok).toBe(true);
    expect(validateDirectoryOwnerUpdate({ ...base, status: "suspended" }, "u1").ok).toBe(false);
    expect(validateDirectoryOwnerUpdate({ ...base, uid: "u2" }, "u1").ok).toBe(false);
  });
  it("restricts status changes to the status field (+optional reason)", () => {
    const current = { ...base, createdAt: "t" };
    expect(validateStatusChange(current, { ...current, status: "suspended" }).ok).toBe(true);
    expect(validateStatusChange(current, { ...current, status: "suspended", statusReason: "spam" }).ok).toBe(true);
    expect(validateStatusChange(current, { ...current, status: "banned" }).ok).toBe(false);
    expect(validateStatusChange(current, { ...current, status: "suspended", email: "evil@x.com" }).ok).toBe(false);
    expect(validateStatusChange(current, { ...current, status: "suspended", statusReason: "x".repeat(281) }).ok).toBe(false);
  });
  it("blocks self-suspension in UI logic (no lockout)", () => {
    expect(canSuspendTarget("owner", "owner").allowed).toBe(false);
    expect(canSuspendTarget("owner", "abuser").allowed).toBe(true);
  });
  it("slices Google-provided identity to ceilings", () => {
    const out = sanitizeDirectoryIdentity({ email: "e".repeat(500), displayName: "n".repeat(500), photoURL: "p".repeat(500) });
    expect(out.email.length).toBeLessThanOrEqual(200);
    expect(out.displayName.length).toBeLessThanOrEqual(120);
    expect(out.photoURL.length).toBeLessThanOrEqual(300);
  });
});

describe("usage-policy validator (stored, never enforced)", () => {
  it("accepts unlimited defaults and bounded future values", () => {
    expect(validateUsagePolicy({ mode: "unlimited", updatedBy: "owner" }).ok).toBe(true);
    expect(validateUsagePolicy({ mode: "unlimited", cleanDaily: 500, updatedBy: "owner" }).ok).toBe(true);
    expect(validateUsagePolicy({ mode: "capped", updatedBy: "owner" }).ok).toBe(false);
    expect(validateUsagePolicy({ mode: "unlimited", cleanDaily: 1.5, updatedBy: "owner" }).ok).toBe(false);
    expect(validateUsagePolicy({ mode: "unlimited", cleanDaily: -1, updatedBy: "owner" }).ok).toBe(false);
  });
});
