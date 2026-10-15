import { describe, expect, it, beforeEach } from "vitest";
import { isFirebaseConfigured, resetFirebaseInstancesForTests } from "./config";
import { signInWithGoogle, signOutNow, type AuthBackend } from "./auth";
import {
  blankProfile,
  isProfileEmpty,
  parseKeywords,
  selectProfileFields,
  validateProfile,
} from "../metadata/rewrite/fields";

beforeEach(() => {
  resetFirebaseInstancesForTests();
});

describe("firebase config gating (guest-safe without credentials)", () => {
  it("reports unconfigured when identifiers are missing", () => {
    expect(isFirebaseConfigured({})).toBe(false);
    expect(isFirebaseConfigured({ apiKey: "x" })).toBe(false);
    expect(
      isFirebaseConfigured({ apiKey: "k", authDomain: "d", projectId: "p", appId: "a" }),
    ).toBe(true);
  });
  it("sign-in without config returns a configured-error, never a popup", async () => {
    const backend: AuthBackend = {
      signInWithPopup: () => {
        throw new Error("popup must never open without config");
      },
      googleProvider: () => ({}),
    };
    const outcome = await signInWithGoogle(backend);
    expect(outcome.status).toBe("error");
    if (outcome.status === "error") expect(outcome.code).toBe("auth/configuration-not-found");
  });
  it("sign-out without config rejects instead of touching the SDK", async () => {
    await expect(signOutNow()).rejects.toThrow(/not configured/i);
  });
});

describe("google sign-in state machine (injected backend + auth)", () => {
  const fakeAuth = {} as never;
  const user = { uid: "u1", displayName: "Test User", email: "t@example.com", photoURL: null };
  function backendFor(outcome: unknown): AuthBackend {
    return {
      signInWithPopup: async () => {
        if (outcome instanceof Error) throw outcome;
        return { user: outcome as never };
      },
      googleProvider: () => ({}),
    };
  }
  function codeError(code: string): Error {
    return Object.assign(new Error(code), { code });
  }
  it("signs in and carries identity only (never authorship)", async () => {
    const outcome = await signInWithGoogle(backendFor(user), fakeAuth);
    expect(outcome).toEqual({ status: "signed-in", user });
  });
  it("treats popup-closed as cancellation, not an error", async () => {
    expect(await signInWithGoogle(backendFor(codeError("auth/popup-closed-by-user")), fakeAuth)).toEqual({
      status: "cancelled",
    });
  });
  it("maps popup-blocked to a truthful non-technical error", async () => {
    const outcome = await signInWithGoogle(backendFor(codeError("auth/popup-blocked")), fakeAuth);
    expect(outcome.status).toBe("error");
    if (outcome.status === "error") {
      expect(outcome.code).toBe("auth/popup-blocked");
      expect(outcome.message).toMatch(/blocked.*popup|popup.*blocked/i);
    }
  });
  it("maps unauthorized-domain and disabled-provider distinctly", async () => {
    const domain = await signInWithGoogle(backendFor(codeError("auth/unauthorized-domain")), fakeAuth);
    expect(domain.status === "error" && domain.message).toMatch(/Authorized domains/);
    const provider = await signInWithGoogle(backendFor(codeError("auth/operation-not-allowed")), fakeAuth);
    expect(provider.status === "error" && provider.message).toMatch(/Google provider/);
  });
  it("maps offline and rate limits without touching guest state", async () => {
    const offline = await signInWithGoogle(backendFor(codeError("auth/network-request-failed")), fakeAuth);
    expect(offline.status === "error");
    const limited = await signInWithGoogle(backendFor(codeError("auth/too-many-requests")), fakeAuth);
    expect(limited.status === "error");
  });
});

describe("profile validation and sanitization", () => {
  it("accepts a full valid profile with keyword parsing", () => {
    const { profile, errors } = validateProfile({
      company: "Acme Studio",
      creator: "A. Photographer",
      copyright: "© 2026 Acme",
      rightsOwner: "Acme Studio",
      website: "https://acme.example.com/work",
      contact: "hello@acme.example.com",
      title: "Harbor noon",
      description: "A synthetic test photo.",
      keywords: "harbor, noon, harbor,  test ",
      locationName: "Test Harbor",
    });
    expect(errors).toEqual({});
    expect(profile.company).toBe("Acme Studio");
    expect(profile.keywordsList).toEqual(["harbor", "noon", "test"]);
    expect(isProfileEmpty(profile)).toBe(false);
  });
  it("rejects oversized fields, bad URLs and overlong keywords", () => {
    const { errors } = validateProfile({
      title: "x".repeat(201),
      website: "ftp://example.com",
      keywords: `${"y".repeat(61)}`,
      description: "z".repeat(2001),
    });
    expect(errors.title).toMatch(/200/);
    expect(errors.website).toMatch(/http/);
    expect(errors.keywords).toMatch(/60/);
    expect(errors.description).toMatch(/2,000|2000/);
  });
  it("treats non-string input and blank profiles honestly", () => {
    expect(validateProfile({ title: 42 as unknown as string }).errors.title).toMatch(/text/);
    expect(isProfileEmpty(blankProfile())).toBe(true);
    expect(isProfileEmpty({ ...blankProfile(), title: "  " })).toBe(true);
  });
  it("selects only non-blank requested fields for update mode", () => {
    const { profile } = validateProfile({ creator: "C", title: "", keywords: "a, b" });
    expect(selectProfileFields(profile, ["creator", "title", "keywords", "contact"])).toEqual({
      creator: "C",
      keywords: "a, b",
    });
  });
  it("splits keywords on commas, newlines and semicolons", () => {
    expect(parseKeywords("a;b\nc, a")).toEqual(["a", "b", "c"]);
  });
});
