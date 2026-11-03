import { describe, expect, it } from "vitest";
import {
  blankProjectDraft,
  isProjectEmpty,
  normalizeProjectDraft,
  packKeywords,
  projectToProfile,
  projectTitleKey,
  unpackKeywords,
  validateProjectDraft,
  type ProjectDraft,
} from "./project-schema";

const validDraft = (overrides: Partial<ProjectDraft> = {}): ProjectDraft => ({
  ...blankProjectDraft(),
  projectTitle: "Client Spring Campaign",
  companyPublisher: "Acme Publishing",
  creatorAuthor: "A. Photographer",
  copyrightNotice: "© 2026 Acme",
  rightsOwner: "Acme Studio",
  websiteUrl: "https://acme.example.com",
  contactInformation: "hello@acme.example.com",
  imageTitle: "Harbor noon",
  imageDescription: "Campaign hero shot.",
  keywords: ["harbor", "noon"],
  locationName: "Test Harbor",
  latitude: 51.5007,
  longitude: -0.1246,
  altitudeMeters: 35,
  ...overrides,
});

describe("project schema (Phase 04)", () => {
  it("accepts a fully populated project draft", () => {
    const { ok, errors } = validateProjectDraft({ ...validDraft(), schemaVersion: 1 });
    expect(ok).toBe(true);
    expect(errors).toEqual([]);
  });

  it("rejects out-of-range coordinates and altitudes", () => {
    expect(validateProjectDraft({ ...validDraft(), latitude: 90.5 }).ok).toBe(false);
    expect(validateProjectDraft({ ...validDraft(), latitude: -90.5 }).ok).toBe(false);
    expect(validateProjectDraft({ ...validDraft(), longitude: 180.5 }).ok).toBe(false);
    expect(validateProjectDraft({ ...validDraft(), longitude: Number.NaN }).ok).toBe(false);
    expect(validateProjectDraft({ ...validDraft(), altitudeMeters: 25000 }).ok).toBe(false);
    expect(validateProjectDraft({ ...validDraft(), altitudeMeters: Number.POSITIVE_INFINITY }).ok).toBe(false);
    // Boundaries are valid.
    expect(validateProjectDraft({ ...validDraft(), latitude: -90, longitude: 180, altitudeMeters: -430 }).ok).toBe(true);
  });

  it("rejects oversized text, empty titles and bad keywords", () => {
    expect(validateProjectDraft({ ...validDraft(), projectTitle: "" }).ok).toBe(false);
    expect(validateProjectDraft({ ...validDraft(), projectTitle: "x".repeat(121) }).ok).toBe(false);
    expect(validateProjectDraft({ ...validDraft(), imageDescription: "x".repeat(2001) }).ok).toBe(false);
    expect(validateProjectDraft({ ...validDraft(), keywords: Array.from({ length: 31 }, (_, i) => `k${i}`) }).ok).toBe(false);
    expect(validateProjectDraft({ ...validDraft(), keywords: ["x".repeat(61)] }).ok).toBe(false);
    expect(validateProjectDraft({ ...validDraft(), keywords: "not-an-array" }).ok).toBe(false);
  });

  it("rejects privilege-shaped and media-shaped fields", () => {
    expect(validateProjectDraft({ ...validDraft(), tier: "premium" }).ok).toBe(false);
    expect(validateProjectDraft({ ...validDraft(), mediaUrl: "https://cdn.example.com/x.jpg" }).ok).toBe(false);
    expect(validateProjectDraft({ ...validDraft(), exif: {} }).ok).toBe(false);
  });

  it("normalizes: trims title, dedupes keywords case-insensitively, caps count", () => {
    const normalized = normalizeProjectDraft({
      ...validDraft(),
      projectTitle: "  Spaced Title  ",
      keywords: ["Harbor", "harbor", "  NOON ", "", "x".repeat(80)],
    });
    expect(normalized.projectTitle).toBe("Spaced Title");
    expect(normalized.keywords).toEqual(["Harbor", "NOON", "x".repeat(60)]);
  });

  it("distinguishes an empty draft and maps onto the profile shape without conflating titles", () => {
    expect(isProjectEmpty(blankProjectDraft())).toBe(true);
    expect(isProjectEmpty(validDraft())).toBe(false);
    const mapped = projectToProfile({ ...validDraft(), projectId: "p1", schemaVersion: 1, createdAt: null, updatedAt: null });
    expect(mapped.title).toBe("Harbor noon"); // imageTitle → profile title
    expect(mapped.company).toBe("Acme Publishing");
    expect(mapped.keywordsList).toEqual(["harbor", "noon"]);
    expect((mapped as unknown as Record<string, unknown>).projectTitle).toBeUndefined();
  });

  // ---- SOL-004: packed keyword storage keeps the 30-keyword contract ----
  it("SOL-004: packs/unpacks keywords losslessly and accepts 30 items", () => {
    const thirty = Array.from({ length: 30 }, (_, i) => `kw-${i}`);
    const packed = packKeywords(thirty);
    expect(packed.length).toBeLessThanOrEqual(30 * 60 + 29);
    expect(unpackKeywords(packed)).toEqual(thirty);
    expect(unpackKeywords("")).toEqual([]);
    expect(validateProjectDraft({ ...validDraft(), keywords: thirty }).ok).toBe(true);
    // Control characters inside a keyword are rejected (they are the separator).
    expect(validateProjectDraft({ ...validDraft(), keywords: ["a\u0001b"] }).ok).toBe(false);
  });

  // ---- SOL-006: website scheme contract (TS side) ----
  it("SOL-006: websiteUrl accepts only empty or absolute http(s) URLs with dotted hosts", () => {
    const ok = (value: string) => validateProjectDraft({ ...validDraft(), websiteUrl: value }).ok;
    expect(ok("")).toBe(true);
    expect(ok("https://acme.example.com")).toBe(true);
    expect(ok("http://acme.example.com/campaign?x=1#top")).toBe(true);
    expect(ok("ftp://acme.example.com/file")).toBe(false);
    expect(ok("file:///etc/passwd")).toBe(false);
    expect(ok("javascript:alert(1)")).toBe(false);
    expect(ok("data:text/html,hi")).toBe(false);
    expect(ok("/relative/path")).toBe(false);
    expect(ok("acme.example.com")).toBe(false);
    expect(ok("https://")).toBe(false);
    expect(ok("https://localhost")).toBe(false); // dotted-host contract
    expect(ok("https://acme.example.com:8080")).toBe(false); // no ports
    expect(ok("https://user@acme.example.com")).toBe(false); // no userinfo
    expect(ok("https://acme.example.com/x\ny")).toBe(false); // no control chars
    expect(ok(`https://acme.example.com/${"x".repeat(200)}`)).toBe(false); // ≤200 total
  });

  // ---- SOL-015: GPS pair invariants (TS side) ----
  it("SOL-015: coordinates must be a complete pair; altitude alone is rejected; (0,0) valid", () => {
    const draft = (overrides: Partial<ProjectDraft>) => ({ ...validDraft(), latitude: null, longitude: null, altitudeMeters: null, ...overrides });
    expect(validateProjectDraft(draft({ latitude: 0, longitude: 0, altitudeMeters: 0 })).ok).toBe(true);
    expect(validateProjectDraft(draft({})).ok).toBe(true);
    expect(validateProjectDraft(draft({ latitude: 51.5 })).ok).toBe(false);
    expect(validateProjectDraft(draft({ longitude: -0.12 })).ok).toBe(false);
    expect(validateProjectDraft(draft({ altitudeMeters: 35 })).ok).toBe(false);
    expect(validateProjectDraft(draft({ latitude: 51.5, longitude: -0.12 })).ok).toBe(true);
  });

  // ---- SOL-005: normalized title keys ----
  it("SOL-005: normalized-equivalent titles collide on the same reservation key", () => {
    expect(projectTitleKey("Harbor Noon")).toBe(projectTitleKey("harbor   noon"));
    expect(projectTitleKey("Harbor Noon")).toBe(projectTitleKey("  harbor noon  "));
    expect(projectTitleKey("Harbor Noon")).not.toBe(projectTitleKey("Harbon Noon"));
    // The key is a collision-free, safe document id (UTF-8 hex, no user text).
    expect(projectTitleKey("../etc/passwd")).toMatch(/^[0-9a-f]{2,240}$/);
    expect(projectTitleKey("বাংলা প্রকল্প")).toBe(projectTitleKey("বাংলা   প্রকল্প"));
    expect(projectTitleKey("বাংলা প্রকল্প").length).toBeLessThanOrEqual(240);
  });
});
