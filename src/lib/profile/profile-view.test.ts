import { describe, expect, it } from "vitest";
import { blankProfile, type MetadataProfile } from "../metadata/rewrite/fields";
import {
  formatProfileTimestamp,
  profilePreviewRows,
  profilesDiffer,
  saveStatusLabel,
  saveStatusOf,
} from "./profile-view";

function profileWith(values: Record<string, string | string[]>): MetadataProfile {
  const profile = blankProfile();
  for (const [key, value] of Object.entries(values)) {
    if (key === "keywords") {
      const list = Array.isArray(value) ? value : [];
      profile.keywordsList = list;
      profile.keywords = list.join(", ");
    } else {
      profile[key as keyof MetadataProfile] = value as never;
    }
  }
  return profile;
}

describe("profilePreviewRows", () => {
  it("lists exactly ten rows in the approved order with set values", () => {
    const rows = profilePreviewRows(profileWith({
      creator: "A. Photographer",
      company: "Acme Studio",
      title: "Harbor noon",
      description: "A synthetic photo.",
      keywords: ["harbor", "noon"],
      copyright: "© 2026 Acme",
      rightsOwner: "Acme Studio",
      website: "https://acme.example.com",
      contact: "hello@acme.example.com",
      locationName: "Test Harbor",
    }));
    expect(rows.map((row) => row.field)).toEqual([
      "creator", "company", "title", "description", "keywords",
      "copyright", "rightsOwner", "website", "contact", "locationName",
    ]);
    expect(rows.every((row) => row.isSet)).toBe(true);
    expect(rows.find((row) => row.field === "creator")?.value).toBe("A. Photographer");
    expect(rows.find((row) => row.field === "keywords")?.value).toBe("harbor, noon");
  });

  it("flags every row unset for a blank profile (missing values never crash)", () => {
    const rows = profilePreviewRows(blankProfile());
    expect(rows).toHaveLength(10);
    expect(rows.every((row) => !row.isSet && row.value === "")).toBe(true);
    expect(rows.every((row) => row.label.length > 0)).toBe(true);
  });

  it("uses the Screen 06 field label vocabulary", () => {
    const labels = profilePreviewRows(blankProfile()).map((row) => row.label);
    expect(labels).toContain("Creator / Author");
    expect(labels).toContain("Location Name");
  });
});

describe("profilesDiffer", () => {
  it("is false for identical drafts and byte-equal snapshots", () => {
    const saved = profileWith({ title: "Harbor noon", keywords: ["keeper"] });
    expect(profilesDiffer({ ...saved }, saved)).toBe(false);
  });

  it("ignores whitespace-only typing so a trimmed edit is not dirty", () => {
    const saved = profileWith({ title: "Harbor noon" });
    expect(profilesDiffer(profileWith({ title: "  Harbor noon  " }), saved)).toBe(false);
  });

  it("detects real value edits and new keywords", () => {
    const saved = profileWith({ title: "Harbor noon" });
    expect(profilesDiffer(profileWith({ title: "Harbor noon!" }), saved)).toBe(true);
    expect(profilesDiffer(profileWith({ keywords: ["other"] }), saved)).toBe(true);
  });

  it("is false against a blank snapshot when the draft is only whitespace", () => {
    expect(profilesDiffer(profileWith({ title: "   " }), null)).toBe(false);
  });
});

describe("saveStatusOf", () => {
  it("maps every state honestly", () => {
    expect(saveStatusOf({ saving: true, hasSavedDoc: true, dirty: true, hasError: false })).toBe("saving");
    expect(saveStatusOf({ saving: false, hasSavedDoc: false, dirty: false, hasError: false })).toBe("not_saved");
    expect(saveStatusOf({ saving: false, hasSavedDoc: true, dirty: false, hasError: false })).toBe("saved");
    expect(saveStatusOf({ saving: false, hasSavedDoc: false, dirty: true, hasError: false })).toBe("unsaved");
    expect(saveStatusOf({ saving: false, hasSavedDoc: true, dirty: true, hasError: false })).toBe("unsaved");
    expect(saveStatusOf({ saving: false, hasSavedDoc: true, dirty: false, hasError: true })).toBe("failed");
  });

  it("labels match the required status names", () => {
    expect(saveStatusLabel("not_saved")).toBe("Not saved");
    expect(saveStatusLabel("unsaved")).toBe("Unsaved changes");
    expect(saveStatusLabel("saving")).toBe("Saving…");
    expect(saveStatusLabel("saved")).toBe("Saved");
    expect(saveStatusLabel("failed")).toBe("Save failed");
  });
});

describe("formatProfileTimestamp", () => {
  it("formats a Firestore ISO timestamp for the saved line", () => {
    // Constructed locally so the assertion is timezone-independent.
    const local = new Date(2026, 9, 18, 10, 24);
    const text = formatProfileTimestamp(local.toISOString());
    expect(text).toMatch(/Oct 18, 2026/);
    expect(text).toMatch(/10:24/);
  });

  it("is null for missing or malformed timestamps (never fabricates)", () => {
    expect(formatProfileTimestamp(null)).toBeNull();
    expect(formatProfileTimestamp("")).toBeNull();
    expect(formatProfileTimestamp("not-a-date")).toBeNull();
  });
});
