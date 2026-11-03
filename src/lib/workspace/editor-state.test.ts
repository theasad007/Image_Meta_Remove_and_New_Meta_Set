import { describe, expect, it } from "vitest";
import { blankProfile, type MetadataProfile } from "../metadata/rewrite/fields";
import {
  blankEditorDraft,
  buildEditorPreview,
  draftToProfile,
  editorDraftHasValues,
  editorPlanFor,
  editorKeywordList,
} from "./editor-state";

/** Saved profile from Firestore (signed-in source): unrelated values. */
function createProfile(values: Record<string, string | string[]>): MetadataProfile {
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

const SAVED_PROFILE = createProfile({
  company: "Saved Co",
  creator: "Saved Creator",
  copyright: "Saved Rights",
  title: "Saved Title",
  keywords: ["saved", "keywords"],
  description: "Saved description",
});

function draft(values: Record<string, string>, mode: "replace_editable" | "update_selected" = "replace_editable") {
  const base = blankEditorDraft(mode);
  return { ...base, values: { ...base.values, ...values } };
}

describe("editorPlanFor — source precedence (Rule C)", () => {
  it("guest custom values fully replace the saved profile — no merge of blank fields", () => {
    const plan = editorPlanFor(
      draft({ creator: "Image A Author", title: "Image A Title" }),
      SAVED_PROFILE,
    );
    expect(plan.canApply).toBe(true);
    expect(plan.source).toBe("custom");
    expect(plan.selectedFields.sort()).toEqual(["creator", "title"]);
    expect(plan.profile.creator).toBe("Image A Author");
    expect(plan.profile.title).toBe("Image A Title");
    // The saved-company value must NOT fill the blank company override.
    expect(plan.profile.company).toBe("");
    expect(plan.profile.copyright).toBe("");
    expect(Object.keys(plan.errors)).toHaveLength(0);
  });

  it("saved-profile source uses exclusively the profile for that image", () => {
    const plan = editorPlanFor(
      { ...draft({ creator: "Custom Creator", title: "" }, "update_selected"), source: "profile" },
      SAVED_PROFILE,
    );
    expect(plan.source).toBe("profile");
    expect(plan.canApply).toBe(true);
    expect(plan.profile.creator).toBe("Saved Creator"); // source switches wholesale
    expect(plan.profile.title).toBe("Saved Title");
    expect(plan.mode).toBe("update_selected");
  });

  it("empty saved profile blocks the profile source with helpful reason", () => {
    const plan = editorPlanFor({ ...blankEditorDraft("replace_editable"), source: "profile" }, createProfile({}));
    expect(plan.canApply).toBe(false);
    expect(plan.blockedReason).toContain("saved profile is empty");
  });

  it("guests can apply without any user object — no auth in the plan layer", () => {
    const plan = editorPlanFor(draft({ title: "Guest Title" }), SAVED_PROFILE);
    expect(plan.canApply).toBe(true);
    expect(plan.selectedFields).toEqual(["title"]);
  });
});

describe("editorPlanFor — validation gates", () => {
  it("empty form is blocked with an explanation, never applied", () => {
    const plan = editorPlanFor(blankEditorDraft("replace_editable"), SAVED_PROFILE);
    expect(plan.canApply).toBe(false);
    expect(plan.blockedReason).toContain("at least one supported value");
  });

  it("rejects oversize values with per-field errors (never truncation)", () => {
    const plan = editorPlanFor(draft({ creator: "x".repeat(121) }), SAVED_PROFILE);
    expect(plan.canApply).toBe(false);
    expect(plan.errors.creator).toMatch(/120 characters or fewer/);
  });

  it("rejects more than 30 unique keywords", () => {
    const keywords = Array.from({ length: 31 }, (_, i) => `kw${i}`).join(", ");
    const plan = editorPlanFor(draft({ keywords }), SAVED_PROFILE);
    expect(plan.canApply).toBe(false);
    expect(plan.errors.keywords).toMatch(/at most 30 unique keywords/);
  });

  it("rejects non-http(s) website values", () => {
    const plan = editorPlanFor(draft({ website: "ftp://example.com/a" }), SAVED_PROFILE);
    expect(plan.canApply).toBe(false);
    expect(plan.errors.website).toMatch(/http/);
  });

  it("dedupes keywords case-insensitively and reports the list", () => {
    const list = editorKeywordList("Harbor, harbor , noon;NIGHT\nNight");
    expect(list.length).toBe(3);
    expect(list).toEqual(["Harbor", "noon", "NIGHT"]);
  });

  it("draftToProfile trims whitespace and keeps control-safe strings as-is", () => {
    const { profile, errors } = draftToProfile(draft({ title: "  Spaces Trimming  " }));
    expect(profile.title).toBe("Spaces Trimming");
    expect(Object.keys(errors)).toHaveLength(0);
  });
});

describe("editorDraftHasValues", () => {
  it("false for blank drafts, true for keywords-only drafts", () => {
    expect(editorDraftHasValues(blankEditorDraft("replace_editable"))).toBe(false);
    expect(editorDraftHasValues(draft({ keywords: "one, two" }))).toBe(true);
  });
});

describe("buildEditorPreview", () => {
  it("lists every mapped channel for a JPEG and the replace-mode strip summary", () => {
    const plan = editorPlanFor(draft({ title: "QA Title", creator: "QA Creator" }), SAVED_PROFILE);
    const preview = buildEditorPreview(plan, "jpeg");
    expect(preview.mode).toBe("replace_editable");
    expect(preview.stripSummary).toMatch(/proven cleaner|privacy defaults/i);
    expect(preview.writes).toHaveLength(2);
    const titleLine = preview.writes.find((line) => line.field === "title");
    expect(titleLine?.channels).toEqual(
      expect.arrayContaining(["EXIF DocumentName (269)", "XMP dc:title", "JPEG IPTC 2:5 ObjectName"]),
    );
    expect(titleLine?.value).toBe("QA Title");
    expect(preview.c2paNote).toMatch(/never claimed removed or valid/i);
  });

  it("discloses IPTC unsupported channels on non-JPEG formats", () => {
    const plan = editorPlanFor(draft({ title: "png title" }), SAVED_PROFILE);
    const preview = buildEditorPreview(plan, "png");
    const titleLine = preview.writes.find((line) => line.field === "title");
    expect(titleLine?.channels).not.toContain("JPEG IPTC 2:5 ObjectName");
    expect(preview.unsupported.some((entry) => entry.field === "title")).toBe(true);
    expect(preview.unsupported[0]?.note).toMatch(/EXIF\/XMP only/);
  });

  it("update_selected mode has no strip summary and honest signature caveat", () => {
    const preview = buildEditorPreview(
      editorPlanFor(draft({ creator: "kept author" }, "update_selected"), SAVED_PROFILE),
      "jpeg",
    );
    expect(preview.stripSummary).toBeNull();
    expect(preview.c2paNote).toMatch(/re-validated|invalidate/i);
  });
});

// ------------------------------------------------- project source (Phase 05)

function projectRecord(values: {
  projectTitle?: string;
  companyPublisher?: string;
  creatorAuthor?: string;
  imageTitle?: string;
  keywords?: string[];
  locationName?: string;
  latitude?: number | null;
  longitude?: number | null;
  altitudeMeters?: number | null;
}) {
  return {
    projectId: "proj-1",
    projectTitle: values.projectTitle ?? "Client Campaign",
    clientName: "Acme",
    companyPublisher: values.companyPublisher ?? "Project Co",
    creatorAuthor: values.creatorAuthor ?? "Project Creator",
    copyrightNotice: "",
    rightsOwner: "",
    websiteUrl: "",
    contactInformation: "",
    imageTitle: values.imageTitle ?? "Project Image Title",
    imageDescription: "",
    keywords: values.keywords ?? ["project", "kw"],
    locationName: values.locationName ?? "",
    latitude: values.latitude ?? null,
    longitude: values.longitude ?? null,
    altitudeMeters: values.altitudeMeters ?? null,
    schemaVersion: 1,
    createdAt: null,
    updatedAt: null,
  };
}

describe("editorPlanFor — saved project source (Phase 05)", () => {
  it("uses project values exactly as saved and never merges the profile or draft", () => {
    const source = { ...blankEditorDraft("replace_editable"), source: "project" as const, projectId: "proj-1" };
    const plan = editorPlanFor(source, SAVED_PROFILE, projectRecord({}));
    expect(plan.canApply).toBe(true);
    expect(plan.source).toBe("project");
    expect(plan.profile.company).toBe("Project Co");        // project, not "Saved Co"
    expect(plan.profile.creator).toBe("Project Creator");
    expect(plan.profile.title).toBe("Project Image Title");
    expect(plan.profile.keywordsList).toEqual(["project", "kw"]);
    // Empty project fields stay absent — they are NOT written and NOT
    // inherited from the saved profile or the custom draft.
    expect(plan.selectedFields).not.toContain("copyright");
    expect(plan.selectedFields).not.toContain("website");
    expect(plan.selectedFields).toContain("company");
    expect(plan.selectedFields).toContain("title");
    expect(plan.selectedFields).toContain("keywords");
  });

  it("maps project coordinates to a verified GPS write directive", () => {
    const source = { ...blankEditorDraft("replace_editable"), source: "project" as const, projectId: "proj-1" };
    const withGps = editorPlanFor(source, SAVED_PROFILE, projectRecord({ latitude: -34.6037, longitude: -58.3816, altitudeMeters: -5 }));
    expect(withGps.gps).toEqual({ latitude: -34.6037, longitude: -58.3816, altitude: -5 });
    // Altitude-null projects still write lat/lon.
    const noAlt = editorPlanFor(source, SAVED_PROFILE, projectRecord({ latitude: 12, longitude: 98, altitudeMeters: null }));
    expect(noAlt.gps).toEqual({ latitude: 12, longitude: 98, altitude: null });
    // Coordinate-free projects never touch GPS.
    const noGps = editorPlanFor(source, SAVED_PROFILE, projectRecord({}));
    expect(noGps.gps).toBeNull();
    // Other sources never produce a GPS directive from the plan.
    expect(editorPlanFor(draft({ title: "T" }), SAVED_PROFILE).gps).toBeNull();
  });

  it("blocks when no project is selected or the project is empty, and recovers", () => {
    const source = { ...blankEditorDraft("replace_editable"), source: "project" as const, projectId: null };
    const noSelection = editorPlanFor(source, SAVED_PROFILE, null);
    expect(noSelection.canApply).toBe(false);
    expect(noSelection.blockedReason).toMatch(/select a saved project/i);

    const empty = editorPlanFor({ ...source, projectId: "proj-1" }, SAVED_PROFILE, projectRecord({
      companyPublisher: "", creatorAuthor: "", imageTitle: "", keywords: [],
    }));
    expect(empty.canApply).toBe(false);
    expect(empty.blockedReason).toMatch(/no metadata or GPS/i);

    // A GPS-only project is still appliable.
    const gpsOnly = editorPlanFor({ ...source, projectId: "proj-1" }, SAVED_PROFILE, projectRecord({
      companyPublisher: "", creatorAuthor: "", imageTitle: "", keywords: [], latitude: 1, longitude: 2,
    }));
    expect(gpsOnly.canApply).toBe(true);
    expect(gpsOnly.selectedFields).toEqual([]);
  });

  it("keeps per-file drafts isolated: switching source restores the custom draft", () => {
    const custom = draft({ title: "My Custom Title" });
    const switched = { ...custom, source: "project" as const, projectId: "proj-1" };
    const restored = { ...switched, source: "custom" as const };
    // The custom values never change when the source switches.
    expect(custom.values.title).toBe("My Custom Title");
    expect(switched.values.title).toBe("My Custom Title");
    expect(restored.values.title).toBe("My Custom Title");
    // And the plans for the same draft stay independent.
    const projectPlan = editorPlanFor(switched, SAVED_PROFILE, projectRecord({}));
    expect(projectPlan.profile.title).toBe("Project Image Title");
    const customPlan = editorPlanFor(restored, SAVED_PROFILE);
    expect(customPlan.profile.title).toBe("My Custom Title");
  });
});
